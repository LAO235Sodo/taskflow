#!/usr/bin/env node
// @ts-check
// tf.mjs — taskflow 唯一 CLI。单文件是刻意设计（拷贝即用、无构建）；
// 拆分触发器见项目 conventions（>1500 行 / 命令互调 / 实证耦合事故）。
//
// ── 函数目录（新增函数按分区落位；定位用 grep '^function 名字'）──
// 工具层（纯函数，命令间共享）: git / isAnc / refStatus / readJson / relTime /
//   locate / loadTasks / loadIgnores / matchIgnore / corruptedReport / parseWriteSet / parseReadSet / matchPath /
//   parsePipeTables（lint 挂接对账管道表解析）/ mirrorDeployRecord（deploy → task.json.deploy 镜像回写+部署事件状态扳机）
// 命令层（互不调用）: ls / strays / doctor / selfCheck / reconcile / scout / skillsCmd /
//   accept / takeover / parkCmd / unparkCmd / lock / commitCmd / reqConfirm / testplan / diagnose / nextid / migrateCmd / archiveCmd / svcCmd / lintCmd / staleCmd / overlapCmd / impactCmd / mergegateCmd / revertPlanCmd / gatesCmd
// 分发区: 文件尾 if (cmd === …) 一行一命令
// 不变量 spec: references/data.md「不变量」表——脚本侧唯一登记处 = INVARIANTS 注册表，
//   三源一致性由 `doctor --self` 机械强制；新增检查必须同时落注册表+data.md 行+实现体。
// taskflow 盘点/体检/簿记脚本（读写边界见下「能力声明」）
// 能力声明：判断归模型、机械执行归脚本——写入口（簿记命令）：reconcile --fix（回写 index）、
//   nextid --reserve（占号登记）、commit（安全提交+属主回填+部署扳机+状态翻转+goalHash 锚定+baseCommit 锚定）、
//   req-confirm（需求变更门落痕：goalHash 刷新+reqChanges 追加）、takeover（接管仪式）、park 写 status/parkedReason/parkedAt/lastActiveAt、unpark 写 status/lastActiveAt 并删 parkedReason/parkedAt（PARK 搁置簿记）、
//   lock（排队锁文件）、snapshot（合并快照：main HEAD 哈希写入 task.json.mergeSnapshot——mergegate 只读比对不写）、migrate（一次性数据搬迁，旧 .opencode/tasks → .taskflow）、archive（死档案归层 archive/ + journal 三件套归位）、
//   svc claim/release（服务端口租约簿记：登记/补登/回收/释放——探测让位绝不 kill，停服归编排层）、
//   mech install（机制生成安装：assets/harness+design 模板渲染入项目 + CHANGELOG 锚点 + conventions/AGENTS 补记 + mechanisms 采纳登记 + --yes 确认闸（v2.65.0：漂移刷新/整文件覆盖已有文件须显式确认，首装空位不拦）；CI 挂点只建议不自动改）；
//   其余命令只读（v2.59.0 新增 stale=在途影响面漂移检查 / overlap=并行派发写集求交，均不改任何状态）。叙事与损坏 JSON 修复仍归编排层。
// 退出码契约：0 = 正常/全绿；1 = doctor 发现差异（ls 仅在自身运行失败时非 0）。
// 词汇与文档一致（统一词汇，模型转述零翻译）：游离 / 对账 / 漏网 / 补登 / 等验收。
// 自造词 → 传统术语对照唯一源：references/terminology.md（新自造词先入表再用；文档/输出首现写「自造词（传统术语）」）。
// prose 禁复述不变量范围/命令数/模板数（lint 事实禁改写清单强制）——清单真相源：data.md 表 / 本文件分发区 / templates/ 目录。

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { STATES, validateTransition } from './taskflow-state-machine.mjs'; // 状态机唯一机器源（v2.69.0）：枚举单源 + 写侧转换合法性断言

const R = (s) => String(s ?? '').trim();
const trunc = (s, n) => { const a = Array.from(String(s ?? '')); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); }; // 码点安全切片（攻击轮 C5：UTF-16 码元切片切裂代理对 → U+FFFD）

/**
 * git 子进程封装。
 * @param {string[]} args git 参数
 * @param {string} cwd 工作目录（缺省=当前）
 * @param {boolean} mayFail true=失败返回 null 不抛；false=失败抛异常（调用方负责语境）
 * @returns {string|null} stdout（trim）；mayFail 且失败时 null
 */
function git(args, cwd, mayFail = false) {
  try {
    return R(execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (e) {
    if (mayFail) return null;
    return null;
  }
}
const isAnc = (cwd, a, b) => {
  try { execFileSync('git', ['merge-base', '--is-ancestor', String(a), String(b)], { cwd, stdio: 'ignore' }); return true; }
  catch { return false; }
};
// 区分「分支不存在」与「git 命令失败」：show-ref --verify 退出码 1=ref 不存在，其余=真异常（锁/权限），防止误诊
const refStatus = (cwd, ref) => {
  try { execFileSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd, stdio: 'ignore' }); return 0; }
  catch (e) { return e?.status ?? -1; }
};
/**
 * 宽容读取 JSON：损坏/缺失返回 null（由 corruptedReport 统一大声报，不许静默吞）。
 * @param {string} p 路径
 * @returns {any|null}
 */
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

/* ---------------- 服务端口租约工具层（svc 簇 + doctor I14 共享）---------------- */
const servicesPathOf = (tasksDir) => path.join(tasksDir, 'services.json');
function pidAlive(pid) {
  const p = Number(pid);
  if (!Number.isInteger(p) || p <= 0) return false;
  try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } // EPERM=活但非本用户 → 按活处理（宁可不回收）
}
/* 进程启动时间（分钟级 ISO）——ownerAlive 双判据的数据源；LC_ALL=C 防 macOS 中文 locale（2026-09-27 建档实证踩坑） */
function procStartIso(pid) {
  try {
    const out = R(execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }));
    const m = out.match(/^[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}:\d{2}):\d{2}\s+(\d{4})/); // 'Sat Sep 19 10:24:31 2026'（周几在前，弃用）
    if (!m) return null;
    const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const mon = MON[m[1]]; if (!mon) return null;
    return `${m[4]}-${mon}-${m[2].padStart(2, '0')}T${m[3]}:00`;
  } catch { return null; }
}
/* 属主活性双判据（v2.29.0，治 pid 复用假阳性）：pid 活 且（有 started_at 凭证时）进程启动**不显著晚于**凭证（容差 5 分钟）。
   单向判定：pid 复用的充要特征 = 新进程启动晚于凭证写入；「进程先起、凭证后写」（长驻 agent 进程开新任务/接管——
   实证：长驻进程隔日写凭证曾被双向判据误报）是合法态，不判嫌疑。
   凭证缺失/ps 不可用/解析失败 → 降级旧语义（pid 活即活）——降级不静默由调用方文案体现。
   仅用于 .owner.json（started_at 语义=属主凭证时刻）；services.json 的 startedAt 是租约登记时间，语义不同，禁用此函数。 */
function ownerAlive(pid, startedAt) {
  if (!pidAlive(pid)) return false;
  if (typeof startedAt !== 'string' || !startedAt) return true;
  const s = procStartIso(pid); if (!s) return true;
  const b = Date.parse(startedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (!Number.isFinite(b)) return true;
  return (Date.parse(s) - b) <= 5 * 60 * 1000; // 仅「进程比凭证新超容差」= 复用嫌疑
}
function portProbe(port) {
  // OS 层端口探测：lsof（macOS/Linux）优先——exit 0 为权威结论；非零/缺失 → ss 回退；都不可用 → skipped（探测降级，调用方必须警告，禁静默）
  const ssFallback = () => {
    try {
      const out2 = execFileSync('ss', ['-ltnp'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const line2 = out2.split('\n').find((l) => new RegExp(`:${port}\\s`).test(l));
      return { occupied: !!line2, who: line2 ? line2.trim() : null, skipped: false };
    } catch { return { occupied: false, who: null, skipped: true, reason: 'lsof/ss 均不可用' }; }
  };
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const line = out.split('\n').find((l) => /LISTEN/.test(l));
    return { occupied: !!line, who: line ? line.trim() : null, skipped: false };
  } catch (e1) {
    if (e1.code === 'ENOENT') return ssFallback();
    if (e1.status === 1) return { occupied: false, who: null, skipped: false }; // lsof 在场：无匹配 = 空闲
    return ssFallback(); // 其他非零（权限/异常歧义）→ 交给 ss 定夺，避免误报空闲
  }
}
function writeServices(svcPath, db) {
  const tmp = svcPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
  fs.renameSync(tmp, svcPath);
}

function relTime(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}
const STATUS = { active: 'active', verifying: '等验收', parked: '已搁置', merged: '已合并', archived: 'archived' };

function locate() {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], process.cwd(), true);
  const isGit = !!common;
  const mainRoot = isGit ? path.dirname(path.resolve(common)) : process.cwd();
  return { isGit, mainRoot, tasksDir: tasksDirUnder(mainRoot) };
}
// tasksDir 推导（v2.69.0 从 locate 抽取，gates/mergegate 纯函数共用）：主选 .taskflow/（数据目录平台中立），
// 旧 .opencode/tasks/ 存在则原样识别（存量不迁移也能跑），两者并存时以 .taskflow 为准
function tasksDirUnder(mainRoot) {
  const primary = path.join(mainRoot, '.taskflow');
  const legacy = path.join(mainRoot, '.opencode', 'tasks');
  return fs.existsSync(primary) ? primary : (fs.existsSync(legacy) ? legacy : primary);
}
// 任务档案目录（根层优先，archive/ 兜底）——全仓高频同款三元的单一化
const taskDirOf = (tasksDir, id) => (fs.existsSync(path.join(tasksDir, id)) ? path.join(tasksDir, id) : path.join(tasksDir, 'archive', id));
// 主 ref 解析（v2.69.0 从 mergegate/stale 抽取共用）：本地优先（与 snapshotCmd 同源——合并动作落本地 main，origin 滞后窗口门会瞎，dogfood 自证）
const resolveMainRef = (mainRoot) => ['main', 'master', 'origin/main'].find((r) => git(['-C', mainRoot, 'rev-parse', '--verify', r], mainRoot, true)) ?? null;
// 「分支已并入主 ref」判定（v2.69.0 抽取，accept --pass 前置门与 gates 共用）：
// 合并事实 = 分支可达自**任一**主 ref（origin/main 可能落后于本地 main——本地合并未 push 时先命中它会误拒，2026-09-23 实证）；
// baseBranch（任务集成的基线分支，如 origin/main-view2）同为合法主 ref 候选——非 main 命名主分支项目缺它必误拒（2026-09-24 实证）。
// 返回 { mainRefs, merged }：merged=null 表示无主 ref 可判（调用方自行降级为无法机械校验）。
function isMergedIntoMain(t, mainRoot) {
  const mainRefs = ['origin/main', 'main', 'master', t.baseBranch].filter(Boolean)
    .filter((r) => git(['-C', mainRoot, 'rev-parse', '--verify', r], mainRoot, true));
  if (!mainRefs.length) return { mainRefs, merged: null };
  return { mainRefs, merged: mainRefs.some((r) => isAnc(mainRoot, t.branch, r)) };
}
const CORRUPTED = []; // 本次运行中解析失败的 task.json（损坏=任务从 ls/doctor 消失，必须大声报）
const loadTasks = (tasksDir) => {
  const out = [];
  const layers = [tasksDir, path.join(tasksDir, 'archive')]; // 活死分层：根层=活任务，archive/=已完结
  for (const layer of layers) {
    if (!fs.existsSync(layer)) continue;
    for (const d of fs.readdirSync(layer, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(layer, d.name, 'task.json');
      if (!fs.existsSync(p)) continue;
      let tj = null;
      try { tj = JSON.parse(fs.readFileSync(p, 'utf8')); }
      catch { CORRUPTED.push(d.name); continue; }
      if (tj && tj.id) out.push(tj);
      else CORRUPTED.push(`${d.name}（缺 id 字段）`);
    }
  }
  return out;
};
const corruptedReport = (where) => CORRUPTED.length
  ? `\n⚠ task.json 解析失败：${CORRUPTED.join('、')}（${where}）→ 这些任务被跳过、不会出现在任何列表里，须先修复 JSON`
  : '';
function loadIgnores(tasksDir) {
  const j = readJson(path.join(tasksDir, 'adopt-ignore.json'));
  if (!j) return [];
  const arr = Array.isArray(j) ? j : (Array.isArray(j.ignores) ? j.ignores : Array.isArray(j.items) ? j.items : []);
  return arr.map((e) => (typeof e === 'string' ? e : e?.ref ?? e?.pattern ?? e?.name)).filter(Boolean);
}
function matchIgnore(pattern, s) {
  if (!pattern.includes('*')) return s === pattern || s.includes(pattern);
  const re = new RegExp('^' + pattern.split('*').map((q) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'));
  return re.test(s);
}

/* ---------------- ls：盘点（登记任务 + 游离工作） ---------------- */

/* 等验收判定：顶层状态或部署态任一命中（v2.18.2：修「部署后顶层仍 active 遮蔽📌块」盲区——
   实证：任务部署冒烟全过后 ls 仍无待验收提示）。挂起天数单一数据源不变：waitDaysNum（deploy.deployedAt 优先）。 */
function isVerifying(t) {
  return t?.status === 'verifying' || t?.deploy?.status === 'verifying'; // 委托语义见 taskflow-state-machine.mjs isVerifying（写侧保留内联判断：本函数在热路径被高频调用且需容忍非对象入参）
}

// 状态机断言（v2.69.0）：状态写盘前的转换合法性硬门——validateTransition 未命中白名单即抛错中止写盘。
// 各写侧内联前置门（isAnc/reason 必填等富语义）仍是第一道，本断言是第二道物理墙（机器源唯一性的交叉验证）。
function assertTransition(from, to, cmdName) {
  const v = validateTransition(from, to, cmdName);
  if (!v.ok) throw new Error(`状态机断言失败 ${from ?? '（无）'}→${to} via ${cmdName}：${v.reason}`);
}

// 事件日志（v2.69.0，观察者）：状态转换与 archive 归层的追加式审计流，落 .taskflow/events.jsonl
// （铁律 1 不入 git，项目本地）。只写不读——不加 doctor 不变量，产物核对交人工 tail（revert-plan 不读本文件）。
function appendEvent(tasksDir, evt) {
  try {
    fs.appendFileSync(path.join(tasksDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...evt }) + '\n');
  } catch (e) {
    console.log(`⚠ 事件日志写入失败（${e.message}）——主操作已生效，该条审计行丢失`);
  }
}

function ls(args = []) {
  const { isGit, mainRoot, tasksDir } = locate();
  const all = args.includes('--all');
  const index = readJson(path.join(tasksDir, 'index.json'))?.tasks ?? [];
  const tasks = loadTasks(tasksDir);
  console.log(`# taskflow 盘点`);
  console.log(`项目：${mainRoot}${isGit ? '' : '（非 git 目录：仅文档存档，无 worktree/分支）'}`);
  if (!fs.existsSync(tasksDir)) {
    console.log('\n任务目录不存在（<主仓库根>/.taskflow/；旧项目或为 .opencode/tasks/——node tf.mjs migrate 一键搬迁）→ 项目尚未初始化，首次建档时自动创建。');
    return 0;
  }
  const crpt = corruptedReport('ls');
  if (crpt) console.log(crpt);

  const live = tasks
    .filter((t) => t.status === 'active' || t.status === 'verifying' || t.status === 'parked' || (all && (t.status === 'merged' || t.status === 'archived')))
    .sort((a, b) => ((isVerifying(b) ? 1 : 0) - (isVerifying(a) ? 1 : 0))
      || (Date.parse(b.lastActiveAt ?? 0) - Date.parse(a.lastActiveAt ?? 0)));
  const ver = live.filter((t) => t.status !== 'parked' && isVerifying(t)); // 等验收置顶组：有人等你拍板，不能沉在表里（含部署态）；parked 一律除外——dual-source 漂移态 parked 后不得霸占📌块（攻击轮 A/C 双路实证）
  const mergedCount = tasks.filter((t) => t.status === 'merged' || t.status === 'archived').length;
  const liveCount = tasks.filter((t) => t.status === 'active' || t.status === 'verifying').length; // 活任务计数（parked 不计）；结尾提示与「可续迭代」块共用此源，防 parked-only 场景两口径打架（攻击轮 C2）

  {
    if (ver.length) {
      console.log(`\n## 📌 待你验收（共 ${ver.length} 个）`);
      for (const t of ver) {
        // 敞口标记（v2.42.0，I16 同款判定）：已部署未合并 main——线上跑分支包，任何 main 构建部署将静默滚回（双包事故实证形态）
        let exposure = '';
        if (isGit && t.deploy?.deployedAt && t.branch) {
          const inMain = ['origin/main', 'main', 'master'].some((r) => isAnc(mainRoot, t.branch, r));
          if (!inMain) exposure = ` ⚠敞口${waitDaysNum(t)}天(main一部署即滚回)`;
        }
        console.log(`- ${t.id} ${trunc(t.title ?? '', 30)} — 等验收 ${waitDays(t)}${exposure} · 验收简报：node tf.mjs accept ${t.id}`);
      }
    }
    console.log(`\n## 登记任务（${all ? '全部' : 'active/verifying/parked'} 共 ${live.length} 个）`);
    if (!live.length) console.log('（无进行中的任务）');
    else {
      console.log('| 一级任务 | 二级任务（派生/链式） | 标题 | 目标 | 状态 | tier | 子任务 | 最后活跃 | checkpoint 摘要 |');
      console.log('|---|---|---|---|---|---|---|---|---|');
      // v2.45.1 双列层级（2026-10-09 用户看过树形实物后拍板"加一列区分"）：一级列=簇头（血缘根），二级列=派生任务
      // （深度≥2 加 · 前缀）；孤/根任务二级列=—；孤儿簇头一级列自带（源:xxx，已合并/已归档/不在档）标注——每行自足归属，
      // 替代 v2.44.0 缩进树+组头行（终端框线渲染下缩进视觉弱、组头行占位）；⛓<src> 保留（链式=合并/部署顺序约束）
      const liveById = new Map(live.map((t) => [t.id, t]));
      const byIdAll = new Map(tasks.map((t) => [t.id, t]));
      const srcOf = (t) => {
        if (t.derivedFrom) return t.derivedFrom;
        if (typeof t.baseBranch === 'string' && t.baseBranch.startsWith('task/')) return t.baseBranch.slice(5);
        return null;
      };
      const children = new Map();
      for (const t of live) {
        const s = srcOf(t);
        if (s && s !== t.id && liveById.has(s)) {
          if (!children.has(s)) children.set(s, []);
          children.get(s).push(t);
        }
      }
      const mounted = new Set([...children.values()].flat().map((t) => t.id));
      const roots = live.filter((t) => !mounted.has(t.id));
      const reached = new Set();
      const walk = (t, seen = new Set()) => {
        if (seen.has(t.id) || reached.has(t.id)) return;
        seen.add(t.id); reached.add(t.id);
        for (const c of children.get(t.id) ?? []) walk(c, seen);
      };
      for (const r of roots) walk(r);
      const cyclic = live.filter((t) => !reached.has(t.id)); // derivedFrom 成环的脏数据：降级平铺，不炸渲染
      const subMax = (t, seen = new Set()) => {
        if (seen.has(t.id)) return 0;
        seen.add(t.id);
        let m = Date.parse(t.lastActiveAt ?? 0);
        for (const c of children.get(t.id) ?? []) m = Math.max(m, subMax(c, seen));
        return m;
      };
      const rootsFinal = [...roots, ...cyclic].sort((a, b) => subMax(b) - subMax(a));
      const rowOf = (t, primary, secondary) => {
        const st = t.subtasks ?? [];
        const done = st.filter((s) => s.status === 'done').length;
        const cps = t.checkpoints ?? [];
        const lastCp = cps[cps.length - 1];
        const lastActive = t.lastActiveAt ?? index.find((e) => e.id === t.id)?.lastActiveAt;
        const stCell = t.status === 'parked' ? STATUS.parked : (isVerifying(t) ? `等验收(${waitDaysNum(t)}天)` : (STATUS[t.status] ?? t.status));
        const parkNote = t.status === 'parked' && t.parkedReason ? `（${trunc(t.parkedReason, 40)}）` : ''; // 并入状态列渲染：拼在行尾管道符后会被 GFM 渲染器当超额单元格整体丢弃（攻击轮 C3）
        const chain = typeof t.baseBranch === 'string' && t.baseBranch.startsWith('task/') ? ` ⛓${trunc(t.baseBranch.slice(5), 22)}` : '';
        console.log(
          `| ${primary} | ${secondary}${chain} | ${t.title ?? '—'} | ${t.goal ?? '—'} | ${stCell}${parkNote} | ${t.tier ?? '—'} | ` +
          `${st.length ? `${done}/${st.length}` : '—'} | ${relTime(lastActive)} | ${lastCp?.summary ?? '—'} |`
        );
      };
      const emit = (t, primarySelf, primaryKids, depth) => {
        rowOf(t, primarySelf, depth === 0 ? '—' : `${'· '.repeat(depth - 1)}${t.id}`);
        const kids = (children.get(t.id) ?? []).sort((a, b) => subMax(b) - subMax(a));
        for (const c of kids) emit(c, primaryKids, primaryKids, depth + 1);
      };
      for (const r of rootsFinal) {
        const src = srcOf(r);
        let primary = r.id;
        if (src && !liveById.has(src)) {
          const st = byIdAll.get(src)?.status;
          const stLabel = st === 'archived' ? '已归档' : st === 'merged' ? '已合并' : st ? (STATUS[st] ?? st) : '不在档';
          primary = `${r.id}（源:${trunc(src, 26)}，${stLabel}）`; // 源标注只挂簇头行，子行一级列用纯 id（防重复吃列宽）
        }
        emit(r, primary, r.id, 0);
      }
    }
    if (!all && mergedCount) console.log(`\n> 已合并归档 ${mergedCount} 个（不列出；--all 展开；住根层的可 node tf.mjs archive 归位）`);
    // 无活任务 + 有归档 → 可续迭代候选（status/resume 共用出口；纯机械，脚本保证在场）
    if (!liveCount && mergedCount) {
      const cands = tasks
        .filter((t) => t.status === 'merged' || t.status === 'archived')
        .sort((a, b) => Date.parse(b.mergedAt ?? b.lastActiveAt ?? 0) - Date.parse(a.mergedAt ?? a.lastActiveAt ?? 0))
        .slice(0, 3);
      console.log(`\n📌 可续迭代（复制任一句，开新会话直接粘贴）：`);
      for (const t of cands) console.log(`「@taskflow 继续 ${t.id} 的迭代，做<你的方向>」— ${trunc(t.title ?? '', 40)}`);
      console.log(`（全部 ${mergedCount} 条见 ls --all / scout <关键词>；接住入口句的路径见 resume.md 第 10 步）`);
    }

    const haveIds = new Set(tasks.map((t) => t.id));
    const ghost = index.filter((e) => e?.id && !haveIds.has(e.id));
    if (ghost.length) console.log(`\n⚠ index 登记 ${ghost.length} 个 task.json 缺失的任务（${ghost.map((e) => e.id).join('、')}）→ 跑 doctor 查看`);
  }

  if (isGit) {
    const strayActions = strays({ mainRoot, tasksDir, index, tasks }) ?? [];
    // v2.19.0 老化升级汇总：>7 天的挂起（等验收/无进展）与游离项收拢一处——时间压力成为机械事实，不再是均质提示
    const decisions = [];
    for (const t of live) {
      if (t.status === 'parked') continue; // 搁置=已拍板态（parkedReason 即决定），不进「需你决策」老化块
      const days = waitDaysNum(t);
      if (days > AGE_TIERS.warn) {
        const isDep = t.deploy?.status === 'verifying';
        decisions.push({ id: t.id, what: `${isDep ? '部署等验收' : 'active 无进展'} ${Math.floor(days)} 天`, hint: isDep ? `node tf.mjs accept ${t.id} 验收 / 打回` : '续做（resume）/ 挂起归档' });
      }
    }
    decisions.push(...strayActions);
    if (decisions.length) {
      console.log(`\n⛔ 需你决策（>7 天，逐项拍板，共 ${decisions.length} 项）：`);
      for (const d of decisions) console.log(`- ${d.id ? `${d.id} · ` : ''}${d.what} → ${d.hint}`);
    }
  }
  if (liveCount) console.log(ver.length
    ? '\n（↑ 先递「待你验收」清单（原样呈现、含逐条简报入口），再呈现上表问："继续哪个？"）'
    : '\n（↑ 把上表原样呈现给用户供其选择，然后问："继续哪个？"）');
  else if (live.length) console.log('\n（↑ 进行中任务均已搁置：parked 任务不续做——恢复跑 node tf.mjs unpark <task-id>（低影响可直接执行）；也可问是否新建）');
  else if (mergedCount) console.log('\n（↑ 无进行中任务：把「📌 可续迭代」入口句原样转述给用户——可直接复制；或问是否新建）');
  return 0;
}

/* 等验收挂起时长：deploy.deployedAt（若有）优先，否则 lastActiveAt。返回「N 天」/「<1 天」。
   数据源不新增字段（spec 拍板）：字段重复必漂移。 */
function waitDays(t) {
  const n = waitDaysNum(t);
  return n <= 0 ? '<1 天' : `${n} 天`;
}
function waitDaysNum(t) {
  const ts = Date.parse(t?.deploy?.deployedAt ?? t?.lastActiveAt ?? '');
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function strays({ mainRoot, tasksDir, index, tasks }) {
  const reg = new Set();
  for (const t of [...tasks, ...index]) {
    if (t?.worktree) { try { reg.add(path.resolve(t.worktree)); } catch {} }
    if (t?.branch) reg.add(String(t.branch));
  }
  // v2.53.0 兄弟子任务归父任务管（对抗审查实证误报收编）：子 worktree 命名 = <父worktree名>-<n>-<slug>（split.md），按父前缀登记；
  // 子分支 task/<id>/<n>-<slug> 按父分支前缀列出——两者都不再进游离清单（父已移除的子残留按游离处理属正确行为）
  for (const t of [...tasks, ...index]) {
    if (t?.worktree) {
      try {
        const wtp = path.resolve(t.worktree);
        const base = path.basename(wtp);
        for (const d of fs.readdirSync(path.dirname(wtp), { withFileTypes: true })) {
          if (d.isDirectory() && d.name.startsWith(base + '-')) reg.add(path.join(path.dirname(wtp), d.name));
        }
      } catch { /* 父目录不可读 → 前缀登记跳过，不影响其余检查 */ }
    }
    if (t?.branch) {
      const bl = git(['branch', '--list', String(t.branch) + '/*'], mainRoot, true);
      if (bl) for (const b of String(bl).split('\n').map((x) => x.trim().replace(/^\*?\s*/, '')).filter(Boolean)) reg.add(b);
    }
  }
  const ig = loadIgnores(tasksDir);
  const igged = (s) => ig.some((p) => matchIgnore(p, s));

  const items = [];
  const wtBranchNames = new Set();
  const wtNames = [];

  const wtOut = git(['worktree', 'list', '--porcelain'], mainRoot, true);
  if (wtOut) {
    for (const block of wtOut.split('\n\n').filter(Boolean)) {
      const w = Object.fromEntries(block.split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)]));
      const p = w.worktree;
      if (!p) continue;
      if (path.resolve(p) === path.resolve(mainRoot)) continue;
      if (reg.has(path.resolve(p))) continue;
      const name = path.basename(p);
      if (igged(name) || igged(p)) continue;
      if (w.branch) wtBranchNames.add(w.branch.replace('refs/heads/', ''));
      let dirty = 0, ct = null;
      const st = git(['-C', p, 'status', '--porcelain'], p, true);
      if (st) dirty = st.split('\n').filter(Boolean).length;
      const ctOut = git(['-C', p, 'log', '-1', '--format=%ct'], p, true);
      if (ctOut) ct = Number(ctOut);
      // 降噪：近 3 天有提交或改动才列（未提交改动=活工作，保留；干净且老旧=噪音）
      if (!dirty && (!ct || Date.now() / 1000 - ct > 3 * 86400)) continue;
      const when = ct ? relTime(new Date(ct * 1000).toISOString()) : '—';
      const br = w.branch ? w.branch.replace('refs/heads/', '') : '';
      wtNames.push(name);
      const ageD = ct ? (Date.now() / 1000 - ct) / 86400 : 0;
      const tier = ageTier(dirty ? Math.max(ageD, 0) : ageD);
      items.push({ kind: 'worktree', tier, text: `📁 worktree ${name}${br ? `（${br}）` : ''} · ${when}${dirty ? ` · 未提交 ${dirty} 文件` : ''}${tier !== 'info' ? ageMark(ageD) : ''}`, sortKey: ct ?? 0 });
    }
  }

  const brOut = git(['for-each-ref', '--sort=-committerdate', '--format=%(committerdate:unix)\t%(refname:short)', 'refs/heads'], mainRoot, true);
  if (brOut) {
    for (const line of brOut.split('\n').filter(Boolean)) {
      const [unix, name] = line.split('\t');
      if (!unix || !name) continue;
      if (Date.now() / 1000 - Number(unix) > 3 * 86400) break; // 按活跃度倒序，剩余更旧
      if (['main', 'master'].includes(name)) continue;
      if (/备份|稳定|-bak$|archive\//.test(name)) continue;
      if (reg.has(name) || wtBranchNames.has(name)) continue;
      if (igged(name)) continue;
      const ageD = (Date.now() / 1000 - Number(unix)) / 86400;
      const tier = ageTier(ageD);
      items.push({ kind: 'branch', tier, text: `🌿 分支 ${name} · ${relTime(new Date(Number(unix) * 1000).toISOString())}${tier !== 'info' ? ageMark(ageD) : ''}`, sortKey: Number(unix) });
    }
  }

  const planDir = path.join(os.homedir(), '.opencode', 'plan');
  if (fs.existsSync(planDir)) {
    const proj = path.basename(mainRoot);
    const files = fs.readdirSync(planDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => { const p = path.join(planDir, f); return { f, p, mt: fs.statSync(p).mtimeMs }; })
      .filter((o) => Date.now() - o.mt < 3 * 86400 * 1000)
      .sort((a, b) => b.mt - a.mt);
    for (const o of files) {
      if (igged(o.f)) continue;
      let head = '';
      try { head = fs.readFileSync(o.p, 'utf8').split('\n').slice(0, 40).join('\n'); } catch {}
      if (!head.includes(proj) && !head.includes(mainRoot)) continue;
      items.push({ kind: 'plan', text: `📄 计划交接文档 ~/.opencode/plan/${o.f} · ${relTime(new Date(o.mt).toISOString())}`, sortKey: o.mt / 1000 });
    }
  }

  items.sort((a, b) => b.sortKey - a.sortKey);
  console.log(`\n## 游离工作（未登记但近 3 天活跃 ${items.length} 项）`);
  if (!items.length) console.log('（无游离工作）');
  else {
    for (const it of items.slice(0, 8)) console.log(`- ${it.text}`);
    if (items.length > 8) console.log(`（上限 8 条，还有 ${items.length - 8} 条未列）`);
  }
  // v2.19.0 老化升级：action 级游离项上抛给 ls 汇总的「需你决策」块（判断与拍板仍归模型+人）
  return items.filter((it) => it.tier === 'action').map((it) => ({ id: '', what: it.text, hint: '收编（adopt）/ 清理 / 忽略，逐项拍板' }));
}

/* ---------------- 不变量注册表（代码侧唯一登记处） ----------------
   新增检查三步同一变更交付：①此表登记 ②data.md「不变量」表加行 ③doctor 实现体引用该 id。
   漏任何一步 = `doctor --self` 红灯（I7/I8 曾只活在代码里、data.md 没行——本表即防再犯）。 */
const INVARIANTS = [
  { id: 'I1', desc: 'index 与 task.json 一致（task.json 为准）' },
  { id: 'I2', desc: '分支 HEAD==最后非 merge 存档；merge 标记校验主 ref 历史' },
  { id: 'I3', desc: 'managed 任务 worktree 存在（attached worktree=null 正常态）' },
  { id: 'I4', desc: '.taskflow/ 不被 git 追踪' },
  { id: 'I5', desc: 'merged 任务：分支保留、managed worktree 已移除' },
  { id: 'I6', desc: 'active/verifying 分支包含基线与主干最新' },
  { id: 'I7', desc: 'bugfix 任务 diff 含测试改动（defect→test 门禁，仅 kind=bugfix）' },
  { id: 'I8', desc: '已完结任务住 archive/（活死分层，缺省体检可达）' },
  { id: 'I9', desc: 'activeLease 心跳新鲜=有会话在途（护栏非锁）' },
  { id: 'I10', desc: 'worktree 属主凭证 .owner.json + pid 活性' },
  { id: 'I11', desc: 'spec 承重节 hash==goalHash（需求变更必须过 req-confirm 留痕；勾选归一不误报）' },
  { id: 'I12', desc: '需求基线节 PRD 链接与锚点真实存在（无 PRD 豁免仅限 bugfix 任务或拍板留痕）' },
  { id: 'I13', desc: '已完结任务 reqChanges 晚于 PRD 最后提交=疑未回写（提示级）' },
  { id: 'I14', desc: 'services.json 服务端口租约对账（schema/端口唯一/pid 活性/task 存在性）' },
  { id: 'I15', desc: '根层幽灵目录对账：有内容、无 task.json、不在 index → 点名（提示级）' },
  { id: 'I16', desc: 'verifying 敞口：deploy 在档且分支∉main 超 24h → 红（线上跑分支包，main 构建部署将静默滚回）' },
  { id: 'I17', desc: '线上实况对账：live-state md5 vs 服务器实际 jar md5（jarProbe 实物探针优先，v2.64.0；ssh 只读；无 deploy 配置/ssh 不通=信息级跳过；本地触点版，CI/CD 到位后被流水线替代）' },
  { id: 'I18', desc: '（提示级；仅 active）账实对账：分支已并入 main=疑似漏收口；lastActiveAt≥14 天且 lease 过期=疑似搁置' },
];

/* ---------------- doctor --self：spec↔注册表↔实现 三源一致性 ----------------
   治「唯一 spec 名存实亡」：改代码忘回写 data.md（或反之）在提交时刻红灯，不等审查发现。
   --data <path> 可指 spec 副本（fixture 负例测试用）。 */
function selfCheck(args = []) {
  const dataIdx = args.indexOf('--data');
  const root = path.dirname(fileURLToPath(import.meta.url)); // <repo>/scripts
  const dataP = dataIdx >= 0 ? path.resolve(String(args[dataIdx + 1] ?? '')) : path.join(root, '..', 'references', 'data.md');
  let bad = 0;
  const dataIsFile = fs.existsSync(dataP) && fs.statSync(dataP).isFile();
  const docText = dataIsFile ? fs.readFileSync(dataP, 'utf8') : null;
  if (!docText) { console.log(`✗ self：找不到不变量 spec：${dataP}`); return 1; }
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  // doctor 实现体片段：行首锚定取真实函数定义（防命中本函数源码字符串里的 needle——两次实证）
  const implStart = src.search(/^function doctor\(/m);
  const implEnd = src.search(/^function ageTier\(/m);
  const impl = implStart >= 0 && implEnd > implStart ? src.slice(implStart, implEnd) : '';
  // v2.60.1 攻击轮加固（E 路 m1d 变异实证）：剥注释后再测——「只留注释、删尽可执行体」曾骗过三源一致
  const implCode = impl.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const docIds = [...docText.matchAll(/^\|\s*(I\d+)\s*\|/gm)].map((m) => m[1]);
  const codeIds = INVARIANTS.map((i) => i.id);
  for (const id of new Set([...codeIds, ...docIds])) {
    const inCode = codeIds.includes(id), inDoc = docIds.includes(id);
    // (?![0-9])：防 I10 的字面子串伪装成 I1 已实现
    const inImpl = inCode && new RegExp(id + '(?![0-9])').test(implCode);
    if (!inDoc) { console.log(`✗ self：${id} 已注册/实现但 data.md「不变量」表无此行 → 补 spec（唯一住处）`); bad++; }
    if (!inCode) { console.log(`✗ self：${id} 在 data.md 有行但未登记 INVARIANTS → 补代码侧注册表`); bad++; }
    if (inCode && !inImpl) { console.log(`✗ self：${id} 已注册但 doctor 实现体未引用 → 实现它或删注册`); bad++; }
  }
  const nums = codeIds.map((s) => Number(s.slice(1)));
  for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i - 1] + 1) { console.log(`✗ self：注册表跳号 ${codeIds[i - 1]} → ${codeIds[i]}`); bad++; }
  console.log(bad ? `self：${bad} 处 spec↔注册表↔实现 漂移（修 data.md 或 INVARIANTS，禁绕过）` : `✓ self：不变量 spec↔注册表↔实现 三源一致（${codeIds.length} 条；desc 为摘要不逐字比对——攻击轮 E3 注记）`);
  return bad ? 1 : 0;
}

/* ---------------- 需求承重节（REQ_BASELINE 对账数据源） ----------------
   specCoreHash：「目标」+「验收标准」两节的规范化 hash（[x]/[ ] 归一、strip 空行）——
   I11 比对数据；锚定=commit 首次落档，刷新唯一途径=req-confirm（需求变更门）。
   specSections：## 二级节切分（I12/I13 取「需求基线」节用）。 */
function specSections(specText) {
  const secs = {};
  let cur = null;
  for (const l of String(specText ?? '').split('\n')) {
    const h = l.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = h[1].trim(); continue; }
    if (cur) (secs[cur] = secs[cur] ?? []).push(l);
  }
  return secs;
}
function specCoreHash(specText) {
  const secs = specSections(specText);
  const grab = (name) => (secs[name] ?? []).map((l) => l.replace(/\[(x|X|\s)\]/g, '[ ]').trim()).filter(Boolean);
  const core = [...grab('目标'), ...grab('验收标准')];
  if (!core.length) return null; // 承重节皆缺 → I11 不适用（提示级）
  return crypto.createHash('sha1').update(core.join('\n')).digest('hex').slice(0, 12);
}

/* ---------------- doctor：按不变量逐条体检（级别与条件触发出处：data.md 不变量表；I7/I8/I9/I10/I13/I14 提示级或条件触发，I11/I12 红级条件触发） ---------------- */

function doctor(args = []) {
  if (args.includes('--self')) return selfCheck(args.filter((a) => a !== '--self'));
  const includeAll = args.includes('--all');
  const idArg = args.find((a) => !a.startsWith('--'));
  const { isGit, mainRoot, tasksDir } = locate();
  const index = readJson(path.join(tasksDir, 'index.json'))?.tasks ?? [];
  const allTasks = loadTasks(tasksDir);
  const crpt = corruptedReport('doctor');
  if (crpt) console.log(crpt);
  console.log(`# taskflow 体检`);
  console.log(`项目：${mainRoot}${isGit ? '' : '（非 git：仅 I1 可查）'}`);

  // v2.29.0 分层纪律：项目级检查（I4/I1 幽灵/I14/I15/采纳对账）无条件先跑，「无任何任务档案」只跳过任务级节——
  // 空项目恰是遗留租约/幽灵目录的高发态（项目收尾后账本比任务活得久），提前退出=盲区（2026-09-27 六缺陷之三）
  let projDirty = 0;   // 项目级发现（I4 / 幽灵登记 / I14 / 采纳对账）
  let dirtyTasks = 0;  // 检查范围内任务自己的差异 → 决定退出码

  // I4（项目级）：状态文件不被 git 追踪
  if (isGit) {
    const relTasks = path.relative(mainRoot, tasksDir).split(path.sep).join('/');
    const tracked = git(['-C', mainRoot, 'ls-files', relTasks], mainRoot, true);
    if (tracked) { console.log(`⚠ I4 ${relTasks}/ 被 git 追踪（${tracked.split('\n').filter(Boolean).length} 个文件）→ 补 .git/info/exclude + git rm -r --cached ${relTasks}`); projDirty++; }
    else console.log(`✓ I4 ${relTasks}/ 未被 git 追踪`);
  }

  const haveIds = new Set(allTasks.map((t) => t.id));
  const ghosts = index.filter((e) => e?.id && !haveIds.has(e.id));
  for (const e of ghosts) console.log(`⚠ I1 对账：index 登记的 ${e.id} 无 task.json → 清理 index 或补建档`);
  if (ghosts.length) projDirty++;

  // I14（项目级）：服务端口租约对账（services.json——schema/端口唯一/pid 活性/task 存在性）
  const svcDbPath = servicesPathOf(tasksDir);
  if (fs.existsSync(svcDbPath)) {
    const svcDb = readJson(svcDbPath);
    if (!svcDb || !Array.isArray(svcDb.services)) { console.log('⚠ I14 services.json schema 非法（缺 services 数组）→ 修 JSON（schema 唯一定义见 references/data.md「services.json」节）'); projDirty++; }
    else {
      const seenPort = new Set(); let svcBad = 0, svcHint = 0;
      const idSet = new Set(allTasks.map((t) => t.id));
      for (const s of svcDb.services) {
        if (!s || !Number.isInteger(s.port) || s.port <= 0 || !s.service) { console.log('⚠ I14 services.json 条目缺 port/service → 修 JSON'); svcBad++; continue; }
        if (seenPort.has(s.port)) { console.log(`⚠ I14 端口 :${s.port} 重复登记 → 清理重复行`); svcBad++; }
        seenPort.add(s.port);
        if (s.pid != null && !pidAlive(s.pid)) { console.log(`ℹ I14 :${s.port} ${s.service} pid=${s.pid} 已死 → stale 可回收（svc release，或重启服务后同端口重 claim）`); svcHint++; }
        if (s.task && !idSet.has(s.task)) { console.log(`ℹ I14 :${s.port} ${s.service} task=${s.task} 不在 index → orphan（任务已完结？认领或 svc release）`); svcHint++; }
      }
      if (svcBad) projDirty++;
      else if (svcHint) { /* 提示级不进退出码（同 I9/I10 哲学：可回收/认领，非账目差异） */ }
      else console.log(`✓ I14 服务租约在册且全活（${svcDb.services.length} 条）`);
    }
  }

  // I15（项目级，提示级，v2.29.0）：根层幽灵目录对账——有内容、无 task.json、不在 index（以磁盘为锚的反向对账，
  // 治 ls/doctor 双盲——2026-09-27 六缺陷之六，实证：某任务产物目录只有截图）
  {
    const idxIds = new Set(index.map((e) => e?.id).filter(Boolean));
    const skip = new Set(['archive', 'decisions']);
    let entries = []; try { entries = fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir, { withFileTypes: true }) : []; } catch { entries = []; }
    for (const d of entries) {
      if (!d.isDirectory() || d.name.startsWith('.') || skip.has(d.name)) continue;
      let hasTask = false; try { hasTask = fs.existsSync(path.join(tasksDir, d.name, 'task.json')); } catch {}
      if (idxIds.has(d.name) || hasTask) continue;
      let inner = []; try { inner = fs.readdirSync(path.join(tasksDir, d.name)).filter((f) => !f.startsWith('.')); } catch {}
      if (inner.length) console.log(`ℹ I15 幽灵目录 ${d.name}/（有内容但无 task.json 且不在 index）→ 认领建档 / 移 archive/ / 确认无用后删除（禁静默无视）`);
    }
  }

  // I17 线上实况对账（v2.42.0 本地触点版，项目级红级条件触发）：live-state 登记 md5 vs 服务器实际 jar md5
  //   ——治「漏登记部署/手工换包不可见」（历史修复包上线 8 天无登记无人知）。前提=project.json deploy 配置
  //   （server/jarPath 或 jarProbe）；ssh 不通/无配置=信息级跳过（通用项目零误报）。用户拍板 2026-10-08：不上服务器侧 cron，
  //   本项为本地触点尽力而为，CI/CD 到位后被流水线对账替代。
  //   jarProbe（v2.64.0）：实物 md5 探针（compose 容器内 jar）优先——jarPath 指向宿主机死文件时两死相抵假绿
  //   （2026-10-15 历史部署实证：record/I17 同读 systemd 遗留路径，遗留 md5 对遗留 md5 恒"一致"）。
  {
    const pjP17 = path.join(tasksDir, 'project.json');
    const dep17 = fs.existsSync(pjP17) ? (readJson(pjP17)?.deploy ?? null) : null;
    if (dep17?.server && (dep17.jarPath || dep17.jarProbe)) {
      let remote = '';
      let via = '';
      if (dep17.jarProbe) {
        try { remote = execFileSync('sh', ['-lc', dep17.jarProbe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }); via = '，jarProbe 实物探针'; } catch { /* 探针失败回退 jarPath */ }
      }
      if (!remote && dep17.jarPath) { try { remote = execFileSync('ssh', [dep17.server, `md5sum ${dep17.jarPath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }); } catch { /* ssh 不通 */ } }
      if (!remote) console.log('ℹ I17 实物/ssh 均不可达，跳过实况对账（本地触点版尽力而为；服务器侧定时对账属 CI/CD 终局）');
      else {
        const raw = remote.trim().split(/\s+/)[0] ?? '';
        const actual = /^[0-9a-f]{32}$/.test(raw) ? raw : '';
        if (!actual) console.log(`ℹ I17 取到的值非 md5（探针命令错/输出异常），跳过对账——先修 project.json deploy.jarProbe`);
        else {
        let base = '';
        try { base = String(execFileSync('ssh', [dep17.server, `cat ${dep17.statePath ?? '/opt/<app>/live-state.json'}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).match(/"md5"\s*:\s*"([0-9a-f]+)"/)?.[1] ?? ''); } catch { /* state 文件读不到 */ }
        if (base && base === actual) console.log(`✓ I17 实况对账一致（${actual.slice(0, 8)}${via}）`);
        else if (base) { console.log(`⚠ I17 线上漂移：实际 md5 ${actual.slice(0, 8)} ≠ 登记 ${base.slice(0, 8)}——未登记的部署/手工换包/登记取错文件；跑 deploy-preflight --record 补账（不登记的部署=下次对账必红）`); projDirty++; }
        else console.log('ℹ I17 live-state 无 jar.md5 登记（--record --jar-path 启用实况核验）');
        }
      }
    } else console.log('ℹ I17 无 project.json deploy 配置（server/jarPath 或 jarProbe），跳过实况对账——配置后启用');
  }

  // 采纳对账（项目级，红级，v2.29.0）：project.json.mechanisms 声明采纳的机制 ↔ 产物存在性——mech install 的账 doctor 来对。
  // v2.65.0：检测收敛到统一谓词 mechAdoptionRows（mech ls / mech check 同源），doctor 只保留消息渲染——检测逻辑禁止两份实现。
  {
    const pjP = path.join(tasksDir, 'project.json');
    const pj = fs.existsSync(pjP) ? readJson(pjP) : null;
    if (pj && pj.mechanisms && typeof pj.mechanisms === 'object') {
      for (const r of mechAdoptionRows({ mainRoot, pj }).filter((x) => x.declared)) {
        if (r.reason === '未登记') { console.log(`⚠ 采纳漂移：${r.token} 不在技能机制登记表（技能回退/登记手误）→ 升级技能或清 project.json.mechanisms 对应项`); projDirty++; continue; }
        if (r.reason === '产物缺失') { console.log(`⚠ 采纳漂移：${r.token} 已声明采纳但产物缺失（${r.missing.join('、')}）→ 重跑 node tf.mjs mech install ${r.token} 或清登记`); projDirty++; continue; }
        if (r.status === '漂移') { console.log(`⚠ 采纳漂移：${r.token} 快照版本不符（登记 v${r.installedVersion} ≠ 技能 v${r.currentVersion}）→ 重跑 node tf.mjs mech install ${r.token} 刷新（将覆盖文件清单先行，--yes 确认；若系技能被回退则升级技能或清登记）`); projDirty++; continue; }
        console.log(`✓ 采纳对齐：${r.token}（产物齐全${r.installedVersion ? `，v${r.installedVersion}` : ''}）`);
      }
    }
  }

  if (!allTasks.length && !index.length) { console.log('\n无任何任务档案（项目未初始化）。'); return projDirty ? 1 : 0; }

  let targets = allTasks;
  if (idArg) {
    targets = allTasks.filter((t) => t.id === idArg);
    if (!targets.length) { console.log(`\n未找到任务 ${idArg}（跑 ls 查看列表）`); return 1; }
  } else {
    // 缺省只查进行中任务；--all 纳入 merged——I5（归档清理检查）的唯一日常入口，否则它是死不变量
    targets = includeAll ? allTasks : allTasks.filter((t) => t.status === 'active' || t.status === 'verifying');
  }

  // I8 活死分层（提示级；独立于任务循环——**缺省体检也必须看到**：死任务住根层 = 归档没做完。
  // 实证 2026-09-19：某会话按旧流程清单走到 status=merged 就汇报「归档完成」，journal 平铺根层，
  // 而旧 I8 住在循环内被缺省筛选挡住 → 最常用体检里完全隐形。归层动作见 merge.md 第 8 步）
  const i8scope = idArg ? targets : allTasks;
  for (const t of i8scope) {
    if ((t.status === 'merged' || t.status === 'archived') && fs.existsSync(path.join(tasksDir, t.id))) {
      console.log(`ℹ I8 ${t.id} 已完结（${t.status}）未住 archive/ → node tf.mjs archive 批量归位（journal 三件套顺手归位）`);
    }
  }

  const mainRef = isGit ? ['origin/main', 'main', 'master'].find((r) => git(['-C', mainRoot, 'rev-parse', '--verify', r], mainRoot, true)) : null;

  for (const t of targets) {
    console.log(`\n## ${t.id}（${STATUS[t.status] ?? t.status}）${t.title ?? ''}`);
    let bad = 0;
    const idx = index.find((e) => e.id === t.id);

    // I1 对账
    if (!idx) { console.log('⚠ I1 对账：index 缺登记 → 以 task.json 回写 index'); bad++; }
    else for (const f of ['status', 'tier', 'sessionID', 'branch', 'worktree']) {
      const a = idx[f] ?? null, b = t[f] ?? null;
      let same = a === b;
      if (!same && a && b && f === 'worktree') { try { same = path.resolve(String(a)) === path.resolve(String(b)); } catch {} }
      if (!same) { console.log(`⚠ I1 对账：index.${f}=${a ?? '∅'} ≠ task.json.${f}=${b ?? '∅'} → 以 task.json 回写 index`); bad++; }
    }
    if (idx && bad === 0) console.log('✓ I1 对账一致');

    // I2 漏网 / 记录与代码一致（show-ref 区分「分支不存在(1)」与「git 异常(锁/权限)」，防误诊）
    const branch = t.branch ? String(t.branch) : null;
    const refSt = isGit && branch ? refStatus(mainRoot, `refs/heads/${branch}`) : null;
    const tip = refSt === 0 ? git(['-C', mainRoot, 'rev-parse', `refs/heads/${branch}`], mainRoot, true) : null;
    const cps = t.checkpoints ?? [];
    const typeOf = (c) => (c.type ?? 'checkpoint');
    const lastCp = [...cps].reverse().find((c) => c.commit && typeOf(c) !== 'merge');
    const mergeMarks = cps.filter((c) => c.commit && typeOf(c) === 'merge');
    if (isGit && branch && t.status !== 'merged') {
      if (refSt === 1) { console.log(`⚠ I2 分支不存在：${branch} → 列差异交用户取舍（被删？git reflog 可寻回 tip）`); bad++; }
      else if (refSt !== 0) { console.log(`⚠ I2 查询 ${branch} 时 git 异常（exit ${refSt}，疑锁/权限）→ 勿误诊为分支不存在，先查仓库状态`); bad++; }
      else if (!lastCp) console.log(`ℹ I2 无 checkpoint 记录，分支 tip ${tip.slice(0, 7)}`);
      else {
        const fwd = isAnc(mainRoot, lastCp.commit, tip);
        if (!fwd) {
          const back = isAnc(mainRoot, tip, lastCp.commit);
          console.log(back
            ? `⚠ I2 分支落后于最后存档（HEAD 被回退？）cp=${lastCp.commit} tip=${tip.slice(0, 7)} → 列差异交用户取舍`
            : `⚠ I2 checkpoint 不在分支历史（rebase 过？）cp=${lastCp.commit} → 列差异交用户取舍`);
          bad++;
        } else {
          const ahead = git(['-C', mainRoot, 'log', '--oneline', `${lastCp.commit}..${branch}`], mainRoot, true);
          if (ahead) {
            const list = ahead.split('\n').filter(Boolean);
            console.log(`⚠ I2 漏网 ${list.length} commit 未登记 → 补登 checkpoint（模型落笔）：`);
            for (const l of list.slice(0, 10)) console.log(`    ${l}`);
            bad++;
          } else console.log(`✓ I2 与最后存档一致（${lastCp.commit}）`);
        }
      }
      // 未提交改动（managed 且 worktree 在）
      if (t.anchor === 'managed' && t.worktree && fs.existsSync(t.worktree)) {
        const st = git(['-C', t.worktree, 'status', '--porcelain'], t.worktree, true);
        if (st) {
          const files = st.split('\n').filter(Boolean);
          console.log(`⚠ 未提交改动 ${files.length} 文件（${trunc(files.slice(0, 3).join('；'), 60)}）→ 列差异交用户取舍`);
          bad++;
        }
      }
      // merge 标记条目（type=merge）：不与任务分支 tip 对比，校验已在主 ref 历史（type 语义见 data.md）
      for (const m of mergeMarks) {
        const cShort = String(m.commit).slice(0, 7);
        const onMain = [mainRef, 'refs/remotes/origin/main', 'refs/heads/main', 'HEAD'].filter(Boolean).some((r) => isAnc(mainRoot, m.commit, r));
        if (onMain) console.log(`✓ I2 merge 标记 ${cShort} 已在主 ref 历史（不参与 tip 对比）`);
        else { console.log(`⚠ I2 merge 标记 ${cShort} 不在任何主 ref 历史 → 列差异交用户取舍`); bad++; }
      }
    }

    // I3 worktree 存在性（终态任务 worktree 缺失=归档清理到位，不误报；残留由 I5 判定）
    const terminal = t.status === 'merged' || t.status === 'archived';
    if (t.anchor === 'attached') console.log('✓ I3 attached 挂靠任务，worktree=null 是正常态');
    else if (terminal) { if (t.worktree && fs.existsSync(t.worktree)) console.log('ℹ I3 终态任务 worktree 仍在（是否残留由 I5 判定）'); else console.log('✓ I3 终态任务 worktree 已按归档清理'); }
    else if (t.worktree && fs.existsSync(t.worktree)) console.log('✓ I3 worktree 存在');
    else { console.log(`⚠ I3 worktree 丢失：${t.worktree ?? '未记录'} → 询问是否重建${t.status === 'verifying' ? '（verifying 期间尤其需要）' : ''}`); bad++; }

    // I5 归档清理（仅 merged；须 doctor --all 或点名才可达）
    if (t.status === 'merged') {
      let m = 0;
      if (isGit && branch && refSt === 1) { console.log(`⚠ I5 merged 分支被删除：${branch}（应保留作追溯；git reflog 可寻回 tip）`); bad++; m++; }
      else if (isGit && branch && refSt !== 0) { console.log(`⚠ I5 查询 ${branch} git 异常（exit ${refSt}）→ 勿误诊为已删`); bad++; m++; }
      if (t.anchor === 'managed' && t.worktree && fs.existsSync(t.worktree)) { console.log(`⚠ I5 managed worktree 残留未清理：${t.worktree}`); bad++; m++; }
      if (!m) console.log('✓ I5 归档清理到位');
    }

    // I6 基线（仅 active/verifying——merged/archived 产物已进主干，无 rebase 可言。
    //   v2.11.x 回归修复：原判断对 base=main 恒报警（mainRef 引入 origin/main 后 !== 守卫失效））
    if ((t.status === 'active' || t.status === 'verifying') && t.baseBranch && isGit && mainRef && branch) {
      const baseIn = isAnc(mainRoot, t.baseBranch, branch);
      const mainIn = isAnc(mainRoot, mainRef, branch);
      if (!baseIn) {
        // v2.19.0：落后量上机械分档（冲突税比日历更贴害处）——≤5 提交 ℹ / 6-15 ⚠ / >15 ⛔ 需决策
        // 落后 = 基线有而分支没有的提交：rev-list --count branch..base（方向：从 branch 看到 base 多出的）
        const behind = Number(git(['rev-list', '--count', `${branch}..${t.baseBranch}`], mainRoot, true) ?? NaN);
        console.log(`⚠ I6 基线 ${t.baseBranch} 不在任务分支历史 → 先 merge/rebase 基线再继续（落后 ${t.baseBranch} ${Number.isFinite(behind) ? behind : '?'} 个提交${behind > AGE_TIERS.warn ? ' ⛔ 需决策：冲突税高，rebase 前勿再堆功能' : behind > AGE_TIERS.info ? ' ⚠ 冲突税增长中' : ''}）`);
        bad++;
      } else if (!mainIn) {
        const behind = Number(git(['rev-list', '--count', `${branch}..${mainRef}`], mainRoot, true) ?? NaN);
        console.log(`⚠ I6 主干 ${mainRef} 有新提交未进本任务分支 → rebase 基线再继续（主干领先 ${Number.isFinite(behind) ? behind : '?'} 个提交${behind > AGE_TIERS.warn ? ' ⛔ 需决策：冲突税高' : behind > AGE_TIERS.info ? ' ⚠' : ''}）`);
        bad++;
      } else console.log('✓ I6 基线与主干均已包含于任务分支');
    }
    // I18 账实对账（提示级，v2.60.0，K8s reconcile 思想——level-triggered：resume 第 5 步 doctor 不可跳，对账每次会话自动发生）。
    //   攻击轮加固（v2.60.1，五路对抗审查实证）：①参与资格用 isVerifying()（顶层+deploy 双源，与 ls/📌块同口径——
    //   legacy「顶层 active + deploy.status=verifying」记录是等验收态，不得报漏收口）；②判据①与 accept --pass 前置
    //   同源 refs 集合（含 baseBranch——已合未推窗口/baseBranch 主干项目不漏报），且有 checkpoint 才报（零提交新任务
    //   分支==基线 tip，isAnc 自反恒真=误报面；r !== branch 排除 attached-on-main）。两判据均 ℹ 不计 bad。
    if (t.status === 'active' && !isVerifying(t)) {
      if (isGit && branch && (t.checkpoints ?? []).length > 0) {
        const mergeRefs = ['origin/main', 'main', 'master', t.baseBranch].filter(Boolean)
          .filter((r) => git(['-C', mainRoot, 'rev-parse', '--verify', r], mainRoot, true));
        const hit = mergeRefs.find((r) => r !== branch && isAnc(mainRoot, branch, r));
        // 证伪点（v2.70.0，J04）：归因「漏收口」前先证伪——unmergedAt 在档=回退已拍板（revert-plan 执行后落痕），
        // 禁再建议 accept --pass；progress 尾部打回/修复字样=修复在途，催收口会打断修线。
        if (hit) {
          let progTail = ''; try { progTail = fs.readFileSync(path.join(tasksDir, t.id, 'progress.md'), 'utf8').split('\n').slice(-20).join('\n'); } catch { /* 无 progress.md */ }
          const bounced = /打回|修复/.test(progTail);
          // v2.71.0 C1：两信号并存=「回退后修复在途」复合语义——旧 else-if 链让 unmergedAt 遮蔽打回/修复字样，
          //   只说「禁建议 accept」漏掉恢复开发指引；复合指引双面覆盖（勿催收口 + 恢复/重开流程）
          if (t.unmergedAt && bounced) console.log(`ℹ I18 ${t.id} 分支已并入 ${hit}，回退注记 unmergedAt 在档（${t.unmergedAt}）且 progress 尾部含打回/修复字样 → 复合信号（回退在档+打回修复在途）：勿建议 accept --pass（回退在档），勿催收口（修复在途）→ 明确恢复开发走完修复，或按 resume.md 重开流程后再走收口链（merge.md）`);
          else if (t.unmergedAt) console.log(`ℹ I18 ${t.id} 分支已并入 ${hit} 但状态仍 active，且回退注记 unmergedAt 在档（${t.unmergedAt}）→ 已回退注记在档，禁建议 accept --pass；续做按 resume.md 开新任务或明确恢复开发`);
          else if (bounced) console.log(`ℹ I18 ${t.id} 分支已并入 ${hit} 但 progress 尾部含打回/修复字样 → 疑似打回修复在途→恢复开发（勿催收口）`);
          else console.log(`ℹ I18 ${t.id} 分支已并入 ${hit} 但状态仍 active → 疑似漏收口：已验收则 accept --pass；续做则明确恢复开发（收口链见 merge.md）`);
        }
      }
      if (t.lastActiveAt) {
        const idleDays = (Date.now() - Date.parse(t.lastActiveAt)) / 86400000;
        const leaseLive = !!(t.activeLease?.heartbeatAt && (Date.now() - Date.parse(t.activeLease.heartbeatAt)) <= 30 * 60000);
        if (Number.isFinite(idleDays) && idleDays >= 14 && !leaseLive) {
          // 证伪点（v2.70.0，J05）：park 建议前先跑 I2 同款对照——分支存在未被 checkpoint 登记的提交=疑似在干活未存档
          // （「14 天没动静」可能只是没簿记不是没干活），先补登再判定搁置。
          const cps = (t.checkpoints ?? []).map((c) => c?.commit).filter(Boolean);
          let unreg = '';
          let mergedNoCp = '';
          if (isGit && branch) {
            if (cps.length) unreg = String(git(['rev-list', '--no-merges', '--count', `${cps[cps.length - 1]}..${branch}`], mainRoot, true) ?? '').trim();
            else {
              // v2.71.0 C2：零 checkpoint 先证伪「没干活」——分支已并入 main（排除 attached 自反）=漏收口嫌疑，
              //   park 建议是失明（把漏收口当搁置归档）；未并入才沿用 main..branch 独有提交数对照
              const mr2 = resolveMainRef(mainRoot);
              if (mr2 && branch !== mr2 && isAnc(mainRoot, branch, mr2)) mergedNoCp = mr2;
              else unreg = String(git(['rev-list', '--no-merges', '--count', `${mr2 ?? 'main'}..${branch}`], mainRoot, true) ?? '').trim(); // 零存档任务：分支独有提交都算未登记
            }
          }
          if (mergedNoCp) console.log(`ℹ I18 ${t.id} 已 ${Math.floor(idleDays)} 天无簿记动作且租约过期，但零 checkpoint 且分支已并入 ${mergedNoCp} → 疑似漏收口而非搁置（I18① 同款语义）：勿直接 park（掩盖漏收口）——已验收则 accept --pass 补收口，续做则明确恢复开发（收口链见 merge.md）`);
          else if (Number(unreg) > 0) console.log(`ℹ I18 ${t.id} 已 ${Math.floor(idleDays)} 天无簿记动作且租约过期，但分支有未登记 commit（${unreg} 笔）→ 疑似在干活未存档：先补登 checkpoint 再判定，勿直接 park`);
          else console.log(`ℹ I18 ${t.id} 已 ${Math.floor(idleDays)} 天无簿记动作且租约过期 → 疑似搁置：直接 park --reason 留档（可逆低影响，事后报告——v2.60.2 档位），或刷新续做`);
        }
      }
    }

    // I16 敞口（v2.42.0）：verifying 已部署未合并 main 超 24h——线上跑分支包，任何 main 构建部署将静默滚回。
    //   治「敞口静默」：双包事故两代实证（未合并已部署分支悬置=滚回倒计时），ls 待验收块同步 ⚠敞口 标记。
    if (t.status === 'verifying' && t.deploy?.deployedAt && isGit && t.branch) {
      const inMain = ['origin/main', 'main', 'master'].some((r) => isAnc(mainRoot, t.branch, r));
      const hrs = (Date.now() - Date.parse(t.deploy.deployedAt)) / 3600000;
      if (!inMain && hrs > 24) {
        console.log(`⚠ I16 敞口：${t.id} 已部署(${t.deploy.version ?? '?'})未合并 main ${Math.floor(hrs)}h——线上跑的是分支包，main 构建部署将静默滚回；收口链：merge main → main 重建替换包（node tf.mjs deploy --branch main）→ 验收 accept --pass（顺序勿反：accept 前置=已并入主分支）`);
        bad++;
      } else if (!inMain) console.log(`ℹ I16 已部署未合并 main ${Math.floor(hrs)}h（24h 容忍窗口内）`);
      else console.log('✓ I16 已部署内容已进 main（敞口关闭）');
    }

    // I7 defect→test 门禁（仅显式 kind=bugfix 的任务；缺省不打扰）
    if (t.kind === 'bugfix' && isGit && branch && refSt === 0) {
      const bBase = mainRef ? git(['merge-base', mainRef, branch], mainRoot, true) : null;
      const diffArr = bBase ? (git(['diff', '--name-only', `${bBase}..${branch}`], mainRoot, true) ?? '').split('\n').filter(Boolean) : [];
      const hasTest = diffArr.some((f) => /\/(test|tests|e2e|__tests__)\//i.test(f) || /(Test|Tests|Spec)\.java$/i.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(f)); // v2.57.1：补 [cm]? 认 .mjs/.cjs——本仓库自家测试即 tf.test.mjs，旧正则令 I7 对自家 bugfix 任务误红（收口时门禁自证）
      if (diffArr.length && !hasTest) { console.log('⚠ I7 bugfix 任务 diff 无测试改动 → defect→test 门禁：bug 必须固化为永久测试（testing.md §一/§六）'); bad++; }
      else if (hasTest) console.log('✓ I7 bugfix diff 含测试改动（defect→test 达标）');
      else console.log('ℹ I7 bugfix diff 为空（无改动可判）');
    }
    // （I8 已移至任务循环之外独立检查——缺省体检可达，见上方）
    // I9 会话租约（提示级：lease 让「他会在途」可见——它是护栏不是锁，最终裁决在对话确认）
    const lease = t.activeLease;
    if (lease?.heartbeatAt && (t.status === 'active' || t.status === 'verifying')) {
      const ageMin = Math.round((Date.now() - Date.parse(lease.heartbeatAt)) / 60000);
      if (Number.isFinite(ageMin) && ageMin <= 30) console.log(`ℹ I9 lease 活跃：会话 ${String(lease.sessionID ?? '?').slice(0, 14)}…，心跳 ${ageMin} 分钟前 → 他会在途，续做前核对`);
      else {
        // git 侧信道：代码作证——写动作必然留下 git 痕迹；并发冲突只来自写动作，
        // 光读不写的会话测不到也无害，因此侧信道理论完备（心跳失准不误杀真实活跃会话）
        let why = null;
        if (isGit && branch && refSt === 0) {
          const ct = Number(git(['log', '-1', '--format=%ct', `refs/heads/${branch}`], mainRoot, true));
          if (ct * 1000 > Date.parse(lease.heartbeatAt)) why = '分支 tip 晚于心跳';
          else if (t.worktree && fs.existsSync(t.worktree)) {
            const st = git(['-C', t.worktree, 'status', '--porcelain'], t.worktree, true);
            if (st) why = 'worktree 有未提交改动';
          }
        }
        if (why) console.log(`ℹ I9 lease 名义过期（${Number.isFinite(ageMin) ? ageMin : '?'} 分钟）但 ${why} → 实际活跃（代码作证），续做前核对`);
        else console.log(`ℹ I9 lease 已过期（${Number.isFinite(ageMin) ? ageMin : '?'} 分钟）→ 可接管，接管时刷新 activeLease`);
      }
    }
    // I10 worktree 属主三态（提示级）：.owner.json + pid 活性×started_at 双判据（superdx 借鉴；NEVER 删 foreign 是编排层纪律）
    if ((t.status === 'active' || t.status === 'verifying') && t.worktree && fs.existsSync(t.worktree)) {
      const ownerP = path.join(t.worktree, '.owner.json');
      if (!fs.existsSync(ownerP)) console.log('ℹ I10 worktree 无主（缺 .owner.json）→ 属主会话原子补写 {sessionID,pid,started_at}（conventions 三态：owned 可清/foreign 永不删/unowned 问用户）');
      else {
        let ow = null;
        try { ow = JSON.parse(fs.readFileSync(ownerP, 'utf8')); } catch {}
        if (!ow || !ow.pid) console.log('ℹ I10 .owner.json 缺失/损坏 → 属主会话重写');
        else if (!pidAlive(Number(ow.pid))) console.log(`ℹ I10 属主进程已死（pid ${ow.pid}）→ 大概率可接管：接管仪式改 sessionID + 重写 .owner.json`);
        else if (!ownerAlive(Number(ow.pid), typeof ow.started_at === 'string' ? ow.started_at : null)) console.log(`ℹ I10 pid 存活但启动时间与凭证不符（pid ${ow.pid} 复用嫌疑）→ 视为无主：接管仪式重写 .owner.json`);
        else console.log(`✓ I10 属主存活（pid ${ow.pid}${ow.started_at ? '，pid+started_at 双判据' : ''}）`);
      }
    }

    // I11 需求承重节对账（红级，v2.23.0）：spec 现算 hash vs goalHash——漂移必须留痕，无痕即红灯
    const specDir = fs.existsSync(path.join(tasksDir, t.id)) ? path.join(tasksDir, t.id) : path.join(tasksDir, 'archive', t.id); // 归档任务 spec 住 archive/（与 loadTasks 双层扫描、reqConfirm/commit 锚定同法，防归档假红死锁）
    const specP = path.join(specDir, 'spec.md');
    const specText = fs.existsSync(specP) ? fs.readFileSync(specP, 'utf8') : null;
    const coreHash = specText !== null ? specCoreHash(specText) : null;
    if (specText === null) {
      if (t.goalHash) { console.log('⚠ I11 spec.md 缺失但 goalHash 在档 → spec 被删/移动？恢复文件或 req-confirm 重锚'); bad++; }
    } else if (!coreHash) {
      console.log('ℹ I11 spec 无可解析承重节（「目标」「验收标准」皆缺）——需求不变量不适用，按模板补节');
    } else if (!t.goalHash) {
      console.log(`ℹ I11 需求基线未锚定（${(t.checkpoints ?? []).length ? '存量档案' : '首个 commit 自动锚定'}）→ 跑 node tf.mjs req-confirm ${t.id} --note "补锚" 补`);
    } else if (coreHash !== t.goalHash) {
      console.log(`⚠ I11 需求承重节自最后确认后被改（档 ${t.goalHash} ≠ 现 ${coreHash}）→ 需求变更门补确认（node tf.mjs req-confirm ${t.id} --note "…"）或回退 spec`);
      bad++;
    } else console.log('✓ I11 需求承重节与最后确认一致');

    // I12 需求基线链接核对（红级，v2.23.0）：基线节点名的 docs/prd 文件与锚点必须真实存在
    const baseSecLines = specText !== null ? (specSections(specText)['需求基线'] ?? null) : null;
    const baseLines = Array.isArray(baseSecLines) ? baseSecLines.join('\n') : null;
    if (specText !== null && baseSecLines === null) {
      console.log('ℹ I12 spec 无「需求基线」节（pre-v2.23 档案）→ 续迭代时补（无 PRD 也要显式注记）');
    } else if (baseLines !== null) {
      // 豁免注记优先（v2.23.1）：无 PRD + 拍板留痕（或 bugfix）= 豁免在案，注记内 docs 路径仅作语境不核链；
      // 链接语义 = 住址约定 docs/prd/（防 docs/ops 等语境提及被误抓成基线链接、目录误当条目）
      const links = [...baseLines.matchAll(/(docs\/prd\/[^\s`（）#，。；：]+)(?:#([^\s`（）)#，。；：]+))?/g)];
      const exempt = /无\s*PRD/.test(baseLines) && (t.kind === 'bugfix' || /(拍板|豁免)/.test(baseLines));
      if (exempt) console.log(`✓ I12 需求基线：无 PRD 豁免在案（${t.kind === 'bugfix' ? 'bugfix 任务' : '用户拍板豁免'}）${links.length ? `；注记另提 ${links.length} 处 docs/prd 路径（语境提及，不核链）` : ''}`);
      else if (!links.length && !/无\s*PRD/.test(baseLines)) { console.log('⚠ I12 需求基线节既无 PRD 链接也无「无 PRD」注记 → 补链接或显式注记（禁空节）'); bad++; }
      else if (!links.length && t.kind !== 'bugfix' && !/(拍板|豁免)/.test(baseLines)) {
        console.log('⚠ I12 无 PRD 注记缺拍板留痕 → 呈用户决定：补文档（新增需求禁豁免——原始需求必须可追溯，new-task.md 无 PRD 域引导）或注记「用户拍板豁免 <日期>：<原因>」（仅限 bug/排查/工程工具类）'); bad++;
      }
      else {
        let broken = 0;
        for (const [, file, anchor] of links) {
          const fp = [t.worktree, mainRoot].map((r) => (r ? path.join(r, file) : null)).find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile());
          if (!fp) { console.log(`⚠ I12 需求基线断链：${file} 不存在 → 修链接或补 PRD 条目`); broken++; continue; }
          if (anchor && !fs.readFileSync(fp, 'utf8').includes(anchor)) { console.log(`⚠ I12 需求基线锚点失效：${file}#${anchor} → 修锚点或回写条目`); broken++; }
        }
        if (broken) bad++;
        else if (links.length) console.log(`✓ I12 需求基线链接可达（${links.length} 条）`);
      }
    }

    // I13 PRD 回写新鲜度（提示级，仅已完结 + 有 reqChanges）：需求确认晚于 PRD 最后提交 → 疑未回写
    if ((t.status === 'merged' || t.status === 'archived') && Array.isArray(t.reqChanges) && t.reqChanges.length && baseLines) {
      const lastReq = t.reqChanges.map((r) => String(r?.ts ?? '')).sort().pop();
      const prdFiles = [...new Set([...baseLines.matchAll(/(docs\/prd\/[^\s`（）#，。；：]+)/g)].map((m) => m[1]))];
      for (const file of prdFiles) {
        const fp = [t.worktree, mainRoot].map((r) => (r ? path.join(r, file) : null)).find((p) => p && fs.existsSync(p));
        if (!fp) continue;
        const lastCommit = git(['-C', mainRoot, 'log', '-1', '--format=%cI', '--', file], mainRoot, true);
        const lr = Date.parse(lastReq), lc = Date.parse(lastCommit ?? '');
        if (lastCommit && Number.isFinite(lr) && Number.isFinite(lc) && lr > lc) console.log(`ℹ I13 ${file} 最后提交 ${lastCommit.slice(0, 10)} 早于最后需求确认 ${lastReq.slice(0, 10)} → PRD 疑未回写，人工核对`);
      }
    }

    console.log(`ℹ 最后活跃 ${relTime(t.lastActiveAt ?? idx?.lastActiveAt)} · 会话 ${t.sessionID ?? idx?.sessionID ?? '∅'}（非当前会话=有人接力过，续做前核对）`);
    console.log(bad ? `→ ${t.id}：${bad} 项差异` : `→ ${t.id}：全绿`);
    if (bad) dirtyTasks++;
  }

  console.log(`\n## 汇总`);
  const scope = idArg ? dirtyTasks : dirtyTasks + projDirty;
  if (idArg && projDirty) console.log(`ℹ 项目级另有 ${projDirty} 项提示（I4/幽灵登记），未计入本次单任务体检退出码。`);
  console.log(scope ? `有差异。修复动作（回写 / 补登 / 重建 / 清理）由编排层执行——本脚本只读。` : '全部全绿。');
  return scope ? 1 : 0;
}

/* ---------------- reconcile：对账修复（唯一写命令，最小集） ----------------
   I1 的机械回写归脚本（dry-run 先行、原子写、幂等）；损坏 JSON 与叙事内容仍归模型。 */

const SYNC_FIELDS = ['title', 'status', 'tier', 'branch', 'worktree', 'sessionID', 'lastActiveAt', 'lastCheckpointCommit', 'mergedAt'];

/* ---------------- 老化分档（v2.19.0）+ index 派生同步 ----------------
   老化三档：info ≤3 天 / warn ≤7 天 / action >7 天。facts 归脚本——分档只改呈现与汇总（⛔ 需决策块），
   绝不触发任何自动动作；拍板永远在人。I6 例外按落后提交数分档（冲突税比日历更贴害处）。 */
const AGE_TIERS = { info: 3, warn: 7 };
function ageTier(days) { return days <= AGE_TIERS.info ? 'info' : days <= AGE_TIERS.warn ? 'warn' : 'action'; }
function ageMark(days) { return ageTier(days) === 'info' ? '' : ageTier(days) === 'warn' ? ` ⚠${Math.floor(days)}天` : ` ⛔${Math.floor(days)}天需决策`; }

/* index 行派生同步（v2.19.0 单源收敛）：task.json 是唯一事实源，任何写路径落盘后调用本函数
   机械派生 index 行——「写后必同步」路径上漂移不可能发生（实证缺口：commit 回填 sessionID 只写
   task.json，lease-auto I1 漂移由此出生）。语义与 reconcile 回写一致：保留行内未知字段、原子写。 */
function syncIndexRow(tasksDir, t) {
  const indexPath = path.join(tasksDir, 'index.json');
  const j = readJson(indexPath);
  if (!j || !Array.isArray(j.tasks)) return; // 无 index（未初始化项目）→ 首次建档流程负责登记
  let row = j.tasks.find((e) => e?.id === t.id);
  if (!row) { row = { id: t.id, createdAt: t.createdAt ?? new Date().toISOString() }; j.tasks.unshift(row); }
  for (const f of SYNC_FIELDS) if (t[f] !== undefined) row[f] = t[f];
  if (row.lastCheckpointCommit === undefined) {
    const lc = [...(t.checkpoints ?? [])].reverse().find((c) => c.commit);
    if (lc) row.lastCheckpointCommit = lc.commit;
  }
  const tmpP = indexPath + '.tmp';
  fs.writeFileSync(tmpP, JSON.stringify(j, null, 2) + '\n');
  fs.renameSync(tmpP, indexPath);
}

function reconcile(args = []) {
  const fix = args.includes('--fix');
  const { tasksDir } = locate();
  const indexPath = path.join(tasksDir, 'index.json');
  const rows = readJson(indexPath)?.tasks;
  const tasks = loadTasks(tasksDir);
  const crpt = corruptedReport('reconcile');
  if (crpt) console.log(crpt);
  if (!rows) { console.log('⚠ index.json 缺失或不可解析 → 无法对账（首次初始化走 new-task 流程）'); return 1; }

  // 命令锁（--fix 时全程持有）：防两进程交错写 index；>60s 视为陈旧可强占；仅持锁者清理（dry-run 绝不触碰别人的锁）
  const lockDir = path.join(tasksDir, '.locks', 'reconcile');
  let lockAcquired = false;
  if (fix) {
    if (fs.existsSync(lockDir)) {
      let age = Infinity;
      try { age = Date.now() - Number(fs.readFileSync(path.join(lockDir, 'ts'), 'utf8') || 0); } catch {}
      if (age < 60000) { console.log(`⚠ 另一进程正在执行 reconcile（${Math.round(age / 1000)} 秒前启动）——稍后再试`); return 1; }
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, 'ts'), String(Date.now()));
    lockAcquired = true;
  }
  try {

  const sameField = (row, t, f) => {
    const a = row[f] ?? null, b = t[f] ?? null;
    if (a === b) return true;
    if (f === 'worktree' && a && b) { try { return path.resolve(String(a)) === path.resolve(String(b)); } catch {} }
    return false;
  };
  const derive = (t) => {
    const o = {};
    for (const f of SYNC_FIELDS) if (t[f] !== undefined) o[f] = t[f];
    if (o.lastCheckpointCommit === undefined) {
      const lc = [...(t.checkpoints ?? [])].reverse().find((c) => c.commit);
      if (lc) o.lastCheckpointCommit = lc.commit;
    }
    return o;
  };

  const plans = [];
  for (const t of tasks) {
    const row = rows.find((e) => e?.id === t.id);
    const vals = derive(t);
    if (!row) plans.push({ id: t.id, op: '补登记', vals });
    else {
      const diffs = SYNC_FIELDS.filter((f) => vals[f] !== undefined && !sameField(row, vals, f));
      if (diffs.length) plans.push({ id: t.id, op: '回写', diffs });
    }
  }
  const ghosts = rows.filter((e) => !tasks.some((t) => t.id === e?.id));
  const depHint = tasks.filter((t) => !t.baseBranch && /task\/[a-z0-9-]+/i.test(String(t.dependencies ?? '')));

  const hardIssues = plans.length || ghosts.length || CORRUPTED.length;
  if (!hardIssues) {
    if (depHint.length) for (const d of depHint) console.log(`ℹ ${d.id}：dependencies 提到 task/* 但缺 baseBranch 字段 → 建议补（I6 依赖它）`);
    console.log(`✓ 账目一致，无可修复项（幂等：重跑零动作）${depHint.length ? `；另含 ${depHint.length} 条 baseBranch 建议（不计入退出码）` : ''}`);
    return 0;
  }
  for (const p of plans) console.log(p.op === '补登记'
    ? `ℹ ${p.id}：index 缺登记 → 补行（${Object.keys(p.vals).join('/')}）`
    : `ℹ ${p.id}：回写 ${p.diffs.join('/')}（以 task.json 为准）`);
  for (const g of ghosts) console.log(`ℹ ${g?.id ?? '(无 id 行)'}：幽灵登记（无 task.json）→ 移除该行`);
  for (const d of depHint) console.log(`ℹ ${d.id}：dependencies 提到 task/* 但缺 baseBranch 字段 → 建议补（I6 依赖它）`);
  if (CORRUPTED.length) console.log('⚠ 损坏的 task.json 脚本不自动修（需人工/模型修 JSON）');
  if (!fix) { console.log('\ndry-run：以上为计划；加 --fix 执行回写（原子写：tmp+rename，重跑幂等）'); return 1; }

  // 执行：保留行内未知字段（note/deploy/createdAt…），只回写 SYNC_FIELDS / 补行 / 去幽灵
  const outRows = [];
  for (const t of tasks) {
    const vals = derive(t);
    const row = rows.find((e) => e?.id === t.id);
    if (row) { for (const f of SYNC_FIELDS) if (vals[f] !== undefined) row[f] = vals[f]; outRows.push(row); }
    else outRows.push({ id: t.id, createdAt: t.createdAt ?? new Date().toISOString(), ...vals });
  }
  const tmpP = indexPath + '.tmp';
  fs.writeFileSync(tmpP, JSON.stringify({ tasks: outRows }, null, 2) + '\n');
  fs.renameSync(tmpP, indexPath);
  if (!readJson(indexPath)) { console.log('⚠ 回写后校验失败：index.json 不可解析，请检查'); return 1; }
  console.log(`\n✓ 已回写 index.json（${plans.length} 项同步、${ghosts.length} 行幽灵移除、现存 ${outRows.length} 行）`);
  return CORRUPTED.length ? 1 : 0;
  } finally { if (lockAcquired) { try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch {} } }
}

/* ---------------- scout：历史检索（只读）——检索归脚本、判断归模型 ----------------
   开工前翻旧账：约定→决策库→任务档案→git 考古。命中=线索不是结论；
   信任分级/回归判定由模型读输出当场做（bug 先判 🔁 回归，禁直接再补丁——硬规则 9）。 */

function scout(args = []) {
  const files = [];
  const kws = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--files') { for (const f of String(args[i + 1] ?? '').split(',')) if (f.trim()) files.push(f.trim()); i++; }
    else if (args[i]) kws.push(args[i].trim());
  }
  if (!kws.length) { console.error('用法：node tf.mjs scout <关键词…> [--files f1,f2]（关键词取自任务标题/目标/痛点文件）'); return 1; }
  const uniqKws = [...new Set(kws)];
  const { isGit, mainRoot, tasksDir } = locate();
  const hit = (s) => uniqKws.some((k) => s.toLowerCase().includes(k.toLowerCase()));

  const sections = [];
  // ① conventions（约定/禁止事项/环境坑）
  const convHits = [];
  const convP = path.join(tasksDir, 'conventions.md');
  if (fs.existsSync(convP)) {
    fs.readFileSync(convP, 'utf8').split('\n').forEach((l, i) => { if (l.trim() && hit(l)) convHits.push(`conventions.md:${i + 1}: ${trunc(l.trim(), 80)}`); });
  }
  sections.push(['① conventions（约定/禁止事项/环境坑）', convHits]);
  // ② decisions（决策库；文件头含 ⛔ = 已被推翻，降信任）
  const decHits = [];
  const decDir = path.join(tasksDir, 'decisions');
  if (fs.existsSync(decDir)) {
    for (const f of fs.readdirSync(decDir).filter((x) => x.endsWith('.md')).sort()) {
      const p = path.join(decDir, f);
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      const overturned = lines.slice(0, 6).some((l) => l.includes('⛔'));
      lines.forEach((l, i) => { if (l.trim() && hit(l)) decHits.push(`${overturned ? '[⛔已推翻] ' : ''}decisions/${f}:${i + 1}: ${trunc(l.trim(), 80)}`); });
    }
  }
  sections.push(['② decisions（决策与被否决方案）', decHits]);
  // ③ 任务档案（全部任务含已归档：findings 踩坑 / handoff 否决表）
  const arcHits = [];
  if (fs.existsSync(tasksDir)) {
    for (const layer of [tasksDir, path.join(tasksDir, 'archive')]) { // 活死分层后归档任务住 archive/，照翻
      if (!fs.existsSync(layer)) continue;
      for (const d of fs.readdirSync(layer, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name === 'decisions') continue;
        for (const f of ['findings.md', 'handoff.md', 'journal/findings.md', 'journal/handoff.md']) {
          const p = path.join(layer, d.name, f);
          if (!fs.existsSync(p)) continue;
          fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (l.trim() && hit(l)) arcHits.push(`${d.name}/${f}:${i + 1}: ${trunc(l.trim(), 80)}`); });
        }
      }
    }
  }
  sections.push(['③ 任务档案（findings/handoff，含已归档）', arcHits]);
  // ④ git 考古（-S 拾取改动 / 提交消息匹配；--all 覆盖未合并分支）
  const gitHits = [];
  if (isGit) {
    for (const k of uniqKws) {
      const s = git(['log', `-S${k}`, '--oneline', '--all', ...files], mainRoot, true);
      if (s) for (const l of s.split('\n').filter(Boolean).slice(0, 5)) gitHits.push(`-S"${k}"：${trunc(l, 90)}`);
      const g = git(['log', `--grep=${k}`, '-i', '--oneline', '--all'], mainRoot, true);
      if (g) for (const l of g.split('\n').filter(Boolean).slice(0, 5)) gitHits.push(`消息含"${k}"：${trunc(l, 90)}`);
    }
  }
  sections.push(['④ git 考古（历史修点）', gitHits]);

  console.log(`# taskflow scout — ${uniqKws.join(' ')}${files.length ? `（--files ${files.join(',')}）` : ''}`);
  const CAP = 5;
  for (const [title, hitsArr] of sections) {
    if (!hitsArr.length) { console.log(`\n${title}\nℹ 无命中`); continue; }
    console.log(`\n${title}（命中 ${hitsArr.length}${hitsArr.length > CAP ? `，列前 ${CAP}` : ''}）`);
    for (const h of hitsArr.slice(0, CAP)) console.log(`- ${h}`);
  }
  console.log('\n提示：命中=线索不是结论——采纳前当场复核是否仍成立（🟢复核过/🟡带时点/🔴⛔已推翻）；');
  console.log('bug 任务先做回归判定：🔁 曾修过→先查复发原因（禁直接再补丁，硬规则 9）｜🆕 首次｜〜 相似可参考。');
  return 0;
}

/* ---------------- skills：领域技能在场检测（只读） ----------------
   换机/新环境：映射表需要的技能装没装，一测便知。缺 → 由模型把清单呈给用户
   选择安装哪些（网络安装，逐个确认后执行）；不装则如实注记「未经 XX 审查」。
   注册表 skills-registry.json 是数据文件，补安装源后永久生效。 */

function skillsCmd(args = []) {
  const regPath = process.env.TF_SKILLS_REGISTRY
    || path.join(path.dirname(new URL(import.meta.url).pathname), 'skills-registry.json');
  const reg = readJson(regPath);
  if (!reg || !Array.isArray(reg.skills)) { console.log(`⚠ 注册表缺失或不可解析：${regPath}`); return 1; }
  // --usage：技能加载埋点报表（v2.69.0，只读）——守门 T 模块写入的单文件聚合。
  // 左联注册表（零加载技能也在列）；按总次数升序（冷技能在前）。口径局限在尾行声明。
  if (args.includes('--usage')) {
    const file = process.env.TF_SKILL_USAGE || path.join(os.homedir(), '.omp', 'agent', 'skill-usage.jsonl');
    let rows = [];
    try {
      rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { /* 文件缺失=暂无数据 */ }
    if (!rows.length) { console.log(`暂无埋点数据（守门 T 模块未记录任何 skill:// 读取；埋点文件：${file}）`); return 0; }
    const now = Date.now(); const THIRTY = 30 * 86400000;
    const agg = new Map();
    for (const r of rows) {
      if (!r?.skill) continue;
      const a = agg.get(r.skill) ?? { total: 0, recent: 0, projects: new Set() };
      a.total++;
      if (r.ts && !Number.isNaN(Date.parse(r.ts)) && now - Date.parse(r.ts) <= THIRTY) a.recent++;
      if (r.project) a.projects.add(r.project);
      agg.set(r.skill, a);
    }
    const entries = new Map();
    for (const s of reg.skills ?? []) if (s?.id) entries.set(s.id, { total: 0, recent: 0, projects: new Set(), inReg: true });
    for (const [name, a] of agg) entries.set(name, { total: a.total, recent: a.recent, projects: a.projects, inReg: entries.has(name) });
    console.log('# taskflow 技能加载报表（skill:// 显式读取埋点）');
    const sorted = [...entries.entries()].sort((x, y) => x[1].total - y[1].total || x[0].localeCompare(y[0]));
    for (const [name, e] of sorted) {
      console.log(e.total
        ? `${name}：总 ${e.total}｜近 30 天 ${e.recent}｜项目 ${[...e.projects].sort().join('、')}`
        : `${name}：全文零加载（仅描述常驻）${e.inReg ? '' : '（注册表外）'}`);
    }
    console.log('\n口径：仅 omp 侧显式 skill:// 加载计数，不含描述常驻效果；Claude Code 侧不在统计内。');
    return 0;
  }
  const dirs = (process.env.TF_SKILL_DIRS
    || [path.join(os.homedir(), '.config/opencode/skills'), path.join(os.homedir(), '.agents/skills'),
       path.join(os.homedir(), '.claude/skills'), path.join(os.homedir(), '.omp/agent/skills'),
       path.join(os.homedir(), '.pi/agent/skills')].join(':'))
    .split(':').filter(Boolean);
  const installed = new Set();
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      try { if (fs.statSync(path.join(d, e.name)).isDirectory()) installed.add(e.name); } catch {}
    }
  }
  const want = reg.skills.filter((s) => s?.id && (!args.length || (s.domains ?? []).some((x) => args.includes(x))));
  if (!want.length) { console.log(`注册表中无匹配「${args.join(' ')}」领域的技能（共 ${reg.skills.length} 项，不带参数=全部；领域词须用注册表精确词如「前端UI」「测试」）——**无匹配 ≠ 依赖齐**：修正领域词重跑，仍无匹配按有缺处理（v2.53.0 对抗审查实证：旧版 exit 0 假绿，检测核心输入无兜底）`); return 1; }

  console.log('# taskflow 领域技能检测');
  console.log(`检索目录：${dirs.join(' : ')}`);
  const missing = [];
  for (const s of want) {
    const has = installed.has(s.id);
    console.log(`${has ? '✓' : '✗'} ${s.id}（${(s.domains ?? []).join('/')}）—— ${s.desc ?? ''}${has ? '' : s.install ? '' : '；安装源待补'}`);
    if (!has) missing.push(s);
  }
  if (!missing.length) { console.log(`\n✓ 领域技能全部就位（${want.length} 项）`); return 0; }
  console.log(`\n缺 ${missing.length} 个。把以下清单呈给用户选择安装哪些（网络安装，逐个确认后执行）：`);
  for (const s of missing) console.log(`  ${s.id}：${s.install || '（安装源待补——请提供仓库地址，填入 skills-registry.json 的 install 字段后永久生效）'}`);
  console.log('\n用户不装 → 该领域后续审查如实注记「未经 XX 审查」，不假装在。');
  const noInstall = (reg?.skills ?? []).filter((x) => x && x.id && !x.install);
  if (noInstall.length) console.log(`⚠ 登记纪律：注册表 ${noInstall.length} 项缺 install 地址（${noInstall.map((x) => x.id).join('、')}）——新技能入表必须带地址（公共技能=仓库 URL / 项目自有=「项目自有：<名>」），存量待补齐`);
  return 1;
}

/* ---------------- accept：验收简报（只读） ----------------
   部署后 / verifying 恢复时呈给用户：任务是什么、部署了什么、验什么、怎么验、怎么回复。
   素材：task.json（goal/deploy）+ spec.md「用户验收」节（优先——立项时以用户视角写好，
   部署后原样可执行）→ 回退验收标准 AC 列表（编排层翻译成操作路径再呈出）。
   触点：merge.md 部署完成后；resume.md 第 9 步（verifying 恢复＝注意力回来的那一刻）。 */

function extractSection(text, heading) {
  const out = [];
  let inSec = false;
  for (const l of text.split('\n')) {
    if (/^##\s/.test(l)) {
      if (inSec) break;
      inSec = l.includes(heading);
      continue;
    }
    if (inSec && l.trim()) out.push(l.trim());
  }
  return out;
}

function accept(idArg, args = []) {
  if (!idArg) { console.error('用法：node tf.mjs accept <task-id> [--pass]\n  缺省=打印验收简报（验什么/怎么验/怎么回复）；--pass=机械翻转 *→merged（状态机唯一写命令，禁手改 status）'); return 1; }
  const { tasksDir } = locate();
  const t = loadTasks(tasksDir).find((x) => x.id === idArg);
  if (!t) { console.log(`未找到任务 ${idArg}（跑 ls 查看列表）`); return 1; }
  if (args.includes('--pass')) return acceptPass(tasksDir, t);
  if (t.status !== 'verifying') console.log(`⚠ 状态为 ${STATUS[t.status] ?? t.status}——此为状态简报，非验收简报（验收翻转属 verifying 任务；merged/archived 续迭代走 scout <关键词>）`); // v2.29.0 状态门：简报身份先亮明，防「active 任务被当验收呈给用户」
  const specP = path.join(tasksDir, t.id, 'spec.md');
  const spec = fs.existsSync(specP) ? fs.readFileSync(specP, 'utf8') : '';
  const userSteps = extractSection(spec, '用户验收');
  const acs = extractSection(spec, '验收标准').filter((l) => /^-\s*\[[ x]\]/.test(l));
  if (!userSteps.length && !acs.length) {
    console.log(`⚠ ${t.id} 的 spec.md 无「用户验收」节也无验收标准 → 验收项无处提取，请先补 spec`);
    return 1;
  }
  console.log(`# 验收简报 — ${t.title}`);
  console.log(`任务：${t.id}（${STATUS[t.status] ?? t.status}）`);
  console.log(`\n## 这个任务是干嘛的\n${t.goal ?? '—'}`);
  console.log(`\n## 现在部署的状态`);
  if (t.deploy) console.log(`版本：${t.deploy.version ?? '—'}　冒烟：${t.deploy.smoke ?? '—'}　回滚点：${t.deploy.rollbackPoint ?? '—'}`);
  else console.log('（尚无 deploy 记录——已部署请补 task.json；未部署先走部署流程）');
  const items = userSteps.length ? userSteps : acs;
  console.log(`\n## 请验收以下 ${items.length} 项`);
  for (const l of items) console.log(l);
  if (userSteps.length) console.log('\n（以上来自 spec「用户验收」节，可直接照做）');
  else console.log('\n⚠ 以上是工程验收标准——编排层须逐条**翻译**成用户操作路径（打开哪个页面 → 做什么 → 预期看到什么）再呈出');
  console.log('\n## 怎么回复');
  console.log('- 全部符合 → 回复「验收通过」，任务才 merge 归档（完成定义）');
  console.log('- 任何一条不符 → 说明第几条 + 实际看到什么 → 回到修复循环（保持 verifying）');
  return 0;
}

/* ---------------- accept --pass：验收翻转（*→merged 的唯一写路径） ----------------
   状态机行见 data.md「状态机」；治「状态转换靠自觉」的合并侧补全（--deployed 治部署侧）。
   前置=任务分支已并入主分支（merged 语义=已合并+验收通过；verify-first 必须先合并再翻转，脚本强制）。 */
function acceptPass(tasksDir, t) {
  if (t.status === 'merged') {
    syncIndexRow(tasksDir, { ...t, status: 'merged' }); // 幂等重入顺手对账（index 被手改回 active 时自愈）
    console.log(`✓ ${t.id} 已是 merged（幂等，无动作）`);
    return 0;
  }
  if (t.status !== 'active' && t.status !== 'verifying') { console.log(`⚠ ${t.id} 状态 ${t.status}，不接受验收翻转（状态机见 data.md）`); return 1; }
  if (t.status === 'active') console.log('ℹ active 直接翻转：仅限无部署约定项目（有部署请先 commit --deployed 翻 verifying）');
  const { isGit, mainRoot } = locate();
  if (isGit && t.branch) {
    const mm = isMergedIntoMain(t, mainRoot);
    if (mm.merged === false) {
      console.log(`⚠ ${t.id} 分支未并入主分支（${mm.mainRefs.join('/')}）——verify-first 请先完成合并（merge.md 第 5 步）再翻转；merged 语义 = 已合并 + 验收通过`);
      return 1;
    }
  } else if (isGit && !t.branch) {
    console.log('ℹ 任务无分支记录（attached/非 git 工作流）——合并前置无法脚本校验，合并事实由编排层确认');
  }
  const p = path.join(tasksDir, t.id, 'task.json');
  const j = readJson(p);
  if (!j) { console.log('⚠ task.json 损坏 → 翻转中止（先修复档案）'); return 1; }
  assertTransition(t.status, 'merged', 'accept --pass'); // active→merged 与 verifying→merged 两行均覆盖
  j.status = 'merged';
  j.mergedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  syncIndexRow(tasksDir, j);
  appendEvent(tasksDir, { task: t.id, from: t.status, to: 'merged', cmd: 'accept --pass' });
  console.log(`✓ ${t.id}：${t.status} → merged（用户验收通过 ${j.mergedAt}）+ index 已同步`);
  console.log(`→ 归层：node tf.mjs archive ${t.id}（merge.md 第 8 步——状态同步 ≠ 归档完成，journal 三件套归位才算）`);
  if (t.deploy) {
    console.log(`⚠ 部署在档（${t.deploy.version ?? '?'}）——未合并的已部署分支悬置 = 滚回倒计时（双包事故实证），立即三件事收敞口：`);
    console.log(`  ① merge --no-ff ${t.branch ?? '<任务分支>'} 入 main（merge.md 第 5 步）  ② 从 main 重建替换包部署：node tf.mjs deploy --branch main  ③ --record 登记（deploy 入口自动完成）`);
  }
  return 0;
}

/* ---------------- takeover：接管仪式的机械部分 ----------------
   治死规则：LEASE/.owner.json/接管仪式曾有 schema+doctor 检查、零流程触点（2026-09-23 审查）。
   机械部分命令化（改 sessionID + 重写属主凭证 + 刷新 lease + 打印清点清单）；
   清点判断（未提交改动逐项过目）归编排层+人——清点完成前禁止 commit。 */
function takeover(args = []) {
  let id = null, session = '', pid = process.pid;
  for (let i = 0; i < args.length; i++) {
    if (!String(args[i]).startsWith('--') && !id) id = String(args[i]);
    else if (args[i] === '--session') session = String(args[++i] ?? '');
    else if (args[i] === '--pid') pid = Number(args[++i] ?? process.pid);
  }
  if (!id || !session) {
    console.error('用法：node tf.mjs takeover <task-id> --session <本会话ID> [--pid <进程号，缺省当前进程>] [--force]\n接管仪式：改 task.json sessionID + 重写 worktree/.owner.json + 刷新 LEASE + 打印桌面清点清单。\n清点（git status 逐项过目、认领或编辑文件丢弃——禁 reset --hard）归编排层，完成前禁 commit。\n--force：前任 lease 活跃且属主 pid 存活时的强接通道（默认拒——先与用户核对前任真停手）。');
    return 1;
  }
  if (session.startsWith('--')) { console.error('⚠ --session 缺值（下一个参数是 flag）——会话 ID 不可缺'); return 1; }
  const { tasksDir } = locate();
  const t = loadTasks(tasksDir).find((x) => x.id === id);
  if (!t) { console.log(`未找到任务 ${id}（跑 ls 查看列表）`); return 1; }
  if (t.status === 'parked') { console.log(`⚠ ${id} 已搁置（原因：${trunc(t.parkedReason ?? '—', 40)}）——非终态：恢复跑 node tf.mjs unpark ${id} 后再进接管（低影响可直接执行；攻击轮 C4：旧文案误称终态并指路新任务）`); return 1; }
  if (t.status !== 'active' && t.status !== 'verifying') { console.log(`⚠ ${id} 已是终态（${t.status}）——无可接管（续迭代走 resume.md 第 10 步新任务）`); return 1; }
  const p = path.join(tasksDir, t.id, 'task.json');
  const j = readJson(p);
  if (!j) { console.log('⚠ task.json 损坏 → 接管中止（先修复档案）'); return 1; }
  console.log(`# 接管仪式 — ${id}${t.title ? `（${t.title}）` : ''}`);
  if (t.sessionID) console.log(`前任属主：${t.sessionID}`);
  if (t.activeLease?.heartbeatAt) {
    const ageMin = Math.round((Date.now() - Date.parse(t.activeLease.heartbeatAt)) / 60000);
    console.log(Number.isFinite(ageMin)
      ? `lease：心跳 ${ageMin} 分钟前（${ageMin <= 30 ? '活跃——确认前任真停手再继续' : '已过期，可接管'}）`
      : 'lease：heartbeatAt 无法解析（损坏？）——按可接管处理，续做前与前任确认');
  }
  // v2.53.0 活跃前任守卫（对抗审查实证：旧版对 fresh lease 只打印告警仍无条件覆写属主）：lease 活跃 + .owner.json pid 存活 → 须 --force
  const force = args.includes('--force');
  if (!force && t.activeLease?.heartbeatAt) {
    const hbAge = (Date.now() - Date.parse(t.activeLease.heartbeatAt)) / 60000;
    let ownerAlive = false;
    try { const ow = JSON.parse(fs.readFileSync(path.join(t.worktree ?? '', '.owner.json'), 'utf8')); ownerAlive = Number.isFinite(ow?.pid) && pidAlive(ow.pid); } catch {}
    if (Number.isFinite(hbAge) && hbAge <= 30 && ownerAlive) {
      console.log(`⛔ 前任在途（lease 心跳 ${Math.round(hbAge)} 分钟前 + 属主 pid 存活）——先与用户核对前任真停手；确认强接加 --force（多会话互踩正是接管要防的场景）`);
      return 1;
    }
  }
  j.sessionID = session;
  j.activeLease = { sessionID: session, acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  syncIndexRow(tasksDir, j);
  console.log(`✓ 已接管：sessionID=${session}，LEASE 刷新，index 已同步`);
  if (t.worktree && fs.existsSync(t.worktree)) {
    try { fs.writeFileSync(path.join(t.worktree, '.owner.json'), JSON.stringify({ sessionID: session, pid, started_at: new Date().toISOString() })); console.log('✓ .owner.json 已重写（OWNER_JSON 属主凭证）'); }
    catch { console.log('⚠ .owner.json 写入失败（worktree 只读？）——接管仍生效，人工补写'); }
    const st = (git(['-C', t.worktree, 'status', '--porcelain'], t.worktree, true) ?? '');
    const lines = st.split('\n').filter(Boolean);
    console.log(`\n## 桌面清点清单（worktree：${t.worktree}）`);
    if (!lines.length) console.log('（工作区干净——无在途改动）');
    else {
      console.log(`未提交改动 ${lines.length} 项——逐项过目、认领或编辑文件丢弃（禁 reset --hard / clean -f）：`);
      for (const l of lines.slice(0, 20)) console.log('  ' + l);
      if (lines.length > 20) console.log(`  …还有 ${lines.length - 20} 项`);
    }
    console.log('\n清点完成前禁止 commit（commit --session 现以你为属主放行——那就是最后一道闸）。');
  } else {
    console.log('（无 worktree——attached 挂靠或未建，跳过属主凭证；attached 的用户目录零打扰原则不变）');
  }
  return 0;
}

/* ---------------- park / unpark：搁置簿记（PARK，v2.60.0）----------------
   治「先放放没有正式语义」：此前只能 active 悬挂（污染 G 门 live 计数、体检空跑）或硬归档。
   park = MQ DLQ 思想：带原因移出活队列，档案与分支全保留；unpark 即撤（删 parkedReason/parkedAt）。
   verifying 拒 park——线上敞口须先走收口链（merge.md 第 6-7 步），防 I16 语义冲突。 */
function parkCmd(args = []) {
  let id = null, reason = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--reason') reason = String(args[++i] ?? '');
    else if (!String(args[i]).startsWith('--') && !id) id = String(args[i]);
  }
  if (reason.startsWith('--')) { console.log('⚠ --reason 缺值（下一个参数是 flag，会被当原因吞）——搁置原因不可缺'); return 1; }
  if (!id || !reason.trim()) {
    console.log(id
      ? '⚠ 搁置必须留原因：park <id> --reason "..."（无原因的搁置=遗忘的温床；纯空格不算原因）'
      : '用法：node tf.mjs park <task-id> --reason "<原因>"\n搁置在途任务（active→parked，簿记写入口）——档案与分支保留，G 门/体检（缺省）/stale 不再盘点；恢复：unpark <task-id>。');
    return 1;
  }
  const { tasksDir } = locate();
  const t = loadTasks(tasksDir).find((x) => x.id === id);
  if (!t) { console.log(`未找到任务 ${id}（跑 ls 查看列表）`); return 1; }
  if (isVerifying(t)) { console.log('⚠ 等验收中（含部署态 verifying）任务有线上敞口语义，先走收口链（merge.md 第 6-7 步）再搁置（攻击轮 A1/C1：旧守卫只认顶层 status，dual-source 漂移态被放行）'); return 1; }
  if (t.status !== 'active') { console.log(`⚠ ${id} 状态 ${t.status}，不可搁置（park 仅 active→parked，状态机见 data.md）`); return 1; }
  if (t.activeLease?.heartbeatAt && (Date.now() - Date.parse(t.activeLease.heartbeatAt)) <= 30 * 60000) {
    console.log('ℹ lease 心跳新鲜（可能有会话在途）——编排层判断搁置、事后报告；在途会话续做时以档案为准，恢复走 unpark 对齐（攻击轮 A3，信息级不拦：park 可逆低影响，v2.60.2 拍板直接执行档）');
  }
  const p = path.join(tasksDir, t.id, 'task.json');
  const j = readJson(p);
  if (!j) { console.log('⚠ task.json 损坏 → 搁置中止（先修复档案）'); return 1; }
  const ts = new Date().toISOString();
  const safeReason = reason.replace(/[|\r\n]+/g, ' ').trim() || '—'; // 表格安全净化：ls 状态列渲染，竖线伪列/换行断行不入档（攻击轮 C3/主代理实跑实证）
  assertTransition(t.status, 'parked', 'park');
  j.status = 'parked';
  j.parkedReason = safeReason;
  j.parkedAt = ts;
  j.lastActiveAt = ts;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  syncIndexRow(tasksDir, j);
  appendEvent(tasksDir, { task: id, from: t.status, to: 'parked', cmd: 'park' });
  console.log(`✓ ${id} → parked（${safeReason}）——G 门/体检（缺省）不再盘点它；恢复：unpark ${id}`);
  return 0;
}
function unparkCmd(args = []) {
  const id = args.find((a) => !String(a).startsWith('--'));
  if (!id) { console.log('用法：node tf.mjs unpark <task-id>\n恢复搁置任务（parked→active，簿记写入口）。'); return 1; }
  const { tasksDir } = locate();
  const t = loadTasks(tasksDir).find((x) => x.id === id);
  if (!t) { console.log(`未找到任务 ${id}（跑 ls 查看列表）`); return 1; }
  if (t.status !== 'parked') { console.log(`⚠ ${id} 状态 ${t.status}，非搁置中（unpark 仅 parked→active，状态机见 data.md）`); return 1; }
  const p = path.join(tasksDir, t.id, 'task.json');
  const j = readJson(p);
  if (!j) { console.log('⚠ task.json 损坏 → 恢复中止（先修复档案）'); return 1; }
  delete j.parkedReason;
  delete j.parkedAt;
  assertTransition(t.status, 'active', 'unpark');
  j.status = 'active';
  j.lastActiveAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  syncIndexRow(tasksDir, j);
  appendEvent(tasksDir, { task: id, from: t.status, to: 'active', cmd: 'unpark' });
  console.log(`✓ ${id} → active（已恢复；lease 若过期续做前跑 takeover 语义核对）`);
  return 0;
}

/* deploy 记录镜像 + 部署事件驱动状态（v2.70.0 B2 → v2.71.0 F1/B1/F2/B2 重构）：deploy 入口自动 --record
   成功后定位目标任务并回写 task.json.deploy。定位优先级（治 B1：旧 filter(branch===部署分支) 会命中
   attached-on-main 任务、终态任务吞镜像、多任务静默跳过）：
   ①部署 commit 血统定位——分支 ⊆ 部署 commit 的任务（merge-first：任务分支已并入 main，部署 commit=main
     tip，分支自然 ⊆；verify-first：部署分支=任务分支，自反命中）——排除 branch===部署分支的 attached 任务；
   ②血统零命中回退唯一等验收（isVerifying）任务（老档案兼容）。
   命中即写 task.json.deploy{status:'verifying', deployedAt, version, rollbackPoint}（其余键保留）——部署事件
   即状态扳机（F1：merge-first 流程部署发生在 main 检出区，旧 commit --deployed 扳机解析不到任务→verifying
   永不触发→镜像永不落档；本写路径补上断链。旧扳机保留兼容 verify-first 老流程）。active→verifying 走
   assertTransition 白名单键 'commit --deployed'（同一「部署落定」转换，TRANSITIONS 行复用不新增）。
   version/rollbackPoint 从 live-state 镜像（record 显式写 rollbackPoint:'' 时兜底 jar.commit）。
   观测纪律（B2）：终态/parked 命中、多义、零命中、live-state 不可得——一律打 ⚠ 观测行不再全静默；
   镜像失败不阻断部署收尾（exit 仍 0），但无声跳过=accept 简报/revert-plan 缺真值而无人知。 */
function mirrorDeployRecord({ tasksDir, mainRoot, branch, stateFile, dep, deployCommit }) {
  const obs = (m) => console.log(`⚠ 部署记录镜像：${m}`);
  try {
    let raw = '';
    if (stateFile) raw = fs.readFileSync(stateFile, 'utf8');
    else if (dep?.server) raw = String(execFileSync('ssh', [dep.server, `cat ${dep.statePath ?? '/opt/<app>/live-state.json'}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }));
    const live = JSON.parse(raw);
    const jar = live?.jar ?? {};
    const ver = String(live?.version || jar.version || '').trim(); // 空串视同缺省（record 会显式写 rollbackPoint:''——?? 不跳空串，B2 夹具实证）
    const rb = String(live?.rollbackPoint || jar.rollbackPoint || jar.commit || '').trim();
    if (!ver && !rb) { obs('live-state 无 version/rollbackPoint 可镜像——跳过（accept 简报/revert-plan 将缺真值，人工补档）'); return; }
    const tasks = loadTasks(tasksDir);
    let t = null;
    const commit = String(deployCommit ?? '').trim();
    // attached 排除面（v2.71.0 B1/F2）：仅当部署分支是主干（main/master）时排除 branch===部署分支的任务——
    //   merge-first 部署 main 时 attached-on-main 任务是「无关档案」须排除；verify-first 部署分支=任务分支本身，
    //   自反命中是正命中，按名字一刀切会把 verify-first 误杀
    const attachedOnDeploy = (x) => (branch === 'main' || branch === 'master') && x.branch === branch;
    if (commit) {
      const lineage = tasks.filter((x) => x.branch && !attachedOnDeploy(x) && isAnc(mainRoot, x.branch, commit));
      const cands = lineage.filter((x) => x.status === 'active' || x.status === 'verifying');
      const terminal = lineage.filter((x) => x.status === 'merged' || x.status === 'archived');
      const parked = lineage.filter((x) => x.status === 'parked');
      if (cands.length === 1) t = cands[0];
      else if (cands.length > 1) { obs(`目标多义（${cands.map((x) => x.id).join('、')}）——不写（拒绝猜）；核对后人工补档`); return; }
      else if (terminal.length) { obs(`命中终态任务 ${terminal.map((x) => x.id).join('、')}（merged/archived 无验收可言）——不写`); return; }
      else if (parked.length) { obs(`命中搁置任务 ${parked.map((x) => x.id).join('、')}（parked 无验收语义）——不写`); return; }
    }
    if (!t) {
      const fb = tasks.filter((x) => isVerifying(x) && !attachedOnDeploy(x));
      if (fb.length === 1) t = fb[0];
      else if (fb.length > 1) { obs(`血统零命中且等验收任务多义（${fb.map((x) => x.id).join('、')}）——不写（拒绝猜）`); return; }
      else { obs(`无任务命中（部署分支 ${branch} 血统与等验收任务均未定位到目标）——跳过；若本次部署确属某任务，人工补 task.json.deploy`); return; }
    }
    const p = path.join(taskDirOf(tasksDir, t.id), 'task.json');
    const j = readJson(p);
    if (!j) { obs(`任务 ${t.id} task.json 不可读——跳过`); return; }
    const prevStatus = j.status;
    if (prevStatus !== 'active' && prevStatus !== 'verifying') { obs(`任务 ${t.id} 状态为 ${prevStatus ?? '?'}（非 active/verifying）——拒绝翻转，不写`); return; }
    if (prevStatus === 'active') assertTransition(prevStatus, 'verifying', 'commit --deployed');
    j.deploy = { ...(j.deploy ?? {}), status: 'verifying', deployedAt: new Date().toISOString() }; // 部署事件=真部署落定：deployedAt 随事件刷新（waitDaysNum/I16 敞口时钟源，与 commit --deployed「仅更新注记不重置」语义有意区分）
    if (ver) j.deploy.version = ver;
    if (rb) j.deploy.rollbackPoint = rb;
    if (prevStatus === 'active') j.status = 'verifying';
    j.lastActiveAt = new Date().toISOString();
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    syncIndexRow(tasksDir, j);
    if (prevStatus === 'active') {
      appendEvent(tasksDir, { task: t.id, from: prevStatus, to: 'verifying', cmd: 'deploy' });
      console.log(`✓ ${t.id} active → verifying（部署事件驱动，v2.71.0 F1）`);
    }
    console.log(`✓ 部署记录镜像：${t.id}.deploy ← live-state（version ${ver || '—'} / rollbackPoint ${rb || '—'}）`);
    if (prevStatus === 'active') console.log(`📌 待你验收：node tf.mjs accept ${t.id}`);
  } catch (e) { obs(`异常跳过（${e?.message ?? e}）——部署主流程不受影响，人工核对 task.json.deploy`); }
}
/* ---------------- deploy：部署唯一入口（v2.42.0 四件套①） ----------------
   治「门在但绕得过去」（2026-09-30 双包事故根因：血统门本可拦，部署会话没跑 preflight，
   且 preflight 不在项目部署确认清单里）：把 preflight 从"该跑的检测"变成部署路径的物理组成。
   流程：读 project.json deploy 配置 → lock deploy 互斥 → 预检（红=拒绝+并集建议；dry-run 至此）
   → 按配置逐条执行命令 → ssh 实测新包 md5 自动 --record 登记 → 提示签名册登记。
   绕过本入口的部署 = 漏登记 = I17 实况对账必红。部署命令各项目异构，全部收敛进配置（通用性）。 */
function deployCmd(args = []) {
  const branch = optArg(args, 'branch');
  const dryRun = args.includes('--dry-run');
  const webOnly = args.includes('--web-only');
  const version = optArg(args, 'version');
  const by = optArg(args, 'by') ?? 'tf-deploy';
  if (!branch) {
    console.error('用法：node tf.mjs deploy --branch <部署分支> [--web-only] [--dry-run] [--version V] [--by <执行者>]\n部署唯一入口：门禁（deploy-preflight）内嵌——红=拒绝执行；部署后自动 --record 登记。\njar 实物对账：project.json deploy.jarProbe（容器内 md5 探针，自带 ssh 前缀）优先于 jarPath。');
    return 1;
  }
  const { isGit, mainRoot, tasksDir } = locate();
  if (!isGit) { console.log('⚠ 非 git 项目不适用 deploy 入口'); return 1; }
  const dep = readJson(path.join(tasksDir, 'project.json'))?.deploy ?? null;
  if (!dep?.server || (!dep.jarPath && !dep.jarProbe) || !Array.isArray(dep.commands) || !dep.commands.length) {
    console.log('⚠ project.json 缺 deploy 配置——先配置再部署（各项目部署命令异构，全部收敛进配置）：');
    console.log(JSON.stringify({ deploy: {
      server: 'your-server', statePath: '/opt/<app>/live-state.json', jarPath: '/opt/<app>/app.jar',
      jarProbe: 'ssh <host> \'docker exec <容器> sh -c "md5sum /opt/app/app.jar"\'',
      commands: ['构建产物 → 拷贝服务器 → 备份旧包（app.jar.bak-<ts>）→ 替换 → systemctl restart <服务> → curl 探活'],
      webCommands: ['前端构建 → 拷贝 web 目录 → 探活（--web-only 时执行此组）'],
    } }, null, 2));
    return 1;
  }
  const pre = path.join(mainRoot, 'scripts', 'harness', 'deploy-preflight.mjs');
  if (!fs.existsSync(pre)) { console.log('⚠ 缺 scripts/harness/deploy-preflight.mjs（DEPLOY_GATE 未装）→ node tf.mjs mech install DEPLOY_GATE 后重试'); return 1; }
  // v2.66.0 部署分支防呆：commands 含 main 检出断言（branch --show-current … 'main'）的项目，部署命令锁死从
  // main 构建——--branch 传任务分支=静默空转（构建 main 同内容镜像，实物不变；2026-10-16
  // 误部署实证：镜像 tag/构建检出都取 main，实物 md5 对账才抓出）。拒绝并指引 merge-first（deploy-gate.md「部署分支语义」）。
  const branchCmds = webOnly ? dep.webCommands : dep.commands;
  const mainLocked = (branchCmds ?? []).some((c) => /branch --show-current[^']*'main'/.test(c));
  if (branch !== 'main' && mainLocked) {
    console.log(`⛔ 部署分支防呆：本项目 deploy commands 锁死从 main 构建（含 main 检出断言）——--branch ${branch} 会静默空转（构建 main 同内容镜像，实物不变）。先 merge 部署分支进 main（merge --no-ff，前置=merge 审查通过），再跑 deploy --branch main --version <V>（merge-first 流程，细则 references/deploy-gate.md「部署分支语义」）。`);
    return 1;
  }
  // ① lock deploy 互斥（部署全程窗口；失败/中止路径同样释放，ttl 1800 兜底孤儿锁）
  const lockRun = runSelf(['lock', 'deploy', '--ttl', '1800', '--by', by]);
  if (lockRun.status !== 0) { console.log(lockRun.stdout?.trim() || lockRun.stderr?.trim()); console.log('⛔ deploy 锁被占——另一部署在途，排队或稍后再试'); return 1; }
  const fin = (code) => { runSelf(['lock', 'deploy', '--release', '--by', by]); return code; };
  // ② 门禁内嵌：预检红=拒绝（并集优先建议由 preflight 自身打印）
  const pfArgs = [pre, '--branch', branch, ...(webOnly ? ['--web-only'] : []), '--server', dep.server, ...(dep.statePath ? ['--state-path', dep.statePath] : []), ...(dep.procProbe ? ['--proc-probe', dep.procProbe] : []), ...(dep.jarProbe ? ['--jar-probe', dep.jarProbe] : []), ...(optArg(args, 'state-file') ? ['--state-file', optArg(args, 'state-file')] : [])];
  const pf = execFileSyncNode(pfArgs, mainRoot);
  if (pf.stdout?.trim()) console.log(pf.stdout.trim());
  if (pf.stderr?.trim()) console.error(pf.stderr.trim());
  if (pf.status !== 0) { console.log('⛔ 预检红——deploy 入口拒绝部署（并集优先：先 merge 线上任务分支再构建；细则 references/deploy-gate.md）'); return fin(1); }
  // ③ dry-run：门禁绿即止，打印将执行的命令（v2.53.0 加固：--web-only 无 webCommands 拒绝回退——旧版静默跑整条 jar 链还称「jar 沿用基线」；配置了 webCommands 且未带 --web-only 时显式提醒防半部署）
  if (webOnly && !(Array.isArray(dep.webCommands) && dep.webCommands.length)) {
    console.log('⛔ --web-only 但 project.json 未配置 webCommands——拒绝静默回退 jar 链（旧版行为=重发后端还跳过登记）；先补 deploy.webCommands 配置再跑');
    return fin(1);
  }
  if (!webOnly && Array.isArray(dep.webCommands) && dep.webCommands.length) {
    console.log('⚠ 本次只跑 commands（jar 链）——项目配置了 webCommands，前端需另行 --web-only 跑一趟并核对服务器指纹（历史「jar 上了 web 没上」事故形态）');
  }
  // v2.54.0 commit 取值时机：部署锁已持有、命令未执行——并行合并窗口内 branch tip 可能前移，此刻取值才与实部署包一致（旧版 commands 跑完取=幽灵 commit 入基线）
  const deployCommit = String(git(['-C', mainRoot, 'rev-parse', '--short=7', branch], mainRoot, true) ?? '').trim();
  const cmds = webOnly ? dep.webCommands : dep.commands;
  if (dryRun) {
    console.log(`✓ dry-run：门禁绿，将执行 ${cmds.length} 条部署命令${webOnly ? '（web-only）' : ''}：`);
    for (const c of cmds) console.log(`  $ ${c}`);
    console.log('（去掉 --dry-run 实部署；部署后自动 --record 登记——web-only 除外：需手动 --record --web-only --web-version）');
    return fin(0);
  }
  // ④ 逐条执行（任一失败中止——回滚点应在 commands 内自带备份步骤）
  for (const c of cmds) {
    console.log(`$ ${c}`);
    const r = execFileSyncNode(['bash', '-lc', c], mainRoot, true);
    if (r.stdout?.trim()) console.log(r.stdout.trim());
    if (r.stderr?.trim()) console.error(r.stderr.trim());
    if (r.status !== 0) { console.log(`⛔ 部署命令失败（exit ${r.status}）——中止后续命令；排查后重试（备份/回滚点在命令序列内）`); return fin(1); }
  }
  // ⑤ 自动登记：ssh 实测新包 md5 + 分支 commit → preflight --record（漏登记=下次 I17 对账必红）
  //    md5 取实物优先（v2.64.0）：jarProbe 配了取探针输出（compose 容器内实物），否则回退 ssh jarPath。
  let md5 = '';
  if (dep.jarProbe) { try { md5 = String(execFileSync('sh', ['-lc', dep.jarProbe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim().split(/\s+/)[0] ?? ''); } catch { /* 探针失败回退 jarPath */ } }
  if (!md5) { try { md5 = String(execFileSync('ssh', [dep.server, `md5sum ${dep.jarPath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim().split(/\s+/)[0] ?? ''); } catch { /* ssh 失败留给 I17 对账点名 */ } }
  const commit = deployCommit;
  if (webOnly) {
    console.log('→ web-only：jar 沿用基线；--record --web-only 登记（--web-version 请按实际版本补跑或人工登记 web 指纹）');
  } else if (md5 && commit) {
    const rr = execFileSyncNode([pre, '--record', '--branch', branch, '--commit', commit, '--jar-md5', md5, '--jar-path', dep.jarPath, '--by', by, ...(version ? ['--version', version] : []), ...(dep.statePath ? ['--state-path', dep.statePath] : []), ...(optArg(args, 'state-file') ? ['--state-file', optArg(args, 'state-file')] : [])], mainRoot);
    if (rr.stdout?.trim()) console.log(rr.stdout.trim());
    if (rr.status !== 0) { console.log('⚠ 自动登记失败——人工补跑 deploy-preflight --record（不登记=下次对账必红）'); }
    else mirrorDeployRecord({ tasksDir, mainRoot, branch, stateFile: optArg(args, 'state-file'), dep, deployCommit }); // v2.71.0 F1/B1：血统定位目标任务 + 部署事件驱动状态（镜像/翻转同点实现）
  } else {
    console.log('⚠ 未能自动取 md5/commit——人工补跑 deploy-preflight --record --jar-md5 <md5> --commit <c>（不登记=下次对账必红）');
  }
  if (!version && !webOnly) console.log('ℹ 未传 --version：live-state.version 记为缺省（建议构建时显式传版本号，占号预检见 conventions 部署清单①）');
  // ⑥ 收尾提示：签名册与哨兵属项目侧收尾（编排层职责），冒烟按 conventions 验证清单
  console.log('→ 收尾三件（编排层）：签名册登记 docs/deployment/dist-signatures.md #N + 哨兵 grep + 冒烟（conventions 验证清单）——未做=审查红灯');
  return fin(0);
}

function optArg(args, k) { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; }
function runSelf(a) { try { const o = execFileSync('node', [fileURLToPath(import.meta.url), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return { status: 0, stdout: o, stderr: '' }; } catch (e) { return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; } }
function execFileSyncNode(argv, cwd, viaBash) {
  try {
    if (viaBash) { const o = execFileSync('bash', argv.slice(1), { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] }); return { status: 0, stdout: o, stderr: '' }; }
    const o = execFileSync('node', argv, { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] }); return { status: 0, stdout: o, stderr: '' };
  } catch (e) { return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
}

/* ---------------- lock：排队锁（关键窗口串行化） ----------------
   治唯一机器级互卡点：merge.md §5 竞态回环（两并行任务交错合并 → 互相触发重同步+重审，理论上无界追赶）。
   锁只管排队（他人在持锁中 → 拒绝；陈旧(>ttl) → 强占），判断归模型（拿到锁后该干嘛见 merge.md）。
   典型窗口=秒级端局（重同步检查+merge 落定），ttl 120s 覆盖；超时未释放会被后来者强占——锁不是真相源。 */
function lockCmd(args = []) {
  const name = args.find((a) => !String(a).startsWith('--'));
  let release = false, session = '', ttl = 120, force = false, taskId = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--release') release = true;
    else if (args[i] === '--session' || args[i] === '--by') session = String(args[++i] ?? ''); // --by=别名（deploy 入口自管锁用；旧版静默吞该参数——对抗审查实证持有者恒 unknown）
    else if (args[i] === '--ttl') ttl = Number(args[++i] ?? 120);
    else if (args[i] === '--force') force = true;
    else if (args[i] === '--task') taskId = String(args[++i] ?? '');
  }
  if (!name || /[\/\\]/.test(name) || name.startsWith('.')) {
    console.error('用法：node tf.mjs lock <name> [--release] [--session <会话ID>|--by <ID>] [--ttl <秒=120>] [--force]（name=merge 时必须 --task <任务id>——合并硬拦截）\n排队锁：merge.md §5 端局等关键窗口串行化。获取=原子占位（他人新鲜锁→拒绝排队；陈旧→强占并报告）；--release=释放（校验持有者，须 --session 且匹配；不符/未传须 --force）。锁在 .taskflow/.locks/<name>/。merge 锁授锁前现场重算三门（快照 fail-closed/越界/渲染证据——v2.81.0 起零消费落盘状态；无豁免旗标——未绿一律拒绝，恢复路径=按门指引修到全绿）。');
    return 1;
  }
  const { isGit, mainRoot, tasksDir } = locate();
  // v2.81.0 合并硬拦截 2.0（2026-10-27 对抗审查实证：.gate-state 落盘文件模型可写——伪造绿门即拿锁；
  // 裁决权收进授锁路径：三门纯函数现场重算，只读 git 事实与任务档案，零消费落盘状态——.gate-state 落盘机制随本版移除）
  if (name === 'merge' && !release) {
    if (!taskId) { console.log('⛔ merge 锁必须带 --task <任务id>（合并硬拦截）：授锁前现场重算三门（快照 fail-closed/越界/渲染证据），无豁免旗标。'); return 1; }
    if (!isGit) { console.log('⛔ merge 锁拒绝：非 git 项目无门可算（合并门读 git 事实）。'); return 1; }
    const t = loadTasks(tasksDir).find((x) => x.id === taskId);
    if (!t) { console.log(`⛔ merge 锁拒绝：任务不存在：${taskId}——先建档再进合并端局。`); return 1; }
    const mainRef = resolveMainRef(mainRoot);
    if (!mainRef) { console.log('⛔ merge 锁拒绝：主分支不可解析（main/master/origin/main 均无）。'); return 1; }
    const gates = [
      ['快照门', mergeGateSnapshot(t, mainRoot, mainRef)],
      ['越界门', mergeGateBoundary(t, mainRoot, mainRef)],
      ['渲染证据门', mergeGateEvidence(t, mainRoot, mainRef)],
    ];
    for (const [, g] of gates) for (const f of g.findings) console.log(f);
    const bad = gates.filter(([, g]) => g.red || g.yellow);
    if (bad.length) {
      console.log(`⛔ merge 锁拒绝：${taskId} ${bad.length} 门未绿（findings 见上）——按门指引修到全绿再重跑 lock；黄门=任务分支 git merge ${mainRef} 同步 + node tf.mjs snapshot ${taskId} 刷新快照后重跑。`);
      return 1;
    }
    console.log(`✓ 三门现场重算全绿：${gates.map(([nm, g]) => `${nm}=${g.reason}`).join('；')}——merge 端局准入`);
  }
  const lockDir = path.join(tasksDir, '.locks', name);
  const tsP = path.join(lockDir, 'ts'), sesP = path.join(lockDir, 'session'), ttlP = path.join(lockDir, 'ttl');
  if (release) {
    if (!fs.existsSync(lockDir)) { console.log(`ℹ ${name} 锁不存在（幂等释放）`); return 0; }
    const holder = fs.existsSync(sesP) ? fs.readFileSync(sesP, 'utf8').trim() : '';
    // v2.54.0 释放校验持有者（对抗审查：旧版任一会话可 rmSync 他人锁=端局裸奔）；holder=unknown 的旧锁向后兼容直接放
    if (holder && holder !== 'unknown' && holder !== session && !force) {
      console.log(`⛔ ${name} 锁持有者是 ${holder.slice(0, 14)}，你 = ${(session || '未声明').slice(0, 14)}——拒绝释放他人锁；确认强释加 --force（误释放=端局裸奔）`);
      return 1;
    }
    fs.rmSync(lockDir, { recursive: true, force: true });
    console.log(`✓ 已释放 ${name} 锁${holder && holder !== session && holder !== 'unknown' ? `（原持有者 ${holder.slice(0, 14)}，--force 强释）` : ''}`);
    return 0;
  }
  if (fs.existsSync(tsP)) {
    const age = (Date.now() - Number(fs.readFileSync(tsP, 'utf8'))) / 1000;
    const holder = fs.existsSync(sesP) ? fs.readFileSync(sesP, 'utf8').trim() : '?';
    const heldTtl = fs.existsSync(ttlP) ? (Number(fs.readFileSync(ttlP, 'utf8')) || ttl) : ttl; // v2.54.0 TTL 按持有者落盘值判（旧版用竞争者参数——A 拿 1800 / B 探测默认 120 即误判陈旧强占）
    if (Number.isFinite(age) && age < heldTtl) {
      console.log(`⚠ ${name} 锁被会话 ${(holder || '?').slice(0, 14)} 持有（${Math.round(age)}s 前，ttl ${heldTtl}s）→ 排队等候，勿并行合并（merge.md §5）`);
      return 1;
    }
    console.log(`ℹ ${name} 锁已陈旧（${Number.isFinite(age) ? Math.round(age) : '?'}s > ttl ${heldTtl}s）→ 强占（原持有者 ${(holder || '?').slice(0, 14)}）`);
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
  // v2.54.0 原子获取（对抗审查高危：旧 existsSync→mkdir 两步非原子，两会话毫秒级并发双抢均打「✓已获取」——MERGE_LOCK 在其唯一存在时刻互斥量为零）；mkdir 不带 recursive：已存在（含空目录）抛 EEXIST=竞争失败
  // v2.70.0 配套（B2 夹具实证）：.locks 父目录首次使用自举（recursive 只到父层）——新项目首把锁（deploy 入口自管 lock）曾 ENOENT 裸崩；叶子层仍非 recursive，原子竞争语义不变
  fs.mkdirSync(path.join(tasksDir, '.locks'), { recursive: true });
  try { fs.mkdirSync(lockDir); }
  catch (e) { if (e.code === 'EEXIST') { console.log(`⚠ ${name} 锁刚被他人抢先占位（原子竞争失败）→ 排队等候`); return 1; } throw e; }
  fs.writeFileSync(tsP, String(Date.now()));
  fs.writeFileSync(sesP, session || 'unknown');
  fs.writeFileSync(ttlP, String(ttl));
  console.log(`✓ 已获取 ${name} 锁（session=${(session || 'unknown').slice(0, 14)}，ttl ${ttl}s）→ 端局完成或中止后 --release --session <同ID>；超时未释放会被后来者强占`);
  return 0;
}

/* ---------------- 读写集解析器（任务级 MVCC 补全，v2.59.0）----------------
   parseWriteSet：spec「改动文件集合声明」行反引号路径集（写集——OCC 写集验证数据源；全部声明行都收：
     对抗实锤 RC3——双声明行只认首行=第二行文件对门一/门二不可见）；
   parseReadSet：spec「影响面地图」表格资产列（第 2 列）反引号路径集（读集——快照失效传播数据源；
     表格行以「影响面地图」标题行或模板形加粗标记行（**影响面地图（…）开、下一标题行止；
     代码围栏 ``` 内示例表不入集——对抗实锤 RC4：围栏表与段首加粗提及会吞无关表格致假红）；
     无反引号 = 空集不参与机读）；
   matchPath：精确相等，或声明项尾 / 目录前缀覆盖子孙（文件声明不当前缀——`src/a.ts` 不匹配 `src/a.ts.bak`）。
   normRel：`./`与`../`前缀链归一——对抗实锤 RC6：半截净化把 ../src/a.ts 变 /src/a.ts 与 src/a.ts 永不相遇。 */
const DECL_LINE_RE = /^\s*[-*]\s*\*\*改动文件集合声明\*\*\s*[：:]\s*(.+)$/gm; // 声明行唯一正则——parseWriteSet 与门二 declM 共用（审查自证加固⑤）；g 标志收全部声明行（对抗加固 RC3）
const normRel = (p) => String(p ?? '').replace(/^(?:[.]{1,2}[/])+/, ''); // ./ 与 ../ 前缀链归一（对抗加固 RC6；夹具先红实证首版 [./] 专形漏 ../——同类半截模式）
function parseWriteSet(specText) {
  const out = new Set();
  for (const m of String(specText ?? '').matchAll(DECL_LINE_RE)) {
    for (const x of m[1].matchAll(/`([^`]+)`/g)) { const p = normRel(x[1]); if (p) out.add(p); }
  }
  return [...out];
}
function parseReadSet(specText) {
  const out = new Set();
  let inMap = false;
  let inFence = false;
  for (const l of String(specText ?? '').split('\n')) {
    if (/^\s*```/.test(l)) { inFence = !inFence; inMap = false; continue; } // 代码围栏态：围栏内示例表不入集；围栏开启同时关表（对抗加固 RC4）
    if (inFence) continue;
    if (!inMap) {
      if (/^\s*(?:#{1,6}\s*影响面地图|\*\*影响面地图[（(])/.test(l)) inMap = true; // 标记行收紧：标题行或模板形加粗（紧跟括号）——段首加粗提及「**影响面地图**的更新」不再开表（对抗加固 RC4）
      continue;
    }
    if (/^#{1,6}\s/.test(l)) { inMap = false; continue; } // 下一标题关表
    if (l.trim() && !/^\|/.test(l)) { inMap = false; continue; } // 表格连续性：非空非表格行关表——真表后的段首加粗提及+假表不再被吞（对抗加固 RC4 夹具先红实证）
    if (!/^\|/.test(l)) continue; // 空行：表内分隔，不关不收
    const asset = (l.split('|').map((c) => c.trim()))[2] ?? ''; // 第 2 列=资产列；表头/分隔行无反引号自然空
    for (const m of asset.matchAll(/`([^`]+)`/g)) { const p = normRel(m[1]); if (p) out.add(p); }
  }
  return [...out];
}
function matchPath(file, declaredSet) {
  const f = normRel(file);
  for (const d of declaredSet) {
    const p = normRel(d);
    if (p === f || (p.endsWith('/') && (f + '/').startsWith(p))) return true;
  }
  return false;
}

/* ---------------- snapshot / mergegate：合并三门（MERGE_GATE，v2.58.0；门一文件级分类 v2.59.0；渲染证据门 v2.81.0 升授锁硬门）----------------
   快照门：审查呈报后拍 main 快照（事务 ID 类比），mergegate 比对——无快照=红（v2.81.0 fail-closed：2026-10-27 对抗
   审查 A2 实证「无快照放行」被省略 snapshot 利用）；main 前移时按文件级分类：
     前移变更 × 任务读写集（matchPath）无交集 = 黄（免重审放行：同步合并+刷新快照，用户拍板 2026-10-11）、
     有交集 = 红（命中读写集逐文件重审）；读写集均无机读声明 = 无法分类按红（禁静默放行）；
   越界门：分支 diff 文件集对照 spec「改动文件集合声明」（matchPath：目录声明尾 / 覆盖子孙），超集 = 红。
   渲染证据门：diff 触及样式载体而 attachments 无渲染证据 = 红（v2.81.0 与双门同为纯函数）。
   黄红都计入红（exit 1）保住「三门全绿才进 lock」；TOCTOU 收敛接线：mergegate → lock（现场重算三门）→ merge。 */
function snapshotCmd(args = []) {
  const id = args.find((a) => !String(a).startsWith('--'));
  if (!id) { console.error('用法：node tf.mjs snapshot <task-id>\n审查呈报落稿后拍 main 快照：当前主分支 HEAD 哈希写入 task.json.mergeSnapshot（mergegate 合并前比对——main 挪了=红灯回同步重审）。'); return 1; }
  const { isGit, mainRoot, tasksDir } = locate();
  if (!isGit) { console.error('⚠ 非 git 项目无快照可拍'); return 1; }
  const mainRef = ['main', 'master', 'origin/main'].find((r) => git(['-C', mainRoot, 'rev-parse', '--verify', r], mainRoot, true)); // v2.58.0 本地优先：合并动作落本地 main——origin 滞后（已合未推）时 origin 优先会把门拍瞎（dogfood 自证）；doctor:657 为祖先判定场景、语义不同注记不动
  if (!mainRef) { console.error('⚠ 主分支不可解析（origin/main、main、master 均无）'); return 1; }
  const t = loadTasks(tasksDir).find((x) => x.id === id);
  if (!t) { console.error(`⚠ 任务不存在：${id}`); return 1; }
  const head = git(['-C', mainRoot, 'rev-parse', mainRef], mainRoot, true);
  if (!head) { console.error('⚠ HEAD 解析失败'); return 1; }
  const dir = fs.existsSync(path.join(tasksDir, id)) ? path.join(tasksDir, id) : path.join(tasksDir, 'archive', id);
  const tp = path.join(dir, 'task.json');
  const j = readJson(tp) ?? {};
  j.mergeSnapshot = { commit: head, ts: new Date().toISOString(), mainRef };
  fs.writeFileSync(tp, JSON.stringify(j, null, 2) + '\n');
  t.mergeSnapshot = j.mergeSnapshot;
  syncIndexRow(tasksDir, t);
  console.log(`✓ 快照已拍：${mainRef} @ ${head.slice(0, 7)} → task.json.mergeSnapshot（合并前跑 node tf.mjs mergegate ${id} 比对）`);
  return 0;
}

// 合并双门（v2.69.0 抽取为纯函数：mergegateCmd 渲染 + gates 聚合共用，输出串逐字保留）
function mergeGateSnapshot(t, mainRoot, mainRef) {
  const g = { red: false, yellow: false, findings: [], reason: '' };
  const head = git(['-C', mainRoot, 'rev-parse', mainRef], mainRoot, true);
  const dir = taskDirOf(tasksDirUnder(mainRoot), t.id);
  const specP = path.join(dir, 'spec.md');
  const specText = fs.existsSync(specP) ? fs.readFileSync(specP, 'utf8') : '';
  const writeSet = parseWriteSet(specText);
  const readSet = parseReadSet(specText);
  // 门一：快照（MVCC 事务 ID 比对——审查时快照 vs 合并时现值；v2.59.0 文件级分类黄/红两路）
  const snap = t.mergeSnapshot;
  if (!snap?.commit) {
    g.findings.push(`⛔ 快照门红：无快照在档——审查呈报后先跑 node tf.mjs snapshot ${t.id} 再过门（fail-closed，2026-10-27 对抗审查 A2 实证 fail-open 被省略利用）`);
    g.red = true;
    g.reason = '无快照在档（fail-closed，先 snapshot 再过门）';
  } else if (snap.commit !== head) {
    const changedOut = git(['-C', mainRoot, '-c', 'core.quotePath=false', 'diff', '--no-renames', '--name-only', `${snap.commit}..${mainRef}`], mainRoot, true); // 对抗加固 RC1/RC2：--no-renames 重命名双名都进清单（旧名命中→红）；quotePath=false 非 ASCII 路径不转义（中文文件名可匹配）
    if (changedOut === null) { // 审查自证加固④：diff 失败（快照 commit 不可达/历史改写）禁按空清单分类放行
      g.findings.push(`⛔ 快照门红：git diff ${String(snap.commit).slice(0, 7)}..${mainRef} 失败（快照 commit 不可达 / main 历史被改写？）→ 人工核对 main 历史，禁按空变更清单分类放行`);
      g.red = true;
      g.reason = '快照 diff 失败（commit 不可达/历史改写？）';
    } else {
      const changedFiles = changedOut.split('\n').filter(Boolean);
      const rw = [...new Set([...writeSet, ...readSet])];
      if (!readSet.length) g.findings.push('ℹ 影响面地图无机读路径（资产列须反引号），分类仅对写集生效');
      if (!rw.length) {
        g.findings.push(`⛔ 快照门红：审查时 ${snap.mainRef ?? 'main'} @ ${String(snap.commit).slice(0, 7)}，现在 ${mainRef} @ ${head.slice(0, 7)}——main 在审查后前移且 spec 无反引号读写集声明（改动文件集合声明+影响面地图资产列均无），无法分类 → 按模板补声明再过本门（禁静默放行）；补齐后回 merge.md 第 1 步：任务分支 git merge ${mainRef} 解冲突，实质变化重跑第 3 步审查，完成后 node tf.mjs snapshot ${t.id} 刷新快照再过本门`);
        g.red = true;
        g.reason = 'main 前移且 spec 无读写集声明，无法分类';
      } else {
        const overlap = changedFiles.filter((f) => matchPath(f, rw));
        if (overlap.length) {
          g.findings.push(`⛔ 快照门红：审查时 ${snap.mainRef ?? 'main'} @ ${String(snap.commit).slice(0, 7)}，现在 ${mainRef} @ ${head.slice(0, 7)}——main 在审查后前移（他人已合入），对着旧基线审的 diff 不能直接合。命中读写集：${overlap.join('、')}——重跑第 3 步审查时逐文件核对 spec 影响面地图对应行 → 回 merge.md 第 1 步：任务分支 git merge ${mainRef} 解冲突，实质变化重跑第 3 步审查，完成后 node tf.mjs snapshot ${t.id} 刷新快照再过本门`);
          g.red = true;
          g.reason = `main 前移命中读写集（${overlap.length} 文件）`;
        } else {
          g.findings.push(`⚠ 快照门黄：main 前移但未触碰本任务读写集——变更清单如下（过目）：${changedFiles.join('、')}——同步合并（任务分支 git merge ${mainRef}）+ node tf.mjs snapshot ${t.id} 刷新快照再过本门，免 merge.md 第 3 步重审（用户拍板 2026-10-11）`);
          g.red = true; // 黄红都计入红（exit 1）——保住「双绿才进 lock」；黄路刷新快照后幂等秒过
          g.yellow = true;
          g.reason = 'main 前移未触碰读写集（同步合并+刷新快照免重审）';
        }
      }
    }
  } else {
    g.findings.push(`✓ 快照门绿：${mainRef} @ ${head.slice(0, 7)} 与审查快照一致`);
    g.reason = '与审查快照一致';
  }
  return g;
}
function mergeGateBoundary(t, mainRoot, mainRef) {
  const g = { red: false, yellow: false, findings: [], reason: '' };
  const dir = taskDirOf(tasksDirUnder(mainRoot), t.id);
  const specP = path.join(dir, 'spec.md');
  const specText = fs.existsSync(specP) ? fs.readFileSync(specP, 'utf8') : '';
  const writeSet = parseWriteSet(specText);
  // 门二：越界（diff 文件集 ⊆ spec 声明集——治「改 A 没回归带坏 B」；v2.59.0 matchPath 化：目录声明尾 / 覆盖子孙——旧精确匹配下声明 src/auth/ 而 diff 含 src/auth/login.ts 必误红）
  const branch = t.branch ? String(t.branch) : null;
  if (branch && git(['-C', mainRoot, 'rev-parse', '--verify', `refs/heads/${branch}`], mainRoot, true)) {
    const bBase = git(['-C', mainRoot, 'merge-base', mainRef, branch], mainRoot, true);
    const diffFiles = (git(['-C', mainRoot, '-c', 'core.quotePath=false', 'diff', '--no-renames', '--name-only', `${bBase}..${branch}`], mainRoot, true) ?? '').split('\n').filter(Boolean); // 对抗加固 RC1/RC2：重命名双名入清单+非 ASCII 不转义
    const declM = specText.match(DECL_LINE_RE); // 审查自证加固⑤：与 parseWriteSet 共用唯一正则（消双份静默分叉）
    if (!declM) {
      g.findings.push('⛔ 越界门红：spec 无「改动文件集合声明」行 → 按模板补节（templates/spec.md「边界与影响面」），把本任务会动的文件用反引号列全再过本门');
      g.red = true;
      g.reason = 'spec 无「改动文件集合声明」行';
    } else if (!writeSet.length) {
      g.findings.push('⛔ 越界门红：声明行在但无反引号路径（解析为空 = 全量误报，dogfood 自证）→ 每个文件路径用反引号包住（如 `src/a.ts` 或目录 `src/auth/`）再过本门');
      g.red = true;
      g.reason = '声明行在但无反引号路径';
    } else {
      const extras = diffFiles.filter((f) => !matchPath(f, writeSet));
      if (extras.length) {
        g.findings.push(`⛔ 越界门红：分支 diff 含声明集外文件 → ${extras.join('、')}。二选一：确属本任务范围 → spec 声明行补上（格式：每个文件路径用反引号包住，如 \`src/a.ts\` 或目录 \`src/auth/\`——matchPath：目录声明尾 / 覆盖子孙）+ node tf.mjs req-confirm ${t.id} --note "范围变更" 落痕；不属 → 收窄 diff（多余改动拆出另立任务）`);
        g.red = true;
        g.reason = `diff 含声明集外文件（${extras.length} 个）`;
      } else {
        g.findings.push(`✓ 越界门绿：diff ${diffFiles.length} 文件全在声明集内（声明 ${writeSet.length} 项，matchPath 含目录前缀）`);
        g.reason = `diff ${diffFiles.length} 文件全在声明集内`;
      }
    }
  } else {
    g.findings.push('ℹ 越界门：分支不存在/未登记 → 跳过（无 diff 可比）');
    g.reason = '分支不存在/未登记，跳过';
  }
  return g;
}
// 渲染证据门（v2.81.0 抽取为纯函数，与双门同形 {red,yellow,findings,reason}）：lock merge 授锁路径现场重算——
// 2026-10-27 对抗审查实证：哨兵只挂 validate-changelog 收尾链可被「省略步骤」绕过。机械门治偷懒不治语义：
// 证据质量归哨兵 bash 层与人工过目，本门只保证「无渲染证据不得进合并端局」。
function mergeGateEvidence(t, mainRoot, mainRef) {
  const g = { red: false, yellow: false, findings: [], reason: '' };
  const branch = t.branch ? String(t.branch) : null;
  const verified = branch ? git(['-C', mainRoot, 'rev-parse', '--verify', `refs/heads/${branch}`], mainRoot, true) : null;
  const bBase = verified ? git(['-C', mainRoot, 'merge-base', mainRef, branch], mainRoot, true) : null; // merge-base 失败=N/A 放行（与越界门对无分支的容忍口径一致）
  if (!bBase) {
    g.findings.push('ℹ 渲染证据门：分支不存在/未登记 → 跳过（无 diff 可查）');
    g.reason = '分支不存在/未登记，跳过';
    return g;
  }
  // 样式载体=通用规则（.vue 内容命中 <style/@media 行，或任意 .css/.scss/.less 文件级变更）——项目级精细规则（styles 目录等）归哨兵 bash 层，两层并存
  const styleHits = (git(['-C', mainRoot, '-c', 'core.quotePath=false', 'diff', '--no-renames', `${bBase}..${branch}`, '--', '*.vue'], mainRoot, true) ?? '')
    .split('\n').filter((l) => /^[+-].*(<style|@media)/.test(l)).length;
  const cssFiles = (git(['-C', mainRoot, '-c', 'core.quotePath=false', 'diff', '--no-renames', '--name-only', `${bBase}..${branch}`], mainRoot, true) ?? '')
    .split('\n').filter(Boolean).filter((f) => /\.(css|scss|less)$/i.test(f));
  if (!styleHits && !cssFiles.length) {
    g.findings.push('✓ 渲染证据门：diff 无样式载体（.vue 的 <style>/@media 零命中、无 .css/.scss/.less 变更）');
    g.reason = '无样式载体变更';
    return g;
  }
  // 证据=attachments/ 有图片，或 md/json 记录前 4000 字符含实证关键词（截图/量测/render）
  const attDir = path.join(taskDirOf(tasksDirUnder(mainRoot), t.id), 'attachments');
  let ev = '';
  if (fs.existsSync(attDir)) {
    const img = fs.readdirSync(attDir).find((f) => /\.(png|jpe?g|webp)$/i.test(f));
    if (img) {
      ev = `图片 ${img}`;
    } else {
      for (const f of fs.readdirSync(attDir)) {
        if (!/\.(md|json)$/i.test(f)) continue;
        const txt = fs.readFileSync(path.join(attDir, f), 'utf8').slice(0, 4000);
        if (/截图|量测|render/.test(txt)) { ev = `记录 ${f}`; break; }
      }
    }
  }
  if (!ev) {
    g.findings.push('⛔ 渲染证据门红：diff 触及样式载体（.vue 的 <style>/@media 或 .css/.scss/.less 文件）但任务 attachments/ 无渲染证据——补数据态真实渲染截图+可见内容采样描述至 attachments/（图片 *.png/*.jpg/*.jpeg/*.webp，或 *.md/*.json 记录含「截图/量测/render」）再过本门');
    g.red = true;
    g.reason = '样式载体变更无渲染证据';
  } else {
    g.findings.push(`✓ 渲染证据门绿：样式载体变更有渲染证据（${ev}）`);
    g.reason = `有渲染证据（${ev}）`;
  }
  return g;
}
function mergegateCmd(args = []) {
  const id = args.find((a) => !String(a).startsWith('--'));
  if (!id) { console.error('用法：node tf.mjs mergegate <task-id>\n合并三门（MERGE_GATE）：①快照门（文件级分类）——无快照=红（fail-closed，v2.81.0）；main 现值 ≠ 审查快照时比对「main 变更 × 任务读写集」：命中=红（逐文件重审），未触碰=黄（同步合并+刷新快照免重审）；②越界门——分支 diff 文件超出 spec「改动文件集合声明」= 红（req-confirm 补声明或收窄 diff）；③渲染证据门——diff 触及样式载体而 attachments/ 无渲染证据 = 红（补数据态真实渲染截图+采样描述）。黄红均 exit 1；红灯不改任何状态、不落任何门状态文件（lock 授锁路径现场重算三门）。'); return 1; }
  const { isGit, mainRoot, tasksDir } = locate();
  if (!isGit) { console.error('⚠ 非 git 项目无门可跑'); return 1; }
  const t = loadTasks(tasksDir).find((x) => x.id === id);
  if (!t) { console.error(`⚠ 任务不存在：${id}`); return 1; }
  const mainRef = resolveMainRef(mainRoot);
  if (!mainRef) { console.error('⚠ 主分支不可解析'); return 1; }
  const snap = mergeGateSnapshot(t, mainRoot, mainRef);
  const bound = mergeGateBoundary(t, mainRoot, mainRef);
  const evid = mergeGateEvidence(t, mainRoot, mainRef);
  for (const f of snap.findings) console.log(f);
  for (const f of bound.findings) console.log(f);
  for (const f of evid.findings) console.log(f);
  const red = (snap.red ? 1 : 0) + (bound.red ? 1 : 0) + (evid.red ? 1 : 0);
  console.log(red ? `\nmergegate：${red} 门红——按上面指引处理后重跑（三门全绿才进 lock → mergegate 复跑 → merge --no-ff，merge.md 第 5 步）` : '\nmergegate：三门全绿——可进 lock → merge --no-ff（merge.md 第 5 步；lock 会现场重算三门，不消费任何落盘门状态）');
  return red ? 1 : 0;
}

/* ---------------- stale / overlap：在途失效感知 + 并行准入预检（v2.59.0）----------------
   stale（STALE_CHECK）：main 自任务基线 baseCommit 的改动 × 本任务读写集求交——非空 = 影响面漂移
     （重验 spec 影响面地图对应行再动工）。只读不改任何状态；无 baseCommit（存量任务）ℹ 跳过；
     无 id 全量扫 active/verifying。
   overlap（DISPATCH_OVERLAP）：读 subtasks/<n>/spec.md「## 涉及文件」反引号路径两两 matchPath 求交——
     重叠对 = 场景① 并行前提（写集两两不相交）不满足。只读；无子任务 ℹ exit 0。 */
// stale 单任务检查（v2.69.0 抽取：staleCmd 与 gates 共用）——state: skip|drift|fresh|undeclared
function staleCheck(t, mainRoot, mainRef, tasksDir) {
  if (!t.baseCommit) return { state: 'skip', line: `ℹ ${t.id} 无基线锚（存量任务，v2.59.0 前建档）跳过` };
  // 审查自证必修①：分支已并入 main 的任务跳过——自身 diff ⊆ 写集（门二保证）且落入 baseCommit..main 区间，
  // 全量扫（merge.md 第 5 步合并落定后）对刚合并任务必报假阳性漂移、淹没真信号。
  if (t.branch && isAnc(mainRoot, t.branch, mainRef)) return { state: 'skip', line: `ℹ ${t.id} 分支已并入 ${mainRef}，stale 跳过（自身变更已在主线）` };
  const dir = taskDirOf(tasksDir, t.id);
  const specP = path.join(dir, 'spec.md');
  const specText = fs.existsSync(specP) ? fs.readFileSync(specP, 'utf8') : '';
  const rw = [...new Set([...parseWriteSet(specText), ...parseReadSet(specText)])];
  const changedOut = git(['-C', mainRoot, '-c', 'core.quotePath=false', 'diff', '--no-renames', '--name-only', `${t.baseCommit}..${mainRef}`], mainRoot, true); // 对抗加固 RC1/RC2：重命名双名+非 ASCII 路径不转义
  if (changedOut === null) return { state: 'drift', line: `⚠ ${t.id} git diff ${String(t.baseCommit).slice(0, 7)}..${mainRef} 失败（基线不可达 / main 历史改写？）→ 人工核对，不以空清单判新鲜` }; // 审查自证加固④：git 失败禁当新鲜
  const overlap = changedOut.split('\n').filter(Boolean).filter((f) => matchPath(f, rw));
  if (overlap.length) return { state: 'drift', line: `⚠ ${t.id} 影响面漂移：main 自基线 ${String(t.baseCommit).slice(0, 7)} 改了 ${overlap.join('、')}——命中读写集，重验 spec 影响面地图对应行再动工` };
  if (rw.length) return { state: 'fresh', line: `✓ ${t.id} 影响面新鲜（main 自基线 ${String(t.baseCommit).slice(0, 7)} 未触碰读写集）` };
  return { state: 'undeclared', line: `ℹ ${t.id} 影响面无机读声明（声明行/资产列均无反引号），未参与体检（防假绿——与门一禁静默同哲学）` }; // 审查自证加固③
}
function staleCmd(args = []) {
  const id = args.find((a) => !String(a).startsWith('--'));
  const { isGit, mainRoot, tasksDir } = locate();
  if (!isGit) { console.error('⚠ 非 git 项目无基线可比'); return 1; }
  const mainRef = resolveMainRef(mainRoot);
  if (!mainRef) { console.error('⚠ 主分支不可解析'); return 1; }
  const all = loadTasks(tasksDir);
  const targets = id ? all.filter((x) => x.id === id) : all.filter((x) => x.status === 'active' || x.status === 'verifying');
  if (id && !targets.length) { console.error(`⚠ 任务不存在：${id}`); return 1; }
  let drift = 0;
  for (const t of targets) {
    const c = staleCheck(t, mainRoot, mainRef, tasksDir);
    console.log(c.line);
    if (c.state === 'drift') drift++;
  }
  return drift ? 1 : 0;
}

/* ---------------- revert-plan：Saga 补偿方案生成器（只读不执行，v2.69.0）----------------
   治「已合并代码要撤回时临场拍脑袋」：merged 是终态（禁手改 status 回退），撤销已合并代码唯一合规
   路径 = git revert -m 1（data.md 撤销纪律：硬规则 1 禁 reset --hard/force push，--no-ff 保证可 revert）。
   本命令只生成方案文件（逐条 revert 命令 + 档案注记 + 红线），绝不执行任何 git 写操作——
   破坏性动作须用户逐条确认；档案注记（unmergedAt）执行后人工落痕。 */
function revertPlanCmd(args = []) {
  const id = args.find((a) => !String(a).startsWith('--'));
  if (!id) {
    console.error('用法：node tf.mjs revert-plan <task-id>\n为 merged 任务生成回退方案 <taskDir>/revert-plan.md（Saga 补偿：逐条 git revert -m 1 <merge-commit> + 档案注记 + 红线）。只读不执行——执行需用户逐条确认。\n非 merged 任务不适用：active/verifying 的打回走 resume.md 第 9 步（打回 ≠ 回退已合并代码）。');
    return 1;
  }
  const { isGit, mainRoot, tasksDir } = locate();
  const t = loadTasks(tasksDir).find((x) => x.id === id);
  if (!t) { console.log(`未找到任务 ${id}（跑 ls 查看列表）`); return 1; }
  if (t.status !== 'merged') { console.log(`⚠ ${id} 状态 ${t.status}（非 merged）——补偿方案只适用于已合并任务；active/verifying 的打回走 resume.md 第 9 步`); return 1; }
  if (!isGit) { console.log('⚠ 非 git 项目无回退对象'); return 1; }
  const dir = taskDirOf(tasksDir, id);
  const targetRef = git(['-C', mainRoot, 'rev-parse', '--verify', 'origin/main'], mainRoot, true) ? 'origin/main' : resolveMainRef(mainRoot);
  if (!targetRef) { console.log('⚠ 主分支不可解析——无从定位合并区间'); return 1; }
  const base = t.baseCommit ?? t.mergeSnapshot?.commit ?? null;
  const branch = t.branch ?? null;
  // 候选 merge commits：base..target 区间内所有 merge，再按「第二父提交与任务分支同源」过滤出本任务的合并点
  let merges = [];
  let note = '';
  if (!base) {
    note = '无 baseCommit/mergeSnapshot 基线在档——回退区间不可机械界定，人工 `git log --merges --oneline` 核对';
  } else {
    const rangeOut = git(['-C', mainRoot, 'log', '--merges', '--ancestry-path', '--oneline', `${base}..${targetRef}`], mainRoot, true) ?? '';
    const candidates = rangeOut.split('\n').filter(Boolean).map((l) => ({ sha: l.split(' ')[0], subject: l.slice(l.indexOf(' ') + 1) }));
    if (branch) {
      for (const m of candidates) {
        const parents = (git(['-C', mainRoot, 'rev-list', '--parents', '-n', '1', m.sha], mainRoot, true) ?? '').split(/\s+/).slice(1).filter(Boolean);
        const p2 = parents[1];
        // 第二父提交与本任务分支同源（任一可达另一）= 这次 merge 带入的是本任务的工作线
        if (p2 && (isAnc(mainRoot, branch, p2) || isAnc(mainRoot, p2, branch))) merges.push(m);
      }
      if (!merges.length) note = candidates.length ? '区间内有 merge 但均非本任务分支的第二父——疑似 squash/ff 合并，未检出本任务 merge commit，回退=按 main 变更文件人工逆向或删任务分支' : '未检出 merge commit，回退=删任务分支（确认未并入后）';
    } else {
      merges = candidates;
      note = '任务无分支记录（attached 工作流）——以上为区间内全部 merge，逐条人工核对是否本任务产出';
    }
  }
  const ts = new Date().toISOString();
  const short = (s) => String(s ?? '').slice(0, 7);
  const lines = [];
  lines.push(`# 回退方案 — ${id}（${t.title ?? ''}）`);
  lines.push('');
  lines.push(`> 生成时刻 ${ts}；分支 ${branch ?? '（无）'}；基线 ${base ? short(base) : '（无）'}；对账 ref ${targetRef}。`);
  lines.push('> 本文件由 tf.mjs revert-plan 生成（只读）——**未执行任何 git 写操作**，执行前逐条与用户确认。');
  lines.push('');
  lines.push('## 状态快照（生成时原文）');
  lines.push(`- status: ${t.status}（终态——回退代码不回退档案，禁手改 status）`);
  lines.push(`- mergedAt: ${t.mergedAt ?? '—'}`);
  if (t.deploy?.rollbackPoint) lines.push(`- deploy.rollbackPoint: ${t.deploy.rollbackPoint}`);
  if (t.deploy?.version) lines.push(`- deploy.version: ${t.deploy.version}（回退代码后须从 ${targetRef} 重建替换包重部署：node tf.mjs deploy --branch ${resolveMainRef(mainRoot) ?? 'main'}）`);
  if (t.mergeSnapshot?.commit) lines.push(`- mergeSnapshot: ${short(t.mergeSnapshot.commit)} @ ${t.mergeSnapshot.mainRef ?? 'main'}`);
  lines.push('');
  lines.push('## 逐条补偿命令（自新向旧，每条执行前确认）');
  if (merges.length) {
    merges.forEach((m, i) => lines.push(`${i + 1}. \`git revert -m 1 ${m.sha}\`  # ${m.subject}`));
    lines.push('');
    lines.push('撤销纪律（data.md：硬规则 1）：禁 reset --hard / force push；--no-ff 合并保证可 revert；revert 产生新提交，历史不改写。');
  } else {
    lines.push(`（${note || '未检出 merge commit，回退=删任务分支'}）`);
  }
  lines.push('');
  lines.push('## 档案注记（执行回退后人工落痕）');
  lines.push(`- task.json 手记 \`unmergedAt\`（时刻）与原因一行；status 保持 merged 终态**不回退**（merged→active 是状态倒退，J 墙/状态机均拒）。`);
  lines.push('- 续迭代走 resume.md 第 10 步新任务，不复活旧档案。');
  lines.push('');
  lines.push('## 红线');
  lines.push('- 共享分支（他人/main）禁 `git branch -D` / force push；任务自家分支删除属用户确认后的例外（data.md 状态机表撤销列）。');
  lines.push('- 回退后线上包从 main 重建重部署（双包事故形态：旧分支包继续跑 = 滚回倒计时）。');
  lines.push('');
  lines.push('本方案由 tf.mjs 生成，未执行任何 git 写操作——执行需用户逐条确认');
  const planP = path.join(dir, 'revert-plan.md');
  fs.writeFileSync(planP, lines.join('\n') + '\n');
  console.log(`✓ 回退方案已生成：${planP}（${merges.length ? `${merges.length} 条 git revert -m 1 候选` : note || '未检出 merge commit'}）；未执行任何 git 写操作`);
  return 0;
}

/* ---------------- gates：门责任链聚合（只读，v2.69.0）----------------
   把散在 mergegate/stale/accept 前置/doctor I16 的五道合并相关门一次跑完，统一「门名：过/红/黄——一句原因」
   表输出 + verdict 收尾。不改任何状态；不替代 mergegate 的处置指引（mergegate 输出逐门完整修复路径）。 */
function gatesCmd(args = []) {
  const id = args.find((a) => !String(a).startsWith('--'));
  if (!id) { console.error('用法：node tf.mjs gates <task-id>\n门责任链聚合（只读）：快照门/越界门/分支已并入预检/stale/I16 敞口 五道门一次跑完，尾行 verdict。不改任何状态；逐门完整处置指引跑 mergegate。'); return 1; }
  const { isGit, mainRoot, tasksDir } = locate();
  if (!isGit) { console.error('⚠ 非 git 项目无门可跑'); return 1; }
  const t = loadTasks(tasksDir).find((x) => x.id === id);
  if (!t) { console.error(`⚠ 任务不存在：${id}`); return 1; }
  const mainRef = resolveMainRef(mainRoot);
  if (!mainRef) { console.error('⚠ 主分支不可解析'); return 1; }
  const rows = [];
  const snap = mergeGateSnapshot(t, mainRoot, mainRef);
  rows.push(['快照门', snap]);
  const bound = mergeGateBoundary(t, mainRoot, mainRef);
  rows.push(['越界门', bound]);
  if (t.branch) {
    const mm = isMergedIntoMain(t, mainRoot);
    rows.push(['已并入预检', mm.merged === false
      ? { red: true, yellow: false, reason: `分支未并入主分支（${mm.mainRefs.join('/')}）` }
      : mm.merged === true
        ? { red: false, yellow: false, reason: '分支可达主 ref（合并事实在档）' }
        : { red: false, yellow: false, reason: '主 ref 不可解析，无法机械校验' }]);
  } else {
    rows.push(['已并入预检', { red: false, yellow: false, reason: '无分支记录（attached 工作流），合并事实由编排层确认' }]);
  }
  const sc = staleCheck(t, mainRoot, mainRef, tasksDir);
  rows.push(['stale', {
    red: sc.state === 'drift',
    yellow: false,
    reason: sc.state === 'drift' ? sc.line.replace(/^⚠ /, '')
      : sc.state === 'fresh' ? '影响面新鲜（main 未触碰读写集）'
        : sc.state === 'undeclared' ? '影响面无机读声明（防假绿不参与体检）'
          : sc.line.replace(/^ℹ /, ''),
  }]);
  let i16;
  if (!isVerifying(t)) i16 = { red: false, yellow: false, reason: '非等验收态，不适用' };
  else if (!t.deploy?.deployedAt || !t.branch) i16 = { red: false, yellow: false, reason: '等验收但无部署在档（未走 --deployed 登记？）' };
  else {
    const inMain = ['origin/main', 'main', 'master'].some((r) => isAnc(mainRoot, t.branch, r));
    const hrs = Math.floor((Date.now() - Date.parse(t.deploy.deployedAt)) / 3600000);
    i16 = !inMain && hrs > 24
      ? { red: true, yellow: false, reason: `已部署未合并 main ${hrs}h（超 24h 敞口——线上跑分支包，收口链 merge→重部署→accept）` }
      : { red: false, yellow: false, reason: inMain ? '已部署内容已进 main（敞口关闭）' : `已部署未合并 main ${hrs}h（24h 容忍窗口内）` };
  }
  rows.push(['I16 敞口', i16]);
  console.log(`# 门责任链 — ${id}（${t.status}）`);
  for (const [name, g] of rows) console.log(`${name}：${g.red ? '红' : g.yellow ? '黄' : '过'}——${g.reason}`);
  const red = rows.filter(([, g]) => g.red).length;
  const yellow = rows.filter(([, g]) => g.yellow).length;
  console.log(`gates verdict：${red} 红 ${yellow} 黄——${red ? '先消化红灯' : yellow ? '可进合并（先按黄项同步/刷新快照）' : '可进合并'}`);
  return red ? 1 : 0;
}
function overlapCmd(args = []) {
  const id = args.find((a) => !String(a).startsWith('--'));
  if (!id) { console.error('用法：node tf.mjs overlap <task-id>\n并行派发（split.md 场景①）准入预检：子任务 spec「## 涉及文件」反引号路径两两求交——重叠对 = 不准并行（改串行/调整拆分边界/呈用户仲裁）。只读。'); return 1; }
  const { tasksDir } = locate();
  const dir = fs.existsSync(path.join(tasksDir, id)) ? path.join(tasksDir, id) : path.join(tasksDir, 'archive', id);
  const subRoot = path.join(dir, 'subtasks');
  if (!fs.existsSync(subRoot)) { console.log(`ℹ ${id} 无子任务可查`); return 0; }
  const sets = [];
  for (const d of fs.readdirSync(subRoot, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
    const sp = path.join(subRoot, d, 'spec.md');
    if (!fs.existsSync(sp)) continue;
    const secParts = fs.readFileSync(sp, 'utf8').split(/^#{1,6}\s*涉及文件[^\n]*$/m); // split 切节：惰性捕获+$ 前瞻会在标题后空行行尾提前止步（夹具先红实证）——捕获段为空=写集解析静默失败
    let secText = secParts.length > 1 ? secParts[1].split(/^#{1,6}\s/m)[0] : '';
    secText = secText.replace(/```[\s\S]*?(```|$)/g, ' '); // 对抗加固 RC6：先剥代码围栏段——三连反引号会打乱反引号配对、吞掉围栏后的真实声明
    const files = [...secText.matchAll(/`([^`]+)`/g)].map((m) => normRel(m[1])).filter(Boolean); // normRel：../ 前缀链归一（对抗加固 RC6：半截净化把 ../src/a.ts 变 /src/a.ts 永不相遇）
    if (!files.length) console.log(`ℹ 子任务 ${d} 涉及文件未用反引号，不参与机读`);
    sets.push({ n: d, files });
  }
  if (sets.length < 2) { console.log(`ℹ ${id} 可机读子任务 ${sets.length} 个，无可比交集`); return 0; }
  const pairs = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i], b = sets[j];
      if (!a.files.length || !b.files.length) continue;
      const shared = [...new Set([...a.files.filter((f) => matchPath(f, b.files)), ...b.files.filter((f) => matchPath(f, a.files))])];
      if (shared.length) pairs.push(`${a.n} × ${b.n} 共享 ${shared.join('、')}`);
    }
  }
  if (pairs.length) {
    for (const p of pairs) console.log(`⛔ 重叠对：${p}`);
    console.log('场景① 并行前提 = 写集两两不相交；重叠对改串行（同任务 worktree 按依赖序）/ 调整拆分边界 / 拿不准呈用户仲裁');
    return 1;
  }
  const emptyN = sets.filter((s) => !s.files.length).length; // 对抗加固 RC5：空参与子任务在场时禁发 ✓ 绿灯（空集真空真——与 stale「空声明 ℹ 不打 ✓」纪律一致）
  if (emptyN) { console.log(`ℹ ${emptyN} 个子任务未参与机读（涉及文件无反引号/节缺失）——两两不相交未被证明，补反引号再验`); return 0; }
  console.log('✓ 子任务写集两两不相交，可按场景① 并行');
  return 0;
}

/* ---------------- impact：J19 牵连排查 + J20 数据边界 机械保底（只读，恒 exit 0，v2.72.0） ----------------
   纯文档纪律的「提醒必达」缺口：J19/J20 只活在文档里时靠模型自觉。本命令给「改动呈报前」一个机械底：
   逐文件 ①basename 引用计数/清单（grep 级非语义级）②数据管道特征探测。提醒不拦截。
   检索面 = git grep --untracked（tracked+未忽略；node_modules/.git 等忽略面天然排除）——比裸 grep -r 快且稳。
   v2.76.0（A2 审查 E1/D1/D3）：检索串去扩展名取主名（.vue 例外）+ -w 整词防子串误中；命中面分代码/文档两组——
   文档散文提及不计 J19 阈值；同名孪生命中列歧义标注；J20 特征扫首 500+尾 200 行、注释行剔除、词表补英文/SQL 形态。
   阈值 TF_IMPACT_THRESHOLD（缺省 3，与守门 J19 共用）；语义级影响面归 code-review-graph impact 工具（如已挂载）。 */
// J19/J20 机械面（impact 命令用；guard 侧持独立副本——守门是独立渲染产物必须自包含）：
const thresholdEnv = () => { const v = parseInt(process.env.TF_IMPACT_THRESHOLD ?? '', 10); return Number.isFinite(v) && v >= 1 ? v : 3; };
// v2.76.0（A2 审查 D3②③/S10-8）：词表补英文管道形态（previousPeriod/last month/month over month 等，i 志大小写）；
// 算子补 reduce/aggregate + i 志 + SQL GROUP BY 形态；注释行（//、/*、*、<!--、# 开头）剔除后再计数——
// 注释/UI 文案里的词提及不算管道证据（真仓实测误报主源）
const J20_WORD_RE = /环比|同比|上期|较上期|对比|排名|统计|previous[\s_-]*(?:period|month|week)|last[\s_-]*(?:period|month|week)|month[\s_-]*over[\s_-]*month|year[\s_-]*over[\s_-]*year/gi;
const J20_CODE_RE = /\b(?:sum|count|avg|max|min|sort|reduce|aggregate)\s*\(/gi;
// 特征探测窗口：首 500 行 + 尾 200 行（v2.76.0 D3④——固定 500 行窗口漏文件尾部管道）；注释行剔除（S10-8）
function j20CodeLines(text) {
  const lines = String(text ?? '').split('\n');
  const win = lines.length > 700 ? [...lines.slice(0, 500), ...lines.slice(-200)] : lines;
  return win.filter((l) => { const t = l.trim(); return t && !/^(?:\/\/|\/\*|\*|<!--|#)/.test(t); });
}
// 数据管道特征探测：词特征任一命中；代码特征须 ≥2 个不同算子（单 sort(/count( 全仓皆是无害噪音）；GROUP BY 单独记一算子
function j20Scan(text) {
  const body = j20CodeLines(text).join('\n');
  const words = [...new Set(body.match(J20_WORD_RE) ?? [])];
  const codes = new Set((body.match(J20_CODE_RE) ?? []).map((s) => s.replace(/\s+/g, '')));
  if (/\bGROUP\s+BY\b/i.test(body)) codes.add('GROUP BY');
  return { hit: words.length > 0 || codes.size >= 2, detail: [...words, ...codes].slice(0, 6).join('、') };
}
// basename 主名（J19 检索串口径，v2.76.0 E1）：.vue 保留扩展名（import 习惯带 .vue），其余去扩展名
const impactKey = (p) => { const e = path.extname(p); return e === '.vue' ? path.basename(p) : path.basename(p, e); };
// v2.77.1（R2 有效性攻击 F2b①）：同扩展名族映射——非 .vue 目标的 basename 检索限定同语言扩展名族
// （share.ts 检索串「share」曾以整词命中 Java 注释/文案：dx-snap-share 实测报 80 个代码文件、真实 import 消费方 2 个，膨胀 40×）。
// 族外扩展名（映射表未覆盖）不设限，由 F2b② 跨语言歧义标注兜底；.vue=null（检索串已带扩展名，限定 .vue 族会漏 .ts 消费方）。
const EXT_FAMILY = {
  '.ts': ['.ts', '.tsx', '.mts', '.cts'], '.tsx': ['.ts', '.tsx', '.mts', '.cts'], '.mts': ['.ts', '.tsx', '.mts', '.cts'], '.cts': ['.ts', '.tsx', '.mts', '.cts'],
  '.js': ['.js', '.jsx', '.mjs', '.cjs'], '.jsx': ['.js', '.jsx', '.mjs', '.cjs'], '.mjs': ['.js', '.jsx', '.mjs', '.cjs'], '.cjs': ['.js', '.jsx', '.mjs', '.cjs'],
  '.java': ['.java'], '.kt': ['.kt', '.kts'], '.kts': ['.kt', '.kts'], '.scala': ['.scala'], '.groovy': ['.groovy'],
  '.py': ['.py'], '.rb': ['.rb'], '.php': ['.php'], '.go': ['.go'], '.rs': ['.rs'], '.swift': ['.swift'], '.cs': ['.cs'],
  '.c': ['.c', '.h'], '.h': ['.c', '.h'], '.cpp': ['.cpp', '.cc', '.cxx', '.hpp'], '.cc': ['.cpp', '.cc', '.cxx', '.hpp'], '.cxx': ['.cpp', '.cc', '.cxx', '.hpp'], '.hpp': ['.cpp', '.cc', '.cxx', '.hpp'],
  '.vue': null,
};
// 文档与帮助文本判定（J19 阈值不计这组；guard 侧持独立副本同款——两处同步改）
const isDocPath = (f) => /\.(?:md|mdx|txt|rst|adoc)$/i.test(f) || /^(?:README|CHANGELOG|LICENSE|CONTRIBUTING)/i.test(path.basename(f)) || /(?:^|\/)docs?\//i.test(f);
function impactCmd(args = []) {
  const th = thresholdEnv();
  const { isGit, mainRoot, tasksDir } = locate();
  const since = optArg(args, 'since');
  const filesArg = optArg(args, 'files');
  console.log(`impact（J19 牵连排查 + J20 数据边界 机械保底；阈值=引用文件数≥${th}）：`);
  const done = () => { console.log('—— grep 级分析（非语义级）；语义影响面可用 code-review-graph impact 工具（如已挂载）'); return 0; };
  let files = [];
  if (filesArg !== undefined) {
    files = filesArg.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (isGit) {
    if (since !== undefined) {
      if (!git(['rev-parse', '--verify', '--quiet', `${since}^{commit}`], mainRoot, true)) {
        console.log(`⚠ --since ${since} 无法解析为 commit（ref 不存在？）——按无改动处理`);
      } else {
        files = git(['diff', '--name-only', `${since}..HEAD`], mainRoot, true).split('\n').filter(Boolean);
      }
    } else {
      const tasks = loadTasks(tasksDir).filter((t) => t.status === 'active' || isVerifying(t));
      if (tasks.length) {
        const mainRef = resolveMainRef(mainRoot);
        const set = new Set();
        for (const t of tasks) {
          const base = t.baseCommit ?? mainRef;
          if (!base) { console.log(`ℹ ${t.id} 无 baseCommit 且项目无主分支 ref，跳过该任务改动集`); continue; }
          for (const f of git(['diff', '--name-only', `${base}..HEAD`], mainRoot, true).split('\n')) if (f) set.add(f);
        }
        files = [...set];
      } else {
        files = git(['diff', '--name-only', 'HEAD'], mainRoot, true).split('\n').filter(Boolean); // 已暂存+工作区（tracked）
      }
    }
  }
  files = [...new Set(files)];
  if (!files.length) { console.log('ℹ 无可分析的改动'); return done(); }
  const fanFiles = []; const j20Files = [];
  // v2.77.1（F2a）：仓内全文件清单（ls-files tracked+未忽略）——孪生独立来源用；循环内懒加载缓存一次（检索失败=空清单，不致命）
  let repoFilesCache = null;
  const repoFiles = () => (repoFilesCache ??= (() => { try { return execFileSync('git', ['-C', mainRoot, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean); } catch { return []; } })());
  for (const f of files) {
    const abs = path.resolve(mainRoot, f);
    console.log(`\n── ${f}`);
    if (!fs.existsSync(abs)) { console.log('  ℹ 文件不存在（已删除？）跳过引用分析'); continue; }
    const rel = path.relative(mainRoot, abs);
    // v2.76.0（A2 审查 E1/D1）：检索串去扩展名取主名（.vue 例外）+ -w 整词（api.ts 检索不再误中 myapi.ts 子串）；
    // 命中面分「代码文件 / 文档与帮助文本」两组——文档散文提及不计 J19 阈值（散文充数曾把真仓 44% 前端文件顶过
    // 阈值）；同名异扩展/同名异路径孪生命中列歧义标注（com.a/com.b 同名类互不污染面不可辨，呈报给人工核对）。
    const ext = path.extname(f);
    const key = impactKey(f);
    // v2.77.1（F2b①）：族内检索面（.ts→*.ts/*.tsx/*.mts/*.cts 等）；族外/null 不设限（.vue 检索串带扩展名，.ts 消费方靠它）
    const family = EXT_FAMILY[ext.toLowerCase()];
    const scopes = Array.isArray(family) ? family.map((e) => `*${e}`) : null;
    let lines = null;
    try {
      const out = execFileSync('git', ['-C', mainRoot, 'grep', '--untracked', '-I', '-n', '-F', '-w', '-e', key, '--', ...(scopes ?? ['.']), `:!${rel}`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
      lines = out.split('\n').filter(Boolean);
    } catch (e) {
      if (e?.status !== 1) lines = null; else lines = []; // 1=无匹配（正常空）；其余=真错误
    }
    if (lines === null) {
      console.log('  ①引用计数：⚠ basename 引用检索失败——计数与清单缺失（输出过大或 git 异常；可改用语义级工具）');
    } else {
      const codeByFile = new Map(); const docByFile = new Map();
      for (const ln of lines) {
        const i = ln.indexOf(':'); // <path>:<行号>:<内容>——路径含冒号属病态形态，grep 级分析不设防
        if (i <= 0) continue;
        const fp = ln.slice(0, i);
        const rest = ln.slice(i + 1);
        const li = rest.indexOf(':');
        const sink = isDocPath(fp) ? docByFile : codeByFile;
        if (!sink.has(fp)) sink.set(fp, []);
        sink.get(fp).push(li >= 0 ? rest.slice(0, li) : '?');
      }
      console.log(`  ①引用计数：代码引用文件数 ${codeByFile.size}（阈值判定），文档提及 ${docByFile.size}，命中次数 ${lines.length}（主名「${key}」整词检索，排除自身；grep 级，含注释/文案，非引用语义）${scopes ? `；检索限定同扩展名族 ${scopes.join('、')}` : ''}`);
      console.log('  ②引用清单：');
      const codeFlat = [...codeByFile.entries()].flatMap(([fp, lns]) => lns.map((ln) => `${fp}:${ln}`));
      if (!codeFlat.length) console.log('  代码文件：ℹ 无引用命中');
      else {
        for (const x of codeFlat.slice(0, 5)) console.log(`    ${x}`);
        if (codeFlat.length > 5) console.log(`    … ${codeFlat.length - 5} more`);
      }
      if (docByFile.size) {
        console.log('  文档与帮助文本（不计阈值）：');
        const docFlat = [...docByFile.entries()].flatMap(([fp, lns]) => lns.map((ln) => `${fp}:${ln}`));
        for (const x of docFlat.slice(0, 5)) console.log(`    ${x}`);
        if (docFlat.length > 5) console.log(`    … ${docFlat.length - 5} more`);
      }
      // v2.77.1（R2 有效性攻击 F2a）：孪生两路并集——①命中清单路（旧路：孪生文件自身内容命中才算）②独立来源路：
      // git ls-files 按主名直查仓内同名文件（排除自身）。同名 SFC 从不 import 自己的同名兄弟 → 孪生自身永不入命中
      // 清单，旧路系统性漏报（dx-snap-share SummaryCard.vue 实测：3 消费方中 2 个实为 dashboard 孪生的，歧义标注未出现）。
      const hitTwins = [...codeByFile.keys(), ...docByFile.keys()].filter((h) => impactKey(h) === key && (path.extname(h) !== ext || path.basename(h) === path.basename(f)));
      const indepTwins = repoFiles().filter((h) => h !== rel && path.basename(h, path.extname(h)) === path.basename(f, path.extname(f)));
      const twins = [...new Set([...hitTwins, ...indepTwins])];
      if (twins.length) console.log(`  ⚠ 同名歧义：主名「${key}」另命中 ${twins.slice(0, 5).join('、')}${twins.length > 5 ? ' 等' : ''}——grep 级命中面可能跨同名文件，逐个核对`);
      // v2.77.1（F2b②）：族外扩展名兜底——异扩展名代码命中过半 → 强制跨语言歧义标注（映射表未覆盖的组合不静默）
      if (family === undefined && codeByFile.size) {
        const foreign = [...codeByFile.keys()].filter((h) => path.extname(h).toLowerCase() !== ext.toLowerCase());
        if (foreign.length * 2 > codeByFile.size) console.log(`  ⚠ 跨语言歧义：命中跨语言形态，basename 泛用词风险高（异扩展名命中 ${foreign.length}/${codeByFile.size}：${foreign.slice(0, 5).join('、')}${foreign.length > 5 ? ' 等' : ''}）——import/引用路径逐条核对`);
      }
      if (codeByFile.size >= th) fanFiles.push(f);
    }
    // ③：数据管道特征（首 500+尾 200 行窗口；注释行剔除；词特征任一命中，代码特征须≥2 个不同算子防单 sort(/count( 全仓噪音）
    const j20 = j20Scan((() => { try { return fs.readFileSync(abs, 'utf8'); } catch { return ''; } })());
    if (j20.hit) {
      j20Files.push(f);
      console.log(`  ③数据管道特征：J20 风险：涉数据管道（命中：${j20.detail}）`);
    } else {
      console.log('  ③数据管道特征：未命中');
    }
  }
  if (fanFiles.length) console.log(`\nJ19 牵连排查：以上 ${fanFiles.length} 个文件被多处引用，改动呈报须含影响面清单（${fanFiles.join('、')}）`);
  if (j20Files.length) console.log(`J20 数据边界：枚举真空与失真形态（空集/单条/首期无参照/异常值/口径变更/范围串扰），禁算了不传/传空容器/硬凑对比（${j20Files.join('、')}）`);
  if (!fanFiles.length && !j20Files.length) console.log('ℹ 无高扇出/数据管道文件');
  return done();
}

/* ---------------- commit：安全提交（把「临场刹车」固化成命令） ----------------
   治双会话同桌事故的源头：git add -A 会无差别卷入他会在途工作。
   不声明范围 → 拒绝并列清单；--files 只装订指定文件；--all 显式确认卷入全部。
   提交后报「桌上还剩什么」。pre-commit hook 输出原样透传（禁 --no-verify 绕过）。 */

function commitCmd(args = []) {
  let msg = '';
  let session = '';
  let deployed = false;
  let deployNote = '';
  const files = [];
  let all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-m' || args[i] === '--message') msg = String(args[++i] ?? '');
    else if (args[i] === '--session') session = String(args[++i] ?? '');
    else if (args[i] === '--files') { for (const f of String(args[++i] ?? '').split(',')) if (f.trim()) files.push(f.trim()); }
    else if (args[i] === '--all') all = true;
    else if (args[i] === '--deployed') {
      deployed = true;
      const nx = args[i + 1];
      if (nx !== undefined && !String(nx).startsWith('-')) { deployNote = String(nx); i++; }
    }
  }
  if (!msg) { console.error('用法：node tf.mjs commit -m "说明" [--files f1,f2 | --all] [--session <本会话ID>] [--deployed [部署注记]]\n不指定范围 = 拒绝提交（防 add -A 卷入他会在途工作）；--session = 乐观锁（属主不符拒写）；--deployed = 部署扳机（active→verifying + deploy 记录 + index 同步）'); return 1; }
  const cwd = process.cwd();
  // 乐观锁（--session 可选，向后兼容）：task.json.sessionID = 属主凭证，防接管后旧会话再写（superdx 乐观锁的 taskflow 落法）
  if (session) {
    const { tasksDir } = locate();
    const br = git(['symbolic-ref', '--short', 'HEAD'], cwd, true); // 未出生分支（仓库首个提交前）也能解析，rev-parse 会失败致锁静默解除
    const t = br ? loadTasks(tasksDir).find((x) => x.branch === br) : null;
    if (!t) console.log(`ℹ 当前分支 ${br ?? '?'} 未登记任务——--session 乐观锁未生效，按普通提交执行`);
    else if (t.sessionID && t.sessionID !== session) {
      console.log(`⚠ 任务 ${t.id} 属主是会话 ${t.sessionID}，你 = ${session}——先走接管仪式（改 sessionID + 重写 .owner.json + 清点桌面）再提交`);
      return 1;
    } else if (!t.sessionID) {
      const dir = fs.existsSync(path.join(tasksDir, t.id)) ? path.join(tasksDir, t.id) : path.join(tasksDir, 'archive', t.id);
      try {
        const fresh = JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8'));
        fresh.sessionID = session;
        fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(fresh, null, 2));
        syncIndexRow(tasksDir, fresh); // v2.19.0：写路径单源——回填属主后 index 必须同步（I1 漂移根因封堵）
        console.log(`ℹ 已回填任务 ${t.id} 属主 sessionID = ${session}`);
      } catch { console.log('⚠ 回填 sessionID 失败（task.json 读/写异常）——照常提交，稍后人工核对'); }
    }
  }
  const st = git(['status', '--porcelain'], cwd, true);
  if (st === null) { console.log('⚠ git status 失败——先查仓库状态，勿盲提交'); return 1; }
  const lines = st.split('\n').filter(Boolean);
  if (!lines.length) { console.log('ℹ 工作区干净，无可提交（幂等）'); return 0; }

  if (!all && !files.length) {
    console.log(`⚠ 桌上有 ${lines.length} 份未提交改动，未声明提交范围——拒绝提交（防 git add -A 卷入他会在途工作）：`);
    for (const l of lines.slice(0, 10)) console.log(`    ${l}`);
    if (lines.length > 10) console.log(`    …还有 ${lines.length - 10} 项`);
    console.log('\n先核对哪些是自己改的，然后显式选择其一：\n  --files <f1,f2>  只提交这些文件（推荐）\n  --all            卷入全部改动（仅在接管清点之后使用）');
    return 1;
  }

  // 同批纪律提醒：提交集合命中测试资产路径（哨兵/用例/分块）
  const toCommit = files.length ? files : lines.map((l) => l.replace(/^..\s+/, '').trim());
  const assetRule = TEST_RULES.find((r) => r.id === '测试资产');
  if (assetRule && toCommit.some((f) => assetRule.match(f))) {
    console.log('⚠ 命中测试资产（哨兵/用例/分块）——须与功能代码**同批**提交部署（禁分批，历史先例；conventions 禁止事项）');
  }

  if (files.length) {
    for (const f of files) git(['add', '--', f], cwd, true);
    const staged = git(['diff', '--cached', '--name-only'], cwd, true) ?? '';
    if (!staged) { console.log('⚠ 声明的文件没有任何可提交改动（文件名写错？跑 git status 核对）——未提交'); return 1; }
  } else {
    git(['add', '-A'], cwd, true);
    console.log('⚠ --all：本次提交卷入工作区全部改动（应已完成接管清点）');
  }
  try { execFileSync('git', ['commit', '-m', msg], { cwd, stdio: 'inherit' }); }
  catch { console.log('⚠ git commit 未成功（多为 pre-commit 门拒绝）——如实处理，禁止 --no-verify 绕过'); return 1; }
  const sha = git(['rev-parse', '--short=7', 'HEAD'], cwd, true) ?? '?';
  const rest = (git(['status', '--porcelain'], cwd, true) ?? '').split('\n').filter(Boolean);
  console.log(`\n✓ 已提交 ${sha}：${trunc(msg, 60)}`);
  // REQ_BASELINE 锚定（v2.23.0）+ 任务基线锚（v2.59.0）：首个 commit 自动落 goalHash（已锚定不覆盖；刷新唯一途径=req-confirm）
  // 与 baseCommit（MVCC 开局 Read View——stale 影响面漂移检查的比对起点，同样首锚不覆盖）。
  // 写后必 syncIndexRow（v2.19.0 规约）；失败不阻断提交（锚定可事后 req-confirm 补）。
  {
    const { tasksDir } = locate();
    const br = git(['symbolic-ref', '--short', 'HEAD'], cwd, true);
    const t = br ? loadTasks(tasksDir).find((x) => x.branch === br) : null;
    if (t) {
      const dir = fs.existsSync(path.join(tasksDir, t.id)) ? path.join(tasksDir, t.id) : path.join(tasksDir, 'archive', t.id);
      try {
        const fresh = JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8'));
        let anchored = false;
        if (!fresh.goalHash) {
          const specP = path.join(dir, 'spec.md');
          if (fs.existsSync(specP)) {
            const h = specCoreHash(fs.readFileSync(specP, 'utf8'));
            if (h) {
              fresh.goalHash = h;
              fresh.goalHashAt = new Date().toISOString();
              anchored = true;
              console.log(`ℹ 已锚定需求基线（goalHash=${h}）——刷新唯一途径：req-confirm（需求变更门）`);
            }
          }
        }
        // baseCommit 基线锚（v2.59.0 STALE_CHECK 数据源）：任务分支 × 基线ref（baseBranch ?? main/master/origin/main，
        // 本地优先与 snapshotCmd 同源）的 merge-base 全哈希；已锚定不覆盖（与 goalHash 首锚同款）。
        // 分支未登记任务/非 git/基线不可解析 → 静默跳过（不阻断提交，stale 对无锚任务 ℹ 跳过）。
        if (!fresh.baseCommit) {
          const baseRef = fresh.baseBranch || ['main', 'master', 'origin/main'].find((r) => git(['rev-parse', '--verify', r], cwd, true));
          const mb = baseRef ? git(['merge-base', baseRef, br], cwd, true) : null;
          if (mb) {
            fresh.baseCommit = mb;
            anchored = true;
            console.log(`ℹ 已锚定任务基线（baseCommit=${mb.slice(0, 7)}，merge-base ${baseRef}×${br}）——stale 影响面漂移检查起点（已锚定不覆盖）`);
          }
        }
        if (anchored) {
          fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(fresh, null, 2));
          syncIndexRow(tasksDir, fresh);
        }
      } catch { /* 锚定失败不阻断提交——事后 req-confirm 补 */ }
    }
  }
  if (rest.length) {
    console.log(`ℹ 桌上还剩 ${rest.length} 份未提交改动（双活场景请核对归属，勿默认是自己的）：`);
    for (const l of rest.slice(0, 5)) console.log(`    ${l}`);
  } else console.log('ℹ 工作区已干净');
  // --deployed 部署扳机（v2.19.0）：提交成功后机械翻转验收状态——「部署了→该等验收」不再靠模型记得
  if (deployed) {
    const { tasksDir } = locate();
    const br = git(['symbolic-ref', '--short', 'HEAD'], cwd, true);
    const t = br ? loadTasks(tasksDir).find((x) => x.branch === br) : null;
    if (!t) console.log(`⚠ --deployed：当前分支 ${br ?? '?'} 无登记任务——状态翻转未执行（提交本身已成功）`);
    else {
      const dir = fs.existsSync(path.join(tasksDir, t.id)) ? path.join(tasksDir, t.id) : path.join(tasksDir, 'archive', t.id);
      try {
        const fresh = JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8'));
        const prevStatus = fresh.status; // 事件判定基线：仅真翻转记事件（verifying 注记分支/拒绝分支不记）
        if (fresh.status === 'verifying') {
          fresh.deploy = { ...(fresh.deploy ?? {}), status: 'verifying', ...(deployNote ? { note: deployNote } : {}) };
          console.log(`ℹ ${t.id} 已是 verifying——仅更新部署注记`);
        } else if (fresh.status !== 'active') {
          console.log(`⚠ --deployed：${t.id} 状态为 ${fresh.status}（非 active）——拒绝翻转（merged/archived 无验收可言）`);
        } else {
          assertTransition(fresh.status, 'verifying', 'commit --deployed');
          fresh.status = 'verifying';
          fresh.deploy = { status: 'verifying', deployedAt: new Date().toISOString(), ...(deployNote ? { note: deployNote } : {}) };
          console.log(`✓ ${t.id} active → verifying（部署待验收）`);
        }
        fresh.lastActiveAt = new Date().toISOString();
        fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(fresh, null, 2));
        syncIndexRow(tasksDir, fresh);
        if (prevStatus !== fresh.status) appendEvent(tasksDir, { task: t.id, from: prevStatus, to: fresh.status, cmd: 'commit --deployed' });
        console.log(`📌 待你验收：node tf.mjs accept ${t.id}`);
      } catch { console.log('⚠ --deployed 状态翻转失败（task.json 读写异常）——提交已成功，请人工补状态'); }
    }
  }
  return 0;
}

/* ---------------- req-confirm：需求变更门落痕（写入口，v2.23.0） ----------------
   spec 承重节（目标/验收标准）变更的唯一合法登记途径：算 hash → 刷 goalHash + reqChanges 追加
   → syncIndexRow。doctor I11 比对 spec 现算 hash ≠ goalHash → 红 = 未经本命令的需求修改。
   拍板在人（需求变更门，SKILL.md 反馈分类），机械只负责留痕；--note 必填（禁无记名刷新）。 */
function reqConfirm(args = []) {
  const idArg = args.find((a) => !a.startsWith('--'));
  let note = '';
  for (let i = 0; i < args.length; i++) if (args[i] === '--note') note = String(args[++i] ?? '');
  if (!idArg || !note.trim()) { console.log('用法：node tf.mjs req-confirm <task-id> --note "<变更一句话（需求变更门拍板记录：改了什么、谁拍板）>"'); return 1; }
  const { tasksDir } = locate();
  const dir = fs.existsSync(path.join(tasksDir, idArg)) ? path.join(tasksDir, idArg) : path.join(tasksDir, 'archive', idArg);
  const tP = path.join(dir, 'task.json');
  if (!fs.existsSync(tP)) { console.log(`未找到任务 ${idArg}（跑 ls 查看列表）`); return 1; }
  let t;
  try { t = JSON.parse(fs.readFileSync(tP, 'utf8')); } catch { console.log('⚠ task.json 损坏——先修复再 req-confirm（损坏只报不修）'); return 1; }
  const specP = path.join(dir, 'spec.md');
  if (!fs.existsSync(specP)) { console.log(`⚠ ${idArg} 无 spec.md——无承重节可锚`); return 1; }
  const h = specCoreHash(fs.readFileSync(specP, 'utf8'));
  if (!h) { console.log('⚠ spec 无可解析承重节（「目标」「验收标准」两节皆缺）→ 按模板补节后再 req-confirm'); return 1; }
  const ts = new Date().toISOString();
  t.goalHash = h;
  t.goalHashAt = ts;
  t.reqChanges = [...(t.reqChanges ?? []), { ts, hash: h, note: note.trim() }];
  t.lastActiveAt = ts;
  fs.writeFileSync(tP, JSON.stringify(t, null, 2));
  syncIndexRow(tasksDir, t); // 写后必同步（v2.19.0 规约）
  console.log(`✓ ${idArg} 需求变更已留痕（goalHash=${h}，reqChanges 第 ${t.reqChanges.length} 条）——doctor I11 转绿`);
  console.log(`ℹ 领域复核（domain.md）：本次变更是否触及新领域（新增前端页面/新语言栈文件/新测试面）？是 → 重跑领域检测（node tf.mjs skills <领域词>）并按 domain.md 映射表把新领域技能要求补进 spec 约束节——变更后领域漂移不重检 = 新领域无审查能力在场（2.69.3 补挂）`);
  return 0;
}

/* ---------------- testplan：测试计划选择器（只读） ----------------
   闭环第①步：按改动文件集命中规则表 → 输出四道门（pre-commit/merge/冒烟/accept）测试计划。
   知识层住 references/testing.md（失败模式归属/设计技术/诊断六步）；本命令只做选择，
   执行永远在专家工具；取舍判断归模型+用户。 */

const TEST_RULES = [
  { id: '后端域文件', match: (f) => /backend-java\/|(^|\/)src\/main\/|(^|\/)server\//.test(f) || (/\.java$/.test(f) && /src\//.test(f)),
    gate: 'merge 审查：改动模块定向用例逐条过；pre-commit：**全量** mvn test（定向不减免全量）' },
  { id: '接口/契约变更', match: (f) => /docs\/design\/.*api\.md|\/types\/|\/dto\/|[Cc]ontroller/.test(f),
    gate: 'merge 审查：Testcontainers ApiTest + 前端 tsc/vue-tsc **typecheck**（两侧类型同步）' },
  { id: '共享组件', match: (f) => /\/components\/|\/shared\//.test(f),
    gate: 'merge 审查：graph **受影响**流清单 + 消费方 e2e 逐个过（spec「边界与影响面」反向依赖点名）' },
  { id: 'AI prompt/摘要', match: (f) => /\/ai\/|summary|prompt/i.test(f),
    gate: 'merge 审查：prompt **契约**测试 + 输出**一致性**断言（构造同源优先，testing.md §6）；判卷（复活后接入）' },
  { id: '测试资产', match: (f) => /(^|\/)\.testbed\/|\.spec\.ts$|\.e2e\.|__tests__\//.test(f),
    gate: '部署前：**同批**纪律检查（与功能代码同 commit 批次，禁分批）' },
];

function testplan(args = []) {
  const files = [];
  let idArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--files') { for (const f of String(args[++i] ?? '').split(',')) if (f.trim()) files.push(f.trim()); }
    else if (!args[i].startsWith('--')) idArg = args[i];
  }
  const { isGit, mainRoot, tasksDir } = locate();
  if (!isGit) { console.log('⚠ 非 git 目录——testplan 依赖 git diff，无法推导改动集'); return 1; }
  if (!idArg && !files.length) {
    console.error('用法：node tf.mjs testplan [task-id] [--files f1,f2]\n（task-id：读该任务分支 diff；--files：显式声明改动集）');
    return 1;
  }
  let src = `显式声明（--files）`;
  if (idArg) {
    const t = loadTasks(tasksDir).find((x) => x.id === idArg);
    if (!t) { console.log(`未找到任务 ${idArg}（跑 ls 查看列表）`); return 1; }
    const wc = t.worktree && fs.existsSync(t.worktree) ? t.worktree : mainRoot;
    const branch = t.branch ? String(t.branch) : null;
    let diffFiles = [];
    if (branch) {
      const base = git(['merge-base', 'main', branch], wc, true) ?? git(['merge-base', 'master', branch], wc, true);
      if (base) {
        const out = git(['diff', '--name-only', `${base}..${branch}`], wc, true);
        if (out) diffFiles = out.split('\n').filter(Boolean);
      }
    }
    if (!diffFiles.length && !files.length) {
      console.log(`# testplan — ${t.id}\nℹ 分支 diff 为空（无代码改动）——计划退化为：文档/档案任务通用清单（全量门 + 冒烟 + 用户验收）`);
      return 0;
    }
    files.push(...diffFiles.filter((f) => !files.includes(f)));
    src = `任务 ${t.id} 分支 diff（${diffFiles.length} 文件${wc !== mainRoot ? '，worktree 在场' : ''}）`;
  }
  console.log(`# testplan 测试计划`);
  console.log(`改动集来源：${src}（共 ${files.length} 文件）`);
  const uniq = [...new Set(files)];
  for (const f of uniq.slice(0, 15)) console.log(`  - ${f}`);
  if (uniq.length > 15) console.log(`  …还有 ${uniq.length - 15} 项`);

  const hits = [];
  for (const r of TEST_RULES) {
    const m = uniq.filter(r.match);
    if (m.length) hits.push({ rule: r, m });
  }
  const mergeGates = [];
  const deployGates = ['.testbed 测试床冒烟 + 哨兵（断言数据无关：相等不断言值）'];
  if (hits.length) {
    console.log(`\n## 命中规则（${hits.length} 类）`);
    for (const h of hits) {
      console.log(`- ${h.rule.id}（${h.m.length} 文件）→ ${h.rule.gate}`);
      if (h.rule.gate.startsWith('merge')) mergeGates.push(`${h.rule.id}：${h.rule.gate.replace(/^merge 审查：/, '')}`);
      if (h.rule.gate.startsWith('部署')) deployGates.push(h.rule.gate.replace(/^部署前：/, ''));
    }
  } else {
    console.log('\n## 未命中规则表 → 通用清单兜底（testing.md §三 失败模式归属表辅助选层）');
    mergeGates.push('两阶段清单（spec 合规+代码质量）+ 本 spec 验收标准逐条');
  }
  console.log(`\n## 四道门汇总`);
  console.log(`- pre-commit 门：全量测试（fixture/mvn/vitest——不因定向存在而减免）`);
  console.log(`- merge 审查门：${mergeGates.join('；') || '两阶段清单'}`);
  console.log(`- 部署冒烟门：${deployGates.join('；')}`);
  console.log(`- accept 验收门：tf.mjs accept（spec「用户验收」节，呈用户真机核对）`);
  console.log(`\n提示：本计划=事实选择；取舍判断归模型+用户（层选择依据见 references/testing.md「失败模式归属」）。`);
  return 0;
}

/* ---------------- diagnose：诊断证据包装配（只读）——诊断六步第②步的机械部分 ---------------- */
function diagnose(idArg) {
  if (!idArg) { console.error('用法：node tf.mjs diagnose <task-id>'); return 1; }
  const { isGit, mainRoot, tasksDir } = locate();
  const t = loadTasks(tasksDir).find((x) => x.id === idArg);
  if (!t) { console.log(`未找到任务 ${idArg}（跑 ls 查看列表）`); return 1; }
  if (!isGit) { console.log('⚠ 非 git 目录——无提交史/改动集可装配'); return 1; }
  console.log(`# 诊断证据包 — ${t.title}`);
  console.log(`任务：${t.id}（${STATUS[t.status] ?? t.status}）　症状关键词建议取自：测试报告标题/哨兵名/报错首行`);
  const wc = t.worktree && fs.existsSync(t.worktree) ? t.worktree : mainRoot;
  const branch = t.branch ? String(t.branch) : null;
  const base = branch ? (git(['merge-base', 'main', branch], wc, true) ?? git(['merge-base', 'master', branch], wc, true)) : null;
  const logs = branch && base ? git(['log', '--oneline', `${base}..${branch}`], wc, true) : '';
  const filesArr = branch && base ? (git(['diff', '--name-only', `${base}..${branch}`], wc, true) ?? '').split('\n').filter(Boolean) : [];
  const logList = logs ? logs.split('\n').filter(Boolean) : [];
  console.log(`\n## ① 提交史（${logList.length} 笔）`);
  for (const l of logList.slice(0, 10)) console.log(`  ${l}`);
  if (!logList.length) console.log('  （无或未建分支）');
  console.log(`\n## ② 改动文件集（${filesArr.length}）`);
  for (const f of filesArr.slice(0, 15)) console.log(`  ${f}`);
  if (filesArr.length > 15) console.log(`  …还有 ${filesArr.length - 15} 项`);
  const assetRule = TEST_RULES.find((r) => r.id === '测试资产');
  const assets = filesArr.filter((f) => assetRule && assetRule.match(f));
  console.log(`\n## ③ 测试资产变更（${assets.length}）`);
  for (const f of assets) console.log(`  ${f}`);
  console.log('\n## ④ 最近 .testbed 运行记录');
  const runsDir = path.join(mainRoot, '.testbed', 'runs');
  if (fs.existsSync(runsDir)) {
    const runs = fs.readdirSync(runsDir).map((d) => { const p = path.join(runsDir, d); return { d, mt: fs.statSync(p).mtimeMs }; }).sort((a, b) => b.mt - a.mt).slice(0, 3);
    for (const r of runs) console.log(`  .testbed/runs/${r.d}（${relTime(new Date(r.mt).toISOString())}）`);
  } else console.log('  （未发现 .testbed/runs 目录——未用测试床目录约定或路径不同）');
  console.log('\n## ⑤ 下一步（testing.md §五 诊断六步）');
  console.log('  - 判性质：node <skill目录>/scripts/tf.mjs scout <症状关键词>（修过=🔁回归，先查复发原因禁直接再补丁——硬规则 9）');
  console.log('  - 取证：服务器日志按时间窗 grep（命令见项目 conventions「环境与端口注意事项」）；平台类疑似问题完整记录请求/响应（AGENTS.md 红线）');
  console.log('  - 缩范围+出方案：按 references/testing.md §五/§六 执行（方案输出格式模板）');
  console.log('  - 出方案前先列 2~5 个排序假设（各带证伪点）呈报用户，单假设禁直接出方案');
  return 0;
}
/* ---------------- nextid：共享计数器占号（默认只读；--reserve 写占号登记） ----------------
   迁移号/任何 <前缀><数字> 文件名计数器，在并行未合并分支各自发号时必撞（先例：
   Flyway V21 撞线上库 3fabae7a、签名册 # 四次让位）。扫全部分支给下一个可用号；
   --versions 模式列各分支声明的版本号占面（pom/package.json 等内容计数器）。 */

function nextid(args = []) {
  let pattern = '', pth = '', reserve = false, versions = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pattern') pattern = String(args[++i] ?? '');
    else if (args[i] === '--path') pth = String(args[++i] ?? '');
    else if (args[i] === '--reserve') reserve = true;
    else if (args[i] === '--versions') versions = true;
  }
  if (!pth || (!pattern && !versions)) {
    console.error('用法：node tf.mjs nextid --pattern <前缀如 V> --path <路径模式> [--reserve]\n             node tf.mjs nextid --versions --path pom.xml|package.json\n扫全部分支给下一个可用号（文件名计数器）；--reserve 原子占号（两会话同抢只有一个成功）；\n--versions 列各分支声明的版本号占面（内容计数器——历史撞号三连让位先例）');
    return 1;
  }
  const { isGit, mainRoot, tasksDir } = locate();
  if (!isGit) { console.log('⚠ 非 git 目录——无分支可扫'); return 1; }
  if (versions) {
    const refs = (git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], mainRoot, true) ?? '').split('\n').filter(Boolean);
    const cur = git(['rev-parse', '--abbrev-ref', 'HEAD'], mainRoot, true);
    const verRe = /(<version>|"version"\s*:)\s*["']?(\d+\.\d+\.\d+[^<"',\s]*)/;
    console.log(`# 版本号占面 — 全分支 × ${pth}`);
    for (const ref of refs) {
      const c = git(['show', `${ref}:${pth}`], mainRoot, true);
      if (c === null) continue;
      const m = c.split('\n').map((l) => l.match(verRe)).find(Boolean);
      console.log(`  ${ref}${ref === cur ? '（当前）' : ''}: ${m ? m[2] : '（未声明）'}`);
    }
    console.log('并行分支撞号时后建让位（历史撞号先例）；semver 有语义，下一号人工定、写进 spec 边界节声明');
    return 0;
  }
  const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)');
  const out = git(['log', '--all', '--name-only', '--pretty=format:', '--', pth], mainRoot, true) ?? '';
  const nums = new Set();
  for (const f of out.split('\n')) { const m = f.match(re); if (m) nums.add(Number(m[1])); }
  // 占号登记计入已占用（.opencode/tasks/.reservations/——同源：查与占一个事实源）
  const resDir = path.join(tasksDir, '.reservations');
  const resRe = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)__');
  if (fs.existsSync(resDir)) for (const f of fs.readdirSync(resDir)) { const m = f.match(resRe); if (m) nums.add(Number(m[1])); }
  if (!nums.size) { console.log(`⚠ 在 ${pth} 下未发现 ${pattern}<数字> 编号文件（路径/前缀写错？）`); return 1; }
  const sorted = [...nums].sort((a, b) => a - b);
  console.log('# nextid — 共享计数器占号检查');
  console.log(`扫描：全部分支 × ${pth} × ${pattern}<数字>（含占号登记）`);
  console.log(`已占用：${sorted.map((n) => pattern + n).join(' ')}`);
  if (reserve) {
    fs.mkdirSync(resDir, { recursive: true });
    const slug = pth.replace(/[^\w.-]/g, '_');
    for (let k = sorted[sorted.length - 1] + 1; k < sorted[sorted.length - 1] + 11; k++) {
      try { fs.closeSync(fs.openSync(path.join(resDir, `${pattern}${k}__${slug}`), 'wx')); console.log(`\n→ 已占号：${pattern}${k}（登记于 .taskflow/.reservations/；任务归档时可删登记文件）`); break; }
      catch { if (k === sorted[sorted.length - 1] + 10) { console.log('⚠ 连续 10 个号被占——请人工核查登记目录'); return 1; } }
    }
  } else {
    console.log(`\n→ 下一个可用号：${pattern}${sorted[sorted.length - 1] + 1}（要独占请加 --reserve）`);
  }
  console.log('占号后写入任务 spec「边界与影响面」声明；并行任务同加编号时后建让位改名（先例：迁移 3fabae7a / 签名册 # 让位）');
  return 0;
}

/* ---------------- migrate：一次性数据搬迁（.opencode/tasks → .taskflow） ----------------
   平台中立改造的存量收尾：目录 mv + .git/info/exclude 顶替 + 待改引用清单（只报不改——
   文档改写与脏文件协调归编排层）。新旧并存时拒绝自动合并，人工核对（判定表思维）。 */
function migrateCmd() {
  const { isGit, mainRoot } = locate();
  const src = path.join(mainRoot, '.opencode', 'tasks');
  const dst = path.join(mainRoot, '.taskflow');
  if (!fs.existsSync(src)) { console.log('ℹ 未发现旧目录 .opencode/tasks/（已是新布局或未初始化）——无需迁移'); return 0; }
  if (fs.existsSync(dst)) { console.log('⚠ 新旧两目录并存——脚本不自动合并，人工核对后手动搬移剩余文件再跑一次'); return 1; }
  fs.renameSync(src, dst);
  try { fs.rmdirSync(path.dirname(src)); } catch {} // 旧父目录空则顺手清，非空（dx 有 node_modules 房客）忽略
  const excl = path.join(mainRoot, '.git', 'info', 'exclude');
  let txt = fs.existsSync(excl) ? fs.readFileSync(excl, 'utf8') : '';
  txt = txt.split('\n').filter((l) => l.trim() !== '' && !l.includes('.opencode/tasks')).join('\n');
  txt += '\n.taskflow/\n';
  fs.writeFileSync(excl, txt);
  console.log('✓ 已搬迁 .opencode/tasks/ → .taskflow/，.git/info/exclude 已顶替（.taskflow/）');
  const refs = isGit ? git(['grep', '-l', '--fixed-strings', '.opencode/tasks'], mainRoot, true) : null;
  if (refs) { console.log('⚠ 待改引用（机械替换 .opencode/tasks → .taskflow；脏文件先协调再改）：'); for (const f of refs.split('\n').filter(Boolean)) console.log(`  - ${f}`); }
  else console.log('ℹ 仓库内无 .opencode/tasks 文本引用');
  return 0;
}

/* ---------------- archive：死档案归层（merged/archived → archive/） ----------------
   活死分层：根层只住活任务；归档时顺手把过程三件套（progress/findings/decisions）
   收进 journal/（各归其位）。点名活任务拒动；幂等：已在位零动作。 */
function archiveCmd(args = []) {
  const { tasksDir, mainRoot } = locate();
  const tasks = loadTasks(tasksDir);
  const dead = (t) => t.status === 'merged' || t.status === 'archived';
  if (args.length) {
    for (const id of args) {
      const t = tasks.find((x) => x.id === id);
      if (!t) { console.log(`⚠ 未登记：${id}`); return 1; }
      if (!dead(t)) { console.log(`⚠ ${id} 状态 ${t.status} = 活任务，不归档（只有 merged/archived 入 archive/）`); return 1; }
    }
  }
  const archDir = path.join(tasksDir, 'archive');
  const JOURNAL_FILES = ['progress.md', 'findings.md', 'decisions.md'];
  const rootDead = tasks.filter(dead).filter((t) => fs.existsSync(path.join(tasksDir, t.id)));
  const archFlat = tasks.filter(dead).filter((t) => fs.existsSync(path.join(archDir, t.id))
    && JOURNAL_FILES.some((f) => fs.existsSync(path.join(archDir, t.id, f))));
  const targets = [...rootDead, ...archFlat];
  if (!targets.length) { console.log('ℹ 无可归档（没有待搬的已完结任务，journal 布局也已就位）'); return 0; }
  fs.mkdirSync(archDir, { recursive: true });
  for (const t of targets) {
    const src = fs.existsSync(path.join(tasksDir, t.id)) ? path.join(tasksDir, t.id) : path.join(archDir, t.id);
    let movedJ = 0;
    for (const f of JOURNAL_FILES) {
      const from = path.join(src, f);
      if (fs.existsSync(from)) {
        fs.mkdirSync(path.join(src, 'journal'), { recursive: true });
        fs.renameSync(from, path.join(src, 'journal', f));
        movedJ++;
      }
    }
    const dst = path.join(archDir, t.id);
    if (src !== dst) fs.renameSync(src, dst);
    appendEvent(tasksDir, { task: t.id, event: 'archive-moved' }); // 观察者事件：归层无 status 变更，只记动作（v2.69.0）
    console.log(`✓ ${t.id}${src === dst ? '（journal 归位）' : ` → archive/${movedJ ? `（journal 归位 ${movedJ} 件）` : ''}`}`);
    // managed worktree 清理（I5 的执行半边——棘轮：归档后残留第二次实证 2026-09-23，编排在 merge.md §8 但脚本从未接线）
    if (dead(t) && t.anchor === 'managed' && t.worktree && fs.existsSync(t.worktree)
        && mainRoot && path.resolve(t.worktree) !== path.resolve(mainRoot)) {
      const removed = git(['worktree', 'remove', t.worktree], mainRoot, true);
      if (removed !== null) console.log(`🧹 worktree 已清理：${t.worktree}`);
      else console.log(`⚠ worktree 移除被 git 拒绝（未提交/未跟踪文件？）→ 禁 --force，人工核查：${t.worktree}`);
    }
    // 续迭代入口：归档闭环的出口——用户下次开新会话直接复制这句重入（resume.md 第 10 步接住）。
    // 种子摘自 handoff：未勾 checkbox（已勾不混入）+「下一步」节编号列表行（v2.70.0 B1：种子常写成编号项，
    // 只认 checkbox 会漏）；两源合并去重取前 3。纯机械输出，脚本保证每次归档都在场。
    const hp = path.join(dst, 'handoff.md');
    const seeds = fs.existsSync(hp)
      ? (() => {
          const txt = fs.readFileSync(hp, 'utf8');
          const cb = txt.split('\n').filter((l) => /^\s*[-*]\s*\[\s\]/.test(l)).map((l) => l.replace(/^\s*[-*]\s*\[\s\]\s*/, '').trim());
          let inNext = false;
          const num = [];
          for (const l of txt.split('\n')) {
            if (/^##\s/.test(l)) { inNext = /^##\s*下一步/.test(l); continue; } // 「下一步」节止于下一标题（$ 在 m 模式逐行尾匹配，正则前瞻会提前截断——B1 首跑实证）
            if (inNext && /^\s*\d+\.\s*\S/.test(l)) num.push(l.replace(/^\s*\d+\.\s*/, '').trim());
          }
          return [...new Set([...cb, ...num].filter(Boolean))].slice(0, 3).map((s) => trunc(s, 46));
        })()
      : [];
    console.log(`📌 续迭代入口（下次新会话直接复制）：\n「@taskflow 继续 ${t.id} 的迭代，做<你的方向>」`);
    console.log(seeds.length ? `待办种子（摘自 handoff 未勾项/下一步编号项）：\n${seeds.map((s) => `  - ${s}`).join('\n')}` : '待办种子：handoff 无未勾项 → 翻 journal/ 与项目级 decisions/');
  }
  console.log('ℹ 根层只剩活任务；ls 缺省折叠已归档（--all 展开）');
  return 0;
}

/* ---------------- 入口 ---------------- */

const USAGE = `用法：
  node tf.mjs ls [--all]                 盘点：登记任务表 + 游离工作（只读；--all 展开已归档；无活任务时打印可续迭代入口句）
  node tf.mjs doctor [--all] [--self] [--data <path>] [task-id]  体检：不变量逐条检查（缺省=active/verifying + 根层死任务，--all 含 archive/ 内 merged）；--self=不变量 spec↔注册表↔实现 三源一致性（--data 指 spec 副本，测试用）（只读）
  node tf.mjs reconcile [--fix]         对账：I1 回写/幽灵清理/损坏报告；默认 dry-run，--fix=原子回写（唯一写命令，幂等）
  node tf.mjs scout <关键词…> [--files]  历史检索：约定→决策库→任务档案→git 考古；命中=线索，判断归模型（只读）
  node tf.mjs skills [领域词]           领域技能在场检测：缺哪些+怎么装；呈用户选装（不装则如实注记）（只读）；--usage=技能加载埋点报表（TF_SKILL_USAGE 单文件聚合，仅 omp 侧显式 skill:// 加载计数）
  node tf.mjs accept <task-id> [--pass]  缺省=验收简报：任务是什么/部署状态/验什么/怎么验/怎么回复；--pass=机械翻转 *→merged（前置=分支已并入主分支，幂等）
  node tf.mjs takeover <task-id> --session <本会话ID>  接管仪式：改 sessionID + 重写 .owner.json + 刷新 lease + 打印桌面清点清单（清点判断归编排层）
  node tf.mjs park <task-id> --reason "<原因>"   搁置在途任务（active→parked，簿记写入口）——档案保留、体检（缺省）与 G 门不再盘点；等验收中（含部署态）拒
  node tf.mjs unpark <task-id>                    恢复搁置任务（parked→active，簿记写入口）
  node tf.mjs commit -m "…" [--files|--all] [--session <本会话ID>] [--deployed [部署注记]]  安全提交：不声明范围=拒绝；--session 乐观锁（属主不符拒写，空则回填）；--deployed 部署扳机（active→verifying+deploy 记录+index 同步）；提交后报桌上剩余；首个 commit 自动锚定 goalHash
  node tf.mjs req-confirm <task-id> --note "<拍板记录>"  需求变更门落痕：刷新 goalHash + reqChanges 追加 + index 同步（spec 承重节变更的唯一合法写路径；--note 必填）
  node tf.mjs testplan [task-id] [--files]  测试计划选择器：按改动集命中规则表 → 四道门计划（只读；知识层 references/testing.md）
  node tf.mjs diagnose <task-id>          诊断证据包：提交史/改动集/测试资产/.testbed 运行/六步提示（只读）
  node tf.mjs nextid --pattern V --path <路径> [--reserve|--versions]  共享计数器占号（扫全分支/--reserve 原子占号/--versions 版本占面）
  node tf.mjs lock <name> [--release] [--session <本会话ID>] [--ttl <秒=120>]  排队锁：合并端局等关键窗口串行化（他人新鲜锁 → 拒绝排队；陈旧 → 强占；--release 释放/幂等）
  node tf.mjs snapshot <task-id>            合并快照：审查呈报后拍 main HEAD（事务 ID 类比）写入 task.json.mergeSnapshot
  node tf.mjs mergegate <task-id>           合并双门（MERGE_GATE）：①快照门（文件级分类）——main 现值≠审查快照时比对「main 变更×任务读写集」：命中=红（逐文件重审）、未触碰=黄（同步合并+刷新快照免第 3 步重审；黄红均 exit 1）；②越界门——分支 diff 超出 spec「改动文件集合声明」（matchPath 目录前缀）=红（req-confirm 补声明或收窄）
  node tf.mjs gates <task-id>               门责任链聚合（只读）：快照/越界/已并入预检/stale/I16 敞口 五道门一次跑完，统一「门名：过/红/黄——一句原因」表+verdict 收尾；逐门完整处置指引跑 mergegate
  node tf.mjs revert-plan <task-id>         Saga 补偿方案生成器（只读不执行）：为 merged 任务生成逐条 git revert -m 1 方案落 <taskDir>/revert-plan.md（含档案注记与红线）；非 merged 拒（active/verifying 打回走 resume.md 第 9 步）；执行需用户逐条确认
  node tf.mjs stale [task-id]              在途任务失效感知（STALE_CHECK，v2.59.0）：main 自任务基线 baseCommit 的改动 × 本任务读写集（写集声明∪影响面地图反引号资产）求交——命中=影响面漂移，先重验 spec 影响面地图对应行再动工；无 id 全量扫 active/verifying；无基线锚/分支已并入 main/无机读声明均 ℹ 降级（只读，不改任何状态）
  node tf.mjs overlap <task-id>            并行派发准入预检（DISPATCH_OVERLAP，v2.59.0）：子任务 spec「## 涉及文件」反引号路径两两 matchPath 求交——重叠对=不准并行（场景① 前提=写集两两不相交：改串行/调整拆分边界/呈用户仲裁）；无子任务 ℹ exit 0（只读）
  node tf.mjs impact [--files f1,f2,…] [--since <git-ref>]  牵连排查+数据边界机械保底（J19/J20，v2.72.0，只读恒 exit 0）：缺省文件集=active/verifying 任务 baseCommit..HEAD 改动（无 baseCommit 用主分支..HEAD；无在档任务=已暂存+工作区改动；--since 覆盖区间）——逐文件 basename 引用计数/清单（前 5 处）+数据管道特征（J20 风险标注）；阈值 TF_IMPACT_THRESHOLD（缺省 3）；语义级影响面用 code-review-graph impact（如已挂载）
  node tf.mjs deploy --branch <部署分支> [--web-only] [--dry-run] [--version V]  部署唯一入口：门禁（deploy-preflight）内嵌，红=拒绝；部署后自动 --record 登记（project.json deploy 配置命令序列；deploy.procProbe 可选=进程清点探针命令，透传 --proc-probe）
  node tf.mjs migrate                      一次性数据搬迁：.opencode/tasks/ → .taskflow/（exclude 顶替+待改引用清单；并存拒动）
  node tf.mjs archive [task-id]            死档案归层：merged/archived → archive/（journal 三件套归位；活任务拒动；幂等；输出可复制的续迭代入口句）
  node tf.mjs svc ls                       服务端口租约清单：端口/服务/任务/会话/pid + 活性标注 live/pid未登记/stale（orphan 为独立后缀，复合态并列）（只读）
  node tf.mjs svc claim <service> --port <p> [--task <id>] [--session <ses>] [--pid <pid>] [--note <注记>]  声明端口：空闲→登记；被占→拒绝+报告占用者+建议让位（绝不 kill）；同 task 重跑→补登/回收死租约（簿记写入口）
  node tf.mjs svc release <port>           释放端口租约（停服动作归编排层；不在册拒绝；簿记写入口）
  node tf.mjs lint                         流程文档自检：步骤引用/编号连续/兼容标注/闸门关键词/未入库引用/机制触点可达/机制fixture落痕/事实禁改写/模板中性/挂接对账（只读）
  环境变量 TF_STATUS=<off|warn|enforce>    守门 J 状态翻转墙档位（v2.69.0；缺省 enforce——手改 task.json/index.json 的 status 物理拦截，翻转唯一写路径是扳机命令，档案修复走 reconcile --fix；off=单次豁免）
  环境变量 TF_VERIFY_WARN=off              关闭守门 K 验收期提醒（v2.69.0；git push/merge 时在档等验收任务的时序核对提醒，缺省开，提醒不拦）
  环境变量 TF_IMPACT_THRESHOLD=<N 缺省 3>  basename 引用文件数阈值（impact 命令与守门 J19 共用）；TF_J19_WARN / TF_J20_WARN=off 各自关闭守门 J19/J20 提醒（v2.72.0；缺省 warn，纯提醒不拦、无 enforce 档）
  node tf.mjs mech ls                      机制采纳清单：token/状态（已装/可装/漂移）+ 产物（只读；真相源=机制登记表「采纳产物」列）
  node tf.mjs mech check                   机制采纳对账：每机制 token/已装版本/当前版本/状态（一致|漂移|未装）；声明采纳者有漂移 → exit 1（统一谓词，doctor 采纳对账同源；只读）
  node tf.mjs mech install <token> [--yes] 机制生成安装：assets/harness+design 模板渲染入项目（assetExts 注入）+ docs/CHANGELOG.md 建档锚点 + conventions/AGENTS 补记 + project.json.mechanisms 登记（簿记写入口；幂等；CI 挂点只建议不自动改——经确认门写入）。确认闸（v2.65.0）：已装版本漂移刷新或将整文件覆盖已有文件 → 拒绝落盘并打印将覆盖文件清单，显式 --yes 才执行；首装空位不拦（懒加载，首装确认归 DEP_ASK_GATE 呈报流程）
退出码：0 正常/全绿/账目一致；1 有差异/有待修项/缺参数/有缺技能。不变量 spec：references/data.md；判断与叙事修复归编排层。`;

/* ---------------- mech：机制采纳（ls/check 只读 / install 生成式安装——簿记写入口，v2.29.0；v2.65.0 --yes 确认闸 + 统一采纳对账谓词） ----------------
   治「机制定义在技能、执行体在项目、装没装无追踪」（2026-09-27 六缺陷之一）：机制本体住技能仓库 assets/，
   install 渲染到项目（assetExts 注入），采纳登记 project.json.mechanisms，doctor 采纳对账产物存在性。
   采纳对账检测单点 = mechAdoptionRows（ls/check/doctor 三口同源，2026-10-16 用户拍板「检查、配置统一入口」）；
   install 确认闸 = 漂移刷新/整文件覆盖已有文件须显式 --yes（DEP_ASK_GATE 机械面），首装空位不拦（懒加载保留）。
   CI 挂点只建议不自动改（改 workflow 属高影响，归确认门）。 */
function mechRegistry() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let text = ''; try { text = fs.readFileSync(path.join(root, 'references', 'data.md'), 'utf8'); } catch {}
  const m = text.match(/## 机制登记表[\s\S]*?(?=\n## |$)/);
  const reg = new Map();
  if (!m) return reg;
  for (const line of m[0].split('\n')) {
    if (!/^\|/.test(line) || /^\|[-: |]+$/.test(line) || /^\| *token/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6 || !cells[1]) continue;
    reg.set(cells[1], {
      def: cells[2] ?? '', touch: cells[3] ?? '',
      products: (cells[4] ?? '').split(/[、,;]/).map((s) => s.trim()).filter((s) => s && !s.startsWith('—')), // v2.54.0 幻影产物过滤：—（说明）整串曾被当产物名（全角；不在切分集）——6 token 永久假漂移+全家渲染（对抗审查实证）；说明归定义处/检测列
      fixture: cells[5] ?? '',
    });
  }
  return reg;
}
function skillVersion() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let fm = ''; try { fm = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8').split('---')[1] ?? ''; } catch {}
  return R(fm.match(/version:\s*(.+)/)?.[1] ?? '') || 'unknown';
}
/* 统一采纳对账谓词（v2.65.0 单一定义点）：mech ls / mech check / doctor 采纳对账三处共用同一份状态机——
   检测逻辑禁止分散（用户 2026-10-16 拍板「检查、配置必须统一入口」；反面风险：doctor 与 mech 各写一份判定，
   口径漂移后同一账两个结论）。状态三值：一致 / 漂移 / 未装；漂移细分 reason：未登记（project.json 声明但技能
   登记表无此 token）/ 产物缺失 / 版本不符（陈旧快照）。陈旧快照判定与 v2.29.0 语义一致：声明项无 version 字段
   = 一致（不做版本强求），有 version 且 ≠ 技能当前版本 = 漂移。 */
function mechAdoptionRows({ mainRoot, pj, reg = mechRegistry(), cur = skillVersion() }) {
  const declaredMap = (pj && pj.mechanisms && typeof pj.mechanisms === 'object' && !Array.isArray(pj.mechanisms)) ? pj.mechanisms : {};
  const rows = [];
  for (const token of [...new Set([...reg.keys(), ...Object.keys(declaredMap)])]) {
    const row = reg.get(token) ?? null;
    if (!Object.prototype.hasOwnProperty.call(declaredMap, token)) {
      if (row) rows.push({ token, declared: false, status: '未装', reason: null, installedVersion: null, currentVersion: cur, products: row.products, missing: [] });
      continue;
    }
    const decl = declaredMap[token] ?? {};
    if (!row) { rows.push({ token, declared: true, status: '漂移', reason: '未登记', installedVersion: decl.version ?? null, currentVersion: cur, products: [], missing: [] }); continue; }
    const missing = row.products.filter((p) => !fs.existsSync(path.resolve(mainRoot, p)));
    if (missing.length) { rows.push({ token, declared: true, status: '漂移', reason: '产物缺失', installedVersion: decl.version ?? null, currentVersion: cur, products: row.products, missing }); continue; }
    const dv = decl.version ?? null;
    const stale = dv !== null && dv !== cur;
    rows.push({ token, declared: true, status: stale ? '漂移' : '一致', reason: stale ? '版本不符' : null, installedVersion: dv, currentVersion: cur, products: row.products, missing: [] });
  }
  return rows;
}
function detectAssetExts(cwd) {
  const allow = new Set(['vue', 'ts', 'js', 'mjs', 'jsx', 'tsx', 'kt', 'java', 'swift', 'py', 'go', 'rs', 'c', 'cpp', 'h', 'cs']);
  const out = git(['ls-files'], cwd, true) ?? '';
  const count = new Map();
  for (const f of out.split('\n').filter(Boolean)) {
    const ext = f.includes('.') ? f.split('.').pop() : '';
    if (allow.has(ext)) count.set(ext, (count.get(ext) ?? 0) + 1);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0]);
  return top.length ? top.join('|') : 'java|kt|ts|js|vue';
}
/* install 的项目侧锚点/补记原文（per-token；决策组合门条目 = 2.29.0 硬编码的逐字节迁移——输出不变）。
   convMarkers/agMarkers 含 token 备选：既有项目把规则合并进自定义小节时（含 token 字样）不重复追加。 */
const MECH_PROSE = {
  '决策组合门': {
    anchor: '决策组合门落地',
    newFile: (d) => `# CHANGELOG\n\n## ${d} — 决策组合门落地\n\n- 本条为门锚点：之上为受管区（新条目插这里），之下历史条目祖父豁免\n- 条目格式：做了什么 / 涉及文件 / commits；反引号资产命中 .taskflow/decisions/ → 须含「组合评估：」行（列全量命中决策或「语义中性——理由」）\n`,
    insertBody: '- 门锚点（mech install 补写）：之上为受管区，之下历史条目祖父豁免\n',
    convMarkers: ['## 机制：决策组合门（mech install'],
    convText: (d) => `\n## 机制：决策组合门（mech install 生成 ${d}）\n\n- 验证清单新增（收尾必跑）：\`bash scripts/harness/validate-changelog.sh\`（内含决策组合门——改命中 .taskflow/decisions/ 资产的条目须含「组合评估：」行；内含同类排查检查——修复类条目【触发词 修复的bug/bugfix/hotfix 等七式】条目块内须含「同类排查：」与「出现次数」，硬规则 25）\n- 台账纪律：决策文档「影响范围」必须列文件/类名标识符（门 grep 的数据源）；资产改名回写\n- CHANGELOG 纪律：新条目插「决策组合门落地」锚点之上（受管区）；格式=做了什么/涉及文件/commits\n`,
    convLog: '✓ conventions.md 补记（验证清单+台账纪律+CHANGELOG 纪律）',
    agMarkers: ['## 决策组合门（taskflow mech install'], // v2.54.0 判重收紧为生成标题形态：裸 token 会被普通句子命中=镜像静默跳过（对抗审查实证）
    agText: () => `\n## 决策组合门（taskflow mech install 生成）\n\n- 改动命中 .taskflow/decisions/ 资产的收尾，CHANGELOG 条目须含「组合评估：」行；修复类条目块内须含「同类排查：」+「出现次数」（硬规则 25）；收尾必跑 scripts/harness/validate-changelog.sh\n`,
  },
  STYLE_SOURCE_GATE: {
    anchor: '样式真源门落地',
    newFile: (d) => `# CHANGELOG\n\n## ${d} — 样式真源门落地\n\n- 本条为门锚点：之上为受管区（新条目插这里），之下历史条目祖父豁免\n- 条目格式：做了什么 / 涉及文件 / commits；反引号资产命中样式真源目录 docs/ui/style-source/（不带反引号的本行不算）→ 须含「样式拍板：」行（大白话：现在→改成→为什么→用户拍板，记录见 STYLE_DECISIONS.md）或「样式拍板：语义中性——理由」\n`,
    insertBody: '- 门锚点（mech install 补写）：之上为受管区，之下历史条目祖父豁免\n',
    convMarkers: ['## 机制：前端样式真源门（mech install'], // v2.54.0 收紧：裸 token 曾被模板占位行自抑制（conventions 永久「未初始化」假象）
    convText: (d) => `\n## 机制：前端样式真源门（mech install 生成 ${d}）\n\n- **样式全局真源** = \`docs/ui/style-source/\`（prototype/ 定稿 HTML/CSS/JS + spec-*.json 规格表 + STYLE_DECISIONS.md 拍板日志）——已定稿样式的唯一口径，进 git\n- **两门**：①改真源文件 → 先大白话拍板（现在长这样→改成长这样→为什么→改不改？用户决定）+ 拍板记录追加 STYLE_DECISIONS.md + CHANGELOG「样式拍板：」行，缺=收尾红灯；②App 样式实现偏离规格表 → merge 阶段三产物一致性以真源为准绳，未拍板偏离=阻塞（STYLE_SOURCE_GATE，硬规则 20）\n- 验证清单新增（收尾必跑）：\`bash scripts/harness/validate-changelog.sh\`（内含样式真源门）\n`,
    convLog: '✓ conventions.md 补记（样式真源两门+验证清单）',
    agMarkers: ['## 前端样式真源门（taskflow mech install'],
    agText: () => `\n## 前端样式真源门（taskflow mech install 生成）\n\n- docs/ui/style-source/ 是样式全局真源；改真源须大白话拍板（现在→改成→为什么→用户决定）+ STYLE_DECISIONS.md 留痕 + CHANGELOG「样式拍板：」行；收尾必跑 scripts/harness/validate-changelog.sh（STYLE_SOURCE_GATE）\n`,
  },
  DESIGN_SPEC_EXTRACT: {
    anchor: '规格表门落地',
    newFile: (d) => `# CHANGELOG\n\n## ${d} — 规格表门落地\n\n- 本条为门锚点：之上为受管区（新条目插这里），之下历史条目祖父豁免\n- 条目格式：做了什么 / 涉及文件 / commits；涉及前端视觉资产（res/ 布局资源或 .vue/.tsx/.jsx/.css 等）→ 须含「规格表：」行（指向 spec-extract*.json 或「规格表：不适用——理由」）\n`,
    insertBody: '- 门锚点（mech install 补写）：之上为受管区，之下历史条目祖父豁免\n',
    convMarkers: ['## 机制：原型规格表门（mech install'],
    convText: (d) => `\n## 机制：原型规格表门（mech install 生成 ${d}）\n\n- **前端原型拍板后必须机械提取规格表**（\`scripts/design/extract-spec.js\`：浏览器上下文逐元素提取——显式 DOM 树 + 布局语义 + 全量 computed styles + 伪元素）落 \`.taskflow/<id>/design/spec-extract.json\` + \`spec-extract.md\` 结构树摘要；规格表是子任务 spec 附件与验收对照物，**禁止编排层凭记忆转述原型**（DESIGN_SPEC_EXTRACT，硬规则 19；四轮返工实证）\n- 验证清单新增（收尾必跑）：\`bash scripts/harness/validate-changelog.sh\`（内含原型规格表门——涉及前端视觉资产的条目须含「规格表：」行）\n`,
    convLog: '✓ conventions.md 补记（原型规格表门）',
    agMarkers: ['## 原型规格表门（taskflow mech install'],
    agText: () => `\n## 原型规格表门（taskflow mech install 生成）\n\n- 前端原型拍板后跑 \`scripts/design/extract-spec.js\` 机械提取规格表（结构+样式固化）；实现/派发/验收只认规格表，禁止凭记忆转述原型（DESIGN_SPEC_EXTRACT）；涉及前端视觉资产的 CHANGELOG 条目须含「规格表：」行；收尾必跑 scripts/harness/validate-changelog.sh\n`,
  },
  APP_PAGE_BASELINE: {
    anchor: '现状基线门落地',
    newFile: (d) => `# CHANGELOG\n\n## ${d} — 现状基线门落地\n\n- 本条为门锚点：之上为受管区（新条目插这里），之下历史条目祖父豁免\n- 条目格式：做了什么 / 涉及文件 / commits；涉及前端视觉资产（res/ 布局资源或 .vue/.tsx/.jsx/.css 等）→ 须含「基线：」行（指向 baseline*.json 或「基线：不适用——理由」，如新增页面）\n`,
    insertBody: '- 门锚点（mech install 补写）：之上为受管区，之下历史条目祖父豁免\n',
    convMarkers: ['## 机制：现状基线门（mech install'],
    convText: (d) => `\n## 机制：现状基线门（mech install 生成 ${d}）\n\n- **App 现状页 = 「长什么样」的唯一事实**（APP_PAGE_BASELINE，硬规则 21）：改现有页面的前端原型任务，立项时先跑 \`scripts/design/extract-app-baseline.js\` 机械提取现状基线（Android：截图 + 结构树 + @color/@dimen token 解析；web：extract-spec.js 指向运行中的真实站点）落 \`.taskflow/<id>/design/baseline/\`；原型 = 基线 + 显式 delta，未改区域禁从零重画；已定稿原型/规格表 = 意图输入源，与现状冲突呈报用户裁决（App 漂移补样式拍板 / 原型过时回写真源）\n- 验证清单新增（收尾必跑）：\`bash scripts/harness/validate-changelog.sh\`（内含现状基线门——涉及前端视觉资产的条目须含「基线：」行）\n`,
    convLog: '✓ conventions.md 补记（现状基线门）',
    agMarkers: ['## 现状基线门（taskflow mech install'],
    agText: () => `\n## 现状基线门（taskflow mech install 生成）\n\n- 改现有页面的原型任务立项时跑 \`scripts/design/extract-app-baseline.js\` 提取 App 现状基线（App=最新事实主源，原型=意图输入，冲突呈报裁决）；涉及前端视觉资产的 CHANGELOG 条目须含「基线：」行；收尾必跑 scripts/harness/validate-changelog.sh（APP_PAGE_BASELINE）\n`,
  },
  DEPLOY_GATE: {
    anchor: '部署协调门落地',
    newFile: (d) => `# CHANGELOG\n\n## ${d} — 部署协调门落地\n\n- 本条为门锚点：之上为受管区（新条目插这里），之下历史条目祖父豁免\n- 条目格式：做了什么 / 涉及文件 / commits；部署类条目须含「预检：」行（node scripts/harness/deploy-preflight.mjs 结果，或「预检：不适用——理由」）\n`,
    insertBody: '- 门锚点（mech install 补写）：之上为受管区，之下历史条目祖父豁免\n',
    convMarkers: ['## 机制：部署协调门（mech install'],
    convText: (d) => `\n## 机制：部署协调门（mech install 生成 ${d}）\n\n- **部署前必跑**：\`node scripts/harness/deploy-preflight.mjs --branch <部署分支>\`——实况核验（实测服务器 jar md5 与基线比对，不符=红：未登记部署/手工动包）+ 血统门（live-state 基线的线上 commit ⊆ 部署分支）；红 = **并集优先**：先 merge 线上任务分支再构建部署，拒绝直接上（DEPLOY_GATE，硬规则 23；2026-09-29 治理被静默滚回等四起覆盖事故拍板）\n- **部署收尾必跑登记**：\`--record --branch ... --commit ... --jar-md5 ... --version ... --jar-path <服务器jar路径>\` 更新 live-state——不登记的部署 = 下次预检必红（实况核验 md5 必不符）；web-only 部署收尾 \`--record --web-only --web-version ...\`（jar 沿用基线，禁手抄四件套）\n- **租约与让位 + 验收即合并**：部署租约由 \`tf.mjs deploy\` 入口自管（ttl 1800）——**无需也不应先手动 lock deploy，手动持锁后跑入口会撞自己的锁（2026-10-09 实证）**；锁为本地 clone 级——跨用户/跨机并行互不可见，跨机场景靠实况核验+血统门兜底并人工协调；任一任务 verifying 期间非并集/非本体的部署让位（其分支不在部署分支血统 = 预检红）；用户回「验收通过」= 立即 merge main + main 重建替换包\n- 细则唯一载体：技能 references/deploy-gate.md（项目适配 --server/--state-path/--state-file）\n`,
    convLog: '✓ conventions.md 补记（部署协调四件套）',
    agMarkers: ['## 部署协调门（taskflow mech install'],
    agText: () => `\n## 部署协调门（taskflow mech install 生成）\n\n- 部署前必跑 scripts/harness/deploy-preflight.mjs 预检（实况核验 md5 不符=基线不可信先补正；血统门红=并集优先：先 merge 线上任务分支再构建）；部署收尾必跑 --record（含 --jar-path，web-only 用 --record --web-only 沿用基线 jar）；部署租约由 tf.mjs deploy 入口自管（ttl 1800，无需手动 lock——手动持锁会撞自己的锁）；verifying 期间非并集/非本体部署让位（预检机械拦）；验收通过=立即合并 main + main 重建替换包（DEPLOY_GATE）\n`,
  },
  DEPLOY_ENTRY: {
    anchor: '部署唯一入口落地',
    newFile: (d) => `# CHANGELOG\n\n## ${d} — 部署唯一入口落地\n\n- 本条为门锚点：之上为受管区（新条目插这里），之下历史条目祖父豁免\n- 条目格式：做了什么 / 涉及文件 / commits；部署类条目须含「预检：」行（tf.mjs deploy 输出含 preflight 结果，或「预检：不适用——理由」）\n`,
    insertBody: '- 门锚点（mech install 补写）：之上为受管区，之下历史条目祖父豁免\n',
    convMarkers: ['## 机制：部署唯一入口（mech install'], // v2.54.0 删裸 'tf.mjs deploy'（项目一句「部署统一走 tf.mjs deploy」即命中=镜像静默跳过，对抗审查实证）
    convText: (d) => `\n## 机制：部署唯一入口（mech install 生成 ${d}；DEPLOY_GATE v2.42.0 四件套①）\n\n- **部署必经** \`node <skill目录>/scripts/tf.mjs deploy --branch <部署分支> [--web-only] [--version V]\`：门禁（deploy-preflight 实况核验+血统门+verifying 让位）内嵌于入口——红=拒绝执行（并集优先），绿=按 project.json deploy 配置（server/statePath/jarPath/commands/webCommands）逐条执行 → 自动 --record 登记。命令序列自带备份回滚点。\n- **绕过入口的手工部署 = 漏登记 = doctor I17 实况对账必红**（2026-09-30 双包事故根因：血统门本可拦，部署会话没跑 preflight 且 preflight 不在部署确认清单——治法=物理上跳不过）\n- 部署确认清单第⓪项即「必经 deploy 入口」；占号预检（nextid）仍为第①项\n`,
    convLog: '✓ conventions.md 补记（部署唯一入口）',
    agMarkers: ['## 部署唯一入口（taskflow mech install'],
    agText: () => `\n## 部署唯一入口（taskflow mech install 生成）\n\n- 部署必经 node <skill目录>/scripts/tf.mjs deploy --branch <部署分支>（门禁内嵌：红=拒绝；绿=按 project.json deploy 配置执行+自动 --record 登记）；绕过=漏登记=doctor I17 对账必红；verifying 敞口超 24h=I16 红（收口链：merge main → main 重建替换包 → accept --pass——accept 前置=已并入主分支，顺序勿反）\n`,
  },
  TASKFLOW_GUARD: {
    anchor: '宿主防护层落地',
    newFile: (d) => `# CHANGELOG\n\n## ${d} — 宿主防护层落地\n\n- 本条为门锚点：之上为受管区（新条目插这里），之下历史条目祖父豁免\n- 条目格式：做了什么 / 涉及文件 / commits\n`,
    insertBody: '- 门锚点（mech install 补写）：之上为受管区，之下历史条目祖父豁免\n',
    convMarkers: ['## 机制：宿主防护层（mech install'],
    convText: (d) => `\n## 机制：宿主防护层（mech install 生成 ${d}；TASKFLOW_GUARD，omp extension 住 .omp/hooks/pre/taskflow-guard.js）\n\n- **D 状态栏常显**：进行中N/等你验收M/已上线超24小时未合并K（v2.56.0 起人话化，原「N活 M待验收 ⚠敞口K」）常驻 omp 底栏（I16 的持续可见性）\n- **B 簿记校验**：\`tf.mjs commit --files\` 空格分隔多文件被宿主硬拦（逗号分隔才对）；\`deploy\` 缺 \`--web-only\` 且项目配置了 webCommands → 注入提醒\n- **C 压缩接力注入**：压缩摘要自动携带 taskflow 接力线索（任务 id/状态/分支 + 恢复入口）——铁律「先存档再跑」的宿主兜底\n- **E 输出规范注入**：每轮把「术语/代号/缩写首现后跟括号大白话 + 项目词表」前置进 system——词表活读 \`.taskflow/glossary.md\`，用户说看不懂当场改写，下一轮生效（v2.56.1 升级）\n- **I 词表反馈沉淀**：检测「看不懂」类反馈计数，词表未改写则逐轮注入沉淀指令（可能猜错不拦操作）、压缩时兜底——「反馈→沉淀」宿主闭环（v2.57.0）\n- **A 部署墙**：rsync/scp（/opt、.jar、/web 特征）与 ssh+systemctl restart 疑似绕过部署唯一入口——**默认警告**（additionalContext），观察稳定后项目环境变量 \`TF_WALL=enforce\` 切硬拦；\`TF_WALL=off\` 单次跳过（留痕）\n- **F 派发门**：子代理派发词引用 subtask spec 路径 → 宿主校验必填节（背景/目标/验收/涉及文件/约束与禁止）后机械注入 spec 全文——凭记忆转述物理失效；引用了 spec 但缺文件/空节 = 硬拦；未引用 = 提醒\n- **G 编辑边界门**：edit/write 路径对照任务声明清单（spec「边界与影响面」+ subtasks「涉及文件」），越界默认警告，观察稳定后 \`TF_BOUND=enforce\` 切硬拦；\`off\` 单次跳过（留痕）\n- **H 同类排查提醒**：子代理报告（task-result）含「阻塞/blocker/卡点」字样 → 注入人话三问提醒（v2.61.0 触发源收紧：普通对话/工具图例/自家提醒不再误触发；开头声明可能猜错、不拦任何操作；三个问题=上游/下游/同类，同类排查 CLASS_SWEEP_GATE 硬规则 25；报告说「无阻塞」或仅讨论词语本身可忽略）——只提醒不拦；修复 diff 须附扩散面清单\n- **J 状态翻转墙**（v2.69.0）：edit/write/bash 手改 task.json/index.json 的 status/deploy.status = 物理拦截（TF_STATUS 三档：缺省 enforce 硬拦 / warn 提醒 / off 单次豁免）——翻转唯一合法写路径 = 扳机命令，档案修复走 \`node tf.mjs reconcile --fix\`\n- **K 验收期提醒**（v2.69.0）：等验收任务在档时 git push/merge → 合并时序核对提醒（不拦，部署服务器拉取属合法流量；TF_VERIFY_WARN=off 关）\n- **T 技能埋点**（v2.69.0）：skill:// 显式读取计数入全局 skill-usage.jsonl（零内容仅计数，不受采纳闸控，供 \`node tf.mjs skills --usage\` 报表）\n`,
    convLog: '✓ conventions.md 补记（宿主防护层功能清单）',
    agMarkers: ['## 宿主防护层（taskflow mech install'],
    agText: () => `\n## 宿主防护层（taskflow mech install 生成）\n\n- .omp/hooks/pre/taskflow-guard.js 为 omp extension（文案 v2.56.1 人话化）：状态栏常显（进行中N/等你验收M/已上线超24小时未合并K）、commit --files 空格分隔硬拦、压缩摘要注入 taskflow 接力线索、每轮注入输出规范（术语首现后跟括号大白话 + 项目词表 glossary.md 活读）、部署特征命令警告（TF_WALL=enforce 硬拦 / off 跳过）、派发 spec 机械注入（凭记忆转述失效）、越界编辑警告（TF_BOUND=enforce 硬拦 / off 跳过）、子代理报告（task-result）含「阻塞」字样返回人话三问提醒（v2.61.0 来源限定：普通对话与图例不触发；声明可能猜错、不拦任何操作）、词表反馈沉淀（检测「看不懂」反馈、词表改写前逐轮提醒+压缩兜底）、状态翻转墙（edit/write/bash 手改 task.json/index.json 的 status 物理拦截，TF_STATUS 缺省 enforce / warn / off 单次豁免；翻转唯一写路径=扳机命令，档案修复走 reconcile --fix）、验收期 git 提醒（等验收任务在档时 push/merge 先提醒合并时序，不拦，TF_VERIFY_WARN=off 关）、技能加载埋点（skill:// 读取计数，供 tf.mjs skills --usage 报表，不受采纳闸控）；卸载=删文件+清 project.json.mechanisms.TASKFLOW_GUARD（TASKFLOW_GUARD）\n`,
  },
  REQ_ANCHOR_GATE: {
    anchor: '基线对照门落地',
    newFile: (d) => `# CHANGELOG\n\n## ${d} — 基线对照门落地\n\n- 本条为门锚点：之上为受管区（新条目插这里），之下历史条目祖父豁免\n- 条目格式：做了什么 / 涉及文件 / commits；涉及功能代码条目须含「文档同步：」行，列更新的 PRD 条目 ID（如 F-XX-NN）——引 PRD 路径必须落到条目粒度；触及 docs/prd/** 禁写「不适用」\n`,
    insertBody: '- 门锚点（mech install 补写）：之上为受管区，之下历史条目祖父豁免\n',
    convMarkers: ['## 机制：需求基线对照门（mech install'],
    convText: (d) => `\n## 机制：需求基线对照门（mech install 生成 ${d}）\n\n- **每条验收标准挂 PRD 条目锚**（行尾「基线：F-XX-NN / US-XX-NN」；REQ_ANCHOR_GATE，硬规则 27）——挂不上任何条目 = PRD 静默区 → spec「基线外条目草案」节登记（口径原文/出处血缘/PRD 去向预填空号）并**经用户确认后才动工**；草案收尾强制升格 PRD 正式条目（含出处 iter-comment）或显式豁免拍板留痕\n- **merge 阶段一必跑**：\`bash scripts/harness/validate-baseline-anchor-gate.sh --spec <spec.md>\`（锚存在性/非法锚形态/草案升格/PRD 反向留痕/goalHash 五检查，红=阻塞项回修复循环；「见方案稿/原型/见上/待补」不是合法锚）\n- 验证清单新增（收尾必跑）：\`bash scripts/harness/validate-changelog.sh\`（内含基线对照门——「文档同步：」行列出的条目 ID 必须真实存在、引 PRD 路径必须落条目粒度、触及 docs/prd/** 禁写「不适用」）\n`,
    convLog: '✓ conventions.md 补记（基线对照门挂锚纪律+收尾链）',
    agMarkers: ['## 需求基线对照门（taskflow mech install'],
    agText: () => `\n## 需求基线对照门（taskflow mech install 生成）\n\n- 每条验收标准行尾挂 PRD 条目锚（基线：F-XX-NN）；挂不上=PRD 静默区，登记「基线外条目草案」经用户确认后动工，收尾强制升格 PRD；merge 阶段一跑 validate-baseline-anchor-gate.sh --spec（红=阻塞项）；收尾必跑 validate-changelog.sh（文档同步行条目 ID 必须真实存在、引 PRD 路径落条目粒度）；「见方案稿/原型/见上/待补」不是合法锚（REQ_ANCHOR_GATE）\n`,
  },
};
function mechCmd(args = []) {
  const yes = args.includes('--yes'); // v2.65.0 确认闸旗标（任意参数位）
  const sub = args[0];
  const { isGit, mainRoot, tasksDir } = locate();
  const reg = mechRegistry();
  const pjPath = path.join(tasksDir, 'project.json');
  const pj = fs.existsSync(pjPath) ? readJson(pjPath) : null;
  const nowIso = new Date().toISOString();
  if (sub === 'check') { // 统一采纳对账出口（v2.65.0）：与 doctor 采纳对账同谓词同结论——检测单点，doctor 只渲染消息
    console.log('# taskflow 机制采纳对账（统一谓词，doctor 采纳对账同源）');
    console.log(`项目：${mainRoot}`);
    let drift = 0, aligned = 0, fresh = 0;
    for (const r of mechAdoptionRows({ mainRoot, pj, reg })) {
      if (!r.declared) { fresh++; console.log(`- ${r.token} — 未装（可装；首装不经确认闸，安装确认由 DEP_ASK_GATE 呈报流程负责）`); continue; }
      if (r.status === '一致') { aligned++; console.log(`- ${r.token} — 一致（v${r.installedVersion ?? '未记版本'}，产物齐全）`); continue; }
      drift++;
      if (r.reason === '未登记') console.log(`- ${r.token} — 漂移（声明采纳但不在技能机制登记表）→ 升级技能或清 project.json.mechanisms 对应项`);
      else if (r.reason === '产物缺失') console.log(`- ${r.token} — 漂移（产物缺失：${r.missing.join('、')}）→ node tf.mjs mech install ${r.token} 重渲染`);
      else console.log(`- ${r.token} — 漂移（登记 v${r.installedVersion} ≠ 技能 v${r.currentVersion}）→ node tf.mjs mech install ${r.token} --yes 刷新（将覆盖文件清单先行）`);
    }
    console.log(`对账结论：${aligned} 一致 / ${drift} 漂移 / ${fresh} 未装`);
    return drift ? 1 : 0;
  }
  if (!sub || sub === 'ls') {
    console.log('# taskflow 机制采纳清单');
    console.log(`项目：${mainRoot}`);
    for (const r of mechAdoptionRows({ mainRoot, pj, reg })) {
      const status = r.status === '未装' ? '可装'
        : r.reason === '未登记' ? '漂移（不在技能机制登记表）'
        : r.reason === '产物缺失' ? '漂移（产物缺失）'
        : r.status === '漂移' ? `落后（登记 v${r.installedVersion} ≠ 技能 v${r.currentVersion}，重跑 mech install 刷新；注意：镜像文案不随登记自动重渲染——渲染产物有变更时 grep AGENTS.md/conventions.md 比对，v2.54.0）`
        : '已装';
      console.log(`- ${r.token} — ${status}${r.products.length ? `（产物：${r.products.join('、')}）` : ''}`);
    }
    return 0;
  }
  if (sub !== 'install') { console.log('用法：node tf.mjs mech [ls | check | install <token> [--yes]]'); return 1; }
  const token = args.filter((a) => a !== '--yes')[1];
  if (!token) { console.log('用法：node tf.mjs mech install <token>'); return 1; }
  const row = reg.get(token);
  if (!row) { console.log(`未登记机制 ${token}（真相源：references/data.md 机制登记表；mech ls 查看可装清单）`); return 1; }
  if (!pj) { console.log('缺 .taskflow/project.json（先走 new-task 初始化流程）'); return 1; }
  if (!row.products.length) { console.log(`机制 ${token} 无项目侧产物定义（纯编排层机制，无需 install）`); return 0; }
  const prose = MECH_PROSE[token] ?? null; // 机制的项目侧锚点/补记（无 prose 的机制只渲染产物）
  const day = nowIso.slice(0, 10);
  const declared = pj.mechanisms?.[token];
  const exts = typeof pj.assetExts === 'string' && pj.assetExts.includes('|') ? pj.assetExts : (isGit ? detectAssetExts(mainRoot) : 'java|kt|ts|js|vue');
  // tracked 产物落 cwd（在 worktree 内跑 install → 落 worktree，主仓库检出区保持干净——铁律「主仓库仅作合并落点」；.taskflow 类仍落 tasksDir）
  const trackedRoot = isGit ? R(git(['rev-parse', '--show-toplevel'], undefined, true)) || mainRoot : mainRoot;
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  // 渲染源：assets/harness/*.sh（__ASSET_EXTS__ 注入 → scripts/harness）+ assets/design/*.js（提取器工具 → scripts/design）
  // 渲染清单按登记表语义过滤（2026-10-13 审查 D1）：union(全部机制「采纳产物」列) = 允许落项目的产物集；产物列为
  // 「—」的技能内门（PLAIN_SPEECH_GATE/MERGE_GATE/STALE_CHECK 等）不渲染——门脚本住技能仓 assets/ 由 SKILL_ROOT 原位
  // 运行，渲染进项目=死产物（SKILL_ROOT 按脚本位置解析到项目根 → 读不存在的 references/glossary.md → 对任何输入恒红）。
  // 依据=登记表产物列（真源，与 doctor 采纳对账同谓词），非文件名黑名单：新机制登记产物路径即自动获得渲染资格，
  // 漏登记=渲染不出——与「产物缺失=漂移」同一张账；已装项目的旧渲染副本不在此清除（孤儿清除是收尾手工步骤）。
  // v2.65.0 确认闸前置：渲染计划只读先算（会写哪些文件/哪些是整文件覆盖），闸过才落盘——闸判定与写路径共用同一份计划，禁止两份渲染实现。
  const renderable = new Set([...reg.values()].flatMap((row) => row.products).map((p) => path.normalize(p)));
  const renderPlan = [];
  for (const [assetSub, outSub, ext, mode] of [['harness', path.join('scripts', 'harness'), '.sh', 0o755], ['harness', path.join('scripts', 'harness'), '.mjs', 0o755], ['design', path.join('scripts', 'design'), '.js', 0o644], ['guard', path.join('.omp', 'hooks', 'pre'), '.js', 0o644]]) {
    const aDir = path.join(skillRoot, 'assets', assetSub);
    const oDir = path.join(trackedRoot, outSub);
    for (const f of fs.existsSync(aDir) ? fs.readdirSync(aDir).filter((x) => x.endsWith(ext)) : []) {
      if (!renderable.has(path.normalize(path.join(outSub, f)))) continue; // 登记表产物列未收（技能内门）→ 不渲染（D1，语义见上）
      const next = fs.readFileSync(path.join(aDir, f), 'utf8').replaceAll('__ASSET_EXTS__', exts);
      const outP = path.join(oDir, f);
      const prev = fs.existsSync(outP) ? fs.readFileSync(outP, 'utf8') : null;
      if (prev === next) continue;
      renderPlan.push({ rel: `${outSub}/${f}`, abs: outP, next, prev, ext, mode });
    }
  }
  const missing = row.products.filter((p) => !fs.existsSync(path.resolve(mainRoot, p)));
  const verDrift = declared && declared.version !== undefined && declared.version !== skillVersion(); // 陈旧快照：内容一致但登记版本落后也不许早退——重跑必须刷回版本（2026-09-30 采纳对账纪律）
  // 确认闸（v2.65.0，DEP_ASK_GATE 的机械面）：①已装版本漂移刷新（采纳漂移未经拍板不许落盘）②将整文件覆盖任何已存在
  // 文件（渲染过滤保证只会落在登记产物路径上——项目自有定制副本/本地定制段就在这些路径被静默吃掉，v2.62.0 在案）→
  // 拒绝落盘 + 打印将覆盖文件清单，显式 --yes 才执行。首装空位不拦（产物路径全为新文件=懒加载体验保留，首装确认归
  // 编排层 DEP_ASK_GATE 呈报流程）；conventions/AGENTS/CHANGELOG 属生成节幂等替换/锚点补写（非整文件覆盖）不过闸。
  const overwrites = renderPlan.filter((e) => e.prev !== null);
  if ((verDrift || overwrites.length) && !yes) {
    console.log(`⛔ mech install 确认闸：${token} 未带 --yes，未落盘`);
    if (verDrift) console.log(`  原因①采纳漂移刷新：已装 v${declared.version} ≠ 技能 v${skillVersion()}（刷新须用户拍板，DEP_ASK_GATE）`);
    if (overwrites.length) console.log(`  原因②将整文件覆盖已有文件：${overwrites.map((e) => e.rel).join('、')}`);
    console.log('  将覆盖文件清单：');
    if (!overwrites.length) console.log('  （无——渲染产物与当前模板逐字节一致，--yes 后仅刷新采纳登记版本与 conventions/AGENTS 生成节）');
    for (const e of overwrites) console.log(`  - ${e.rel}`);
    console.log(`  → 复核清单后确认执行：node tf.mjs mech install ${token} --yes`);
    return 1;
  }
  if (declared && !missing.length && !renderPlan.length && !verDrift) { console.log(`已安装：${token}（v${declared.version ?? '?'} @ ${declared.adoptedAt ?? '?'}）——产物与当前模板一致，幂等未重复写`); return 0; }
  if (verDrift) console.log(`ℹ 版本漂移（登记 v${declared.version} ≠ 技能 v${skillVersion()}）→ 不早退，刷新采纳登记`);
  let renderedChanged = false;
  for (const e of renderPlan) {
    fs.mkdirSync(path.dirname(e.abs), { recursive: true });
    fs.writeFileSync(e.abs, e.next);
    fs.chmodSync(e.abs, e.mode);
    renderedChanged = true;
    console.log(`✓ 渲染 ${e.rel}${e.ext === '.sh' ? `（assetExts=${exts}` : '（工具）'}${e.prev === null ? '' : ' 模板已更新→覆盖'}${e.ext === '.sh' ? '）' : ''}`);
  }
  const cl = path.join(trackedRoot, 'docs', 'CHANGELOG.md');
  if (prose) {
    if (!fs.existsSync(cl)) {
      fs.mkdirSync(path.dirname(cl), { recursive: true });
      fs.writeFileSync(cl, prose.newFile(day));
      console.log(`✓ 建档 docs/CHANGELOG.md + 锚点条目「${prose.anchor}」`);
    } else if (!new RegExp(`^## .*${prose.anchor}.*$`, 'm').test(fs.readFileSync(cl, 'utf8'))) {
      const prev = fs.readFileSync(cl, 'utf8');
      const entry = `\n## ${day} — ${prose.anchor}\n\n${prose.insertBody}`;
      // 插入位置三 fallback：`# CHANGELOG` 头 → 真 h1 头（# 后非 #——`##` 条目头不算，pl5android2 实证锚点曾被插进首条目内部）→ 顶置（无 h1 的 CHANGELOG 也能落锚点）
      let next = prev.replace(/^# CHANGELOG\n/, `# CHANGELOG\n${entry}`);
      if (next === prev) {
        const h1 = prev.match(/^#(?!#)[^\n]*\n/);
        next = h1 ? prev.replace(h1[0], `${h1[0]}${entry}`) : `${entry.replace(/^\n/, '')}${prev}`;
      }
      fs.writeFileSync(cl, next);
      console.log(`✓ 既有 CHANGELOG 补写锚点条目「${prose.anchor}」`);
    }
  }
  const convP = path.join(tasksDir, 'conventions.md');
  if (!fs.existsSync(convP)) {
    try { fs.copyFileSync(path.join(skillRoot, 'templates', 'conventions.md'), convP); console.log('✓ 建档 .taskflow/conventions.md（模板骨架）'); } catch {}
  }
  // prose 生成节幂等替换（v2.57.1）：marker 命中 → 整节（marker 行到下一 `## ` 标题/文件尾）替换为当前渲染——存量镜像随版本自愈，
  // 与 assets 路径的版本漂移刷新语义对齐；未命中 → 照旧追加（首装路径不回归）。
  // 反面实证（v2.57.0 收口 TeslaCamView）：旧 append-only 使 marker 判重「跳过补记」——guard 新、prose 旧、采纳登记新版本 = 账实不符（v2.56.2 半治收尾）。
  // 生成节 = 机制所有（标题标注「mech install 生成」），用户内容住节外；CHANGELOG 锚点插入是结构锚点，不走本路径。
  const replaceGenSection = (text, marker, fresh) => {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.includes(marker));
    const freshLines = fresh.replace(/^\n/, '').replace(/\n$/, '').split('\n');
    if (start === -1) return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${fresh}\n`;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
    while (end > start + 1 && lines[end - 1].trim() === '') end -= 1; // 节尾空行由重建结构统一（单空行分隔）
    return [...lines.slice(0, start), ...freshLines, '', ...lines.slice(end)].join('\n');
  };
  const conv = fs.existsSync(convP) ? fs.readFileSync(convP, 'utf8') : '';
  if (prose) {
    const convMk = prose.convMarkers.find((mk) => conv.includes(mk)); // 判重=生成标题形态（v2.54.0 收紧：裸 token 会被模板占位/普通句子命中致静默跳过——对抗审查实证）
    if (!convMk) {
      fs.appendFileSync(convP, prose.convText(day));
      console.log(prose.convLog);
    } else {
      fs.writeFileSync(convP, replaceGenSection(conv, convMk, prose.convText(day)));
      console.log(`✓ conventions.md 生成节已刷新（v2.57.1 幂等替换——存量镜像随版本自愈）`);
    }
  }
  const ag = path.join(trackedRoot, 'AGENTS.md');
  const agText = fs.existsSync(ag) ? fs.readFileSync(ag, 'utf8') : '';
  if (prose) {
    const agMk = prose.agMarkers.find((mk) => agText.includes(mk));
    if (!agMk) {
      fs.writeFileSync(ag, `${agText}${agText && !agText.endsWith('\n') ? '\n' : ''}${prose.agText(day)}`);
      console.log(`✓ AGENTS.md 红线摘要镜像（${prose.anchor}）`);
    } else {
      fs.writeFileSync(ag, replaceGenSection(agText, agMk, prose.agText(day)));
      console.log(`✓ AGENTS.md 生成节已刷新（v2.57.1 幂等替换——存量镜像随版本自愈）`);
    }
  }
  pj.mechanisms = (pj.mechanisms && typeof pj.mechanisms === 'object' && !Array.isArray(pj.mechanisms)) ? pj.mechanisms : {}; // 非 object 值纠偏（防 ESM 严格模式抛错，2026-09-27 审查 N3）
  pj.mechanisms[token] = { adoptedAt: nowIso, version: skillVersion(), assetExts: exts };
  pj.lastActiveAt = nowIso;
  fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n');
  console.log(`✓ 采纳登记：${token} → project.json.mechanisms（v${skillVersion()}）`);
  console.log(`\n📌 CI 挂点建议（经确认后由编排层写入 .github/workflows/，失败即不部署）：\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/harness/validate-changelog.sh`);
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
  console.log(USAGE);
  process.exit(0);
}
/* ---------------- svc：服务端口租约（claim/release 簿记写入口，ls 只读）——
   启动 dev 服务前探测让位，绝不 kill 抢占；停服动作归编排层（读写边界：写入口限簿记）。
   数据：services.json（schema 唯一定义 references/data.md「services.json」节）；doctor I14 对账。 */
function svcCmd(args = []) {
  const sub = args[0];
  const { mainRoot, tasksDir } = locate();
  const svcPath = servicesPathOf(tasksDir);
  const load = () => {
    if (!fs.existsSync(svcPath)) return { services: [] };
    const j = readJson(svcPath);
    if (!j || !Array.isArray(j.services)) { console.log('⚠ services.json schema 非法（缺 services 数组）→ 修 JSON（schema 见 references/data.md「services.json」节）'); return null; }
    return j;
  };
  if (!sub || sub === 'ls') {
    const db = load(); if (!db) return 1;
    if (!db.services.length) { console.log('（无租约登记）'); return 0; }
    const ids = new Set((readJson(path.join(tasksDir, 'index.json'))?.tasks ?? []).map((e) => e?.id));
    for (const s of db.services) {
      const alive = s.pid == null ? null : pidAlive(s.pid);
      // v2.29.0 正交标注：pid 态（live/stale/pid未登记）与 orphan（task 不在 index）是两个维度，复合态并列不互斥（治互斥链吞维度）
      let tag = alive === null ? 'pid未登记' : (!alive ? 'stale(pid死)' : 'live');
      if (s.task && !ids.has(s.task)) tag += '·orphan(task不在index)';
      console.log(`:${s.port}\t${s.service}\ttask=${s.task ?? '—'}\tsession=${s.session ?? '—'}\tpid=${s.pid ?? '—'}(${alive === null ? '未补登' : alive ? '活' : '死'})\t${s.startedAt ?? ''}\t[${tag}]${s.note ? `\t# ${s.note}` : ''}`);
    }
    return 0;
  }
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? String(args[i + 1] ?? '') : null; };
  const suggestPorts = (db, from) => {
    const taken = new Set(db.services.filter((s) => s.pid != null && pidAlive(s.pid)).map((s) => s.port));
    const free = [];
    for (let p = from + 1; p <= from + 10 && free.length < 3; p++) {
      if (taken.has(p)) continue;
      const pr = portProbe(p);
      if (pr.skipped || !pr.occupied) free.push(p);
    }
    return free;
  };
  if (sub === 'claim') {
    const service = args[1] && !String(args[1]).startsWith('--') ? args[1] : null;
    const port = Number(get('--port'));
    if (!service || !Number.isInteger(port) || port <= 0 || port > 65535) { console.log('用法：tf.mjs svc claim <service> --port <1-65535> [--task <id>] [--session <ses>] [--pid <pid>] [--note <注记>]'); return 1; }
    const db = load(); if (!db) return 1;
    const task = get('--task'), session = get('--session'), pidRaw = get('--pid'), note = get('--note');
    const pid = pidRaw != null ? Number(pidRaw) : null;
    const existing = db.services.find((s) => s.port === port);
    const probe = portProbe(port);
    if (probe.skipped) console.log(`⚠ 端口探测降级（${probe.reason}）→ 仅按注册表对账，OS 层占用不可见，谨慎启动`);
    // 自己的租约：补登 pid / 重登记（服务启动后回填 pid 走这里；死租约同 task 重 claim = 回收）
    if (existing && task && existing.task === task) {
      if (existing.pid != null && pidAlive(existing.pid)) {
        existing.service = service;
        if (session) existing.session = session;
        if (pid != null) existing.pid = pid;
        if (note) existing.note = note;
        writeServices(svcPath, db);
        console.log(`✓ 租约更新 :${port} ${service} task=${task} session=${existing.session ?? '—'}${pid != null ? ` pid=${pid}` : ''}`);
        return 0;
      }
      const deadNote = existing.pid != null ? `（原租约 pid=${existing.pid} 已死，回收）` : '（原租约未补登 pid，重新登记）';
      db.services = db.services.filter((s) => s.port !== port);
      db.services.push({ port, service, task, session: session ?? existing.session ?? null, pid: pid ?? null, startedAt: new Date().toISOString(), note: note ?? null, ...(existing.pid != null ? { reclaimedFrom: `pid=${existing.pid}(死)` } : {}) });
      writeServices(svcPath, db);
      console.log(`✓ 租约登记 :${port} ${service} task=${task} session=${session ?? existing.session ?? '—'} ${deadNote}——测试完成停服后记得 svc release`);
      return 0;
    }
    // 他人租约：活进程在监听 或 未补登 pid 的预留（宁拒绝不可误抢）→ 让位
    const leaseLive = existing && existing.pid != null && pidAlive(existing.pid);
    if (existing && (leaseLive || existing.pid == null)) {
      console.log(`⛔ :${port} 已被在册租约占用（${existing.service} task=${existing.task ?? '—'} pid=${existing.pid ?? '未补登'}）→ 让位换端口，绝不 kill 抢占`);
      const free = suggestPorts(db, port);
      console.log(free.length ? `建议让位：${free.map((p) => `:${p}`).join(' / ')}` : `建议让位：:${port + 1} 起逐个人工探测`);
      return 1;
    }
    // OS 层被占（旧项目遗留/其他项目服务/死租约端口被人接管）→ 让位
    if (probe.occupied) {
      console.log(`⛔ :${port} ${existing ? `租约 pid=${existing.pid} 已死但端口被其他进程接管监听：${probe.who}` : `被进程监听（无租约登记——旧项目遗留或其他项目服务）：${probe.who}`} → 让位换端口，绝不 kill 抢占`);
      const free = suggestPorts(db, port);
      console.log(free.length ? `建议让位：${free.map((p) => `:${p}`).join(' / ')}` : `建议让位：:${port + 1} 起逐个人工探测`);
      return 1;
    }
    // 无租约 或 死租约可回收 → 登记
    db.services = db.services.filter((s) => s.port !== port);
    db.services.push({ port, service, task: task ?? null, session: session ?? null, pid: pid ?? null, startedAt: new Date().toISOString(), note: note ?? null, ...(existing ? { reclaimedFrom: `pid=${existing.pid}(死)` } : {}) });
    writeServices(svcPath, db);
    console.log(`✓ 租约登记 :${port} ${service} task=${task ?? '—'} session=${session ?? '—'}${existing ? `（已回收死租约 pid=${existing.pid}）` : ''}——测试完成停服后记得 svc release`);
    return 0;
  }
  if (sub === 'release') {
    const port = Number(args[1]);
    const db = load(); if (!db) return 1;
    if (!Number.isInteger(port) || !db.services.some((s) => s.port === port)) { console.log(`:${args[1] ?? ''} 不在册（svc ls 查看）；停服动作归编排层，本命令只删租约`); return 1; }
    db.services = db.services.filter((s) => s.port !== port);
    writeServices(svcPath, db);
    console.log(`✓ 租约释放 :${port}（停服确认归编排层）`);
    return 0;
  }
  console.log('用法：tf.mjs svc ls | svc claim <service> --port <1-65535> [--task <id>] [--session <ses>] [--pid <pid>] [--note <注记>] | svc release <port>');
  return 1;
}

/* ---------------- lint：流程文档锚点检查（SKILL.md + references/*.md，防漂移） ----------------
   管道表解析（v2.70.0 挂接对账数据源，解析先例=mechRegistry 的 data.md 表）：连续 | 行成表，
   首行=表头，分隔线（|---|）跳过。列取值按表头名定位（列序漂移不破坏解析）。 */
function parsePipeTables(text) {
  const tables = [];
  let cur = null;
  for (const [li, line] of text.split('\n').entries()) {
    if (/^\s*\|/.test(line)) {
      if (!cur) { cur = { header: [], rows: [] }; tables.push(cur); }
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/,'').split('|').map((c) => c.trim());
      if (!cur.header.length) cur.header = cells;
      else if (!cells.every((c) => c === '' || /^:?-+:?$/.test(c))) cur.rows.push({ cells, line: li + 1 }); // v2.71.0 A1：行号随行走（行级 fail-closed 报行号）
      continue;
    }
    cur = null;
  }
  return tables;
}
function lintCmd(args = []) {
  const rootOverride = args.includes('--root') ? path.resolve(String(args[args.indexOf('--root') + 1] ?? '')) : null;
  const root = rootOverride ? path.join(rootOverride, 'scripts') : path.dirname(new URL(import.meta.url).pathname); // root 恒为 <repo>/scripts，读文档走 join(root,'..')
  const refs = fs.readdirSync(path.join(root, '..', 'references')).filter((f) => f.endsWith('.md')).map((f) => `references/${f}`);
  const files = ['SKILL.md', 'README.md', ...refs];
  let bad = 0;
  let testSrc = ''; try { testSrc = fs.readFileSync(path.join(root, 'tf.test.mjs'), 'utf8'); } catch {} // fixture 落痕检查的数据源（v2.29.0；--root 副本可能无测试文件 → 降级空串）
  const invariantIds = INVARIANTS.map((i) => i.id);
  const stepNums = {};
  for (const f of files) {
    const txt = fs.readFileSync(path.join(root, '..', f), 'utf8');
    stepNums[f] = new Set([...txt.matchAll(/^\s*(\d+)\. /gm)].map((m) => Number(m[1])));
  }
  for (const f of files) {
    const txt = fs.readFileSync(path.join(root, '..', f), 'utf8');
    // 1) 跨文档步骤引用：目标编号存在
    for (const m of txt.matchAll(/(\w+\.md)[^。\n]{0,8}第 (\d+)(?:-(\d+))? 步/g)) {
      const target = files.find((x) => x === m[1] || x.endsWith(`/${m[1]}`));
      if (!target) continue; // 非本技能内文件不查
      const nums = m[3] ? rangeNums(Number(m[2]), Number(m[3])) : [Number(m[2])];
      for (const n of nums) if (!stepNums[target].has(n)) { console.log(`⚠ lint ${f}: 引用 ${m[1]} 第 ${n} 步，目标无此编号`); bad++; }
    }
    // 2) 有序编号连续（同文件内不跳号；=1 视为新列表开始的合法重置）
    const seq = [...txt.matchAll(/^\s*(\d+)\. /gm)].map((m) => Number(m[1]));
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] !== seq[i - 1] + 1 && seq[i] !== 1) { console.log(`⚠ lint ${f}: 编号跳号 ${seq[i - 1]} → ${seq[i]}`); bad++; }
    }
    // 3) 旧路径引用须带兼容标注（防漏改混入「有意保留」）
    txt.split('\n').forEach((l, i) => {
      if (/\.opencode\/tasks/.test(l) && !/(旧|兼容|原样|并存)/.test(l)) { console.log(`⚠ lint ${f}:${i + 1}: 旧路径引用无兼容标注 → 改 .taskflow/ 或补「旧/兼容」说明`); bad++; }
    });
  }
  // 4) 闸门关键词在位（防流程裁剪偷走承重结构）
  const gates = [
    ['references/merge.md', '用户明确确认'],
    ['references/merge.md', '禁 -D'],
    ['references/merge.md', '合并竞态防护'],
    ['references/checkpoint.md', '触发点'],
    ['references/checkpoint.md', '轻量'],
    ['references/domain.md', '可视化载体'],
    ['SKILL.md', '不审查，不合并'],
    ['SKILL.md', '需求变更门'],
    ['templates/spec.md', '需求基线'],
    ['references/resume.md', '需求锚定'],
    ['references/data.md', '机制登记表'],
    ['references/data.md', '状态机（唯一事实源'],
    ['scripts/tf.mjs', 'INVARIANTS'],
  ];
  for (const [f, kw] of gates) {
    const gp = path.join(root, '..', f);
    if (!fs.existsSync(gp)) continue; // --root 指向残缺克隆时跳过缺失文件（不裸崩）
    const txt = fs.readFileSync(gp, 'utf8');
    if (!txt.includes(kw)) { console.log(`⚠ lint ${f}: 闸门关键词缺失「${kw}」`); bad++; }
  }
  // 5) 未入库但被依赖的文件（v2.19.0，先例实证：成品文件游离于版本控制外，fresh clone 即丢）
  //    引用了已跟踪内容 → ⛔ 计入待修；无引用孤儿 → ℹ 点名认领或删除（不拦截——归属会话的 WIP 不是脏）
  //    扫描面语义=活性依赖（说明书/测试/代码 help），CHANGELOG 历史叙事与本注释的案例提及不算——
  //    否则任何提过旧文件名的地方都成永久误报（v2.19.0 当轮实证：本检查靠案例名把自己点名了）
  try {
    const untracked = (git(['ls-files', '--others', '--exclude-standard'], path.join(root, '..'), true) ?? '').split('\n').filter(Boolean);
    const scanPool = [...files, 'README.md', 'scripts/tf.mjs', 'scripts/tf.test.mjs']
      .filter((f) => fs.existsSync(path.join(root, '..', f)));
    const scanned = new Map(scanPool.map((f) => [f, fs.readFileSync(path.join(root, '..', f), 'utf8')]));
    for (const f of untracked) {
      if (!/\.(md|mjs|json)$/.test(f) || f === '.owner.json') continue;
      const base = path.basename(f);
      const referenced = [...scanned.values()].some((txt) => txt.includes(base));
      if (referenced) { console.log(`⛔ lint：${f} 未入库但被已跟踪内容引用 → git add ${f}（fresh clone 会丢）`); bad++; }
      else console.log(`ℹ lint：${f} 未跟踪（归属会话认领或删除；不拦截）`);
    }
  } catch { /* ls-files 不可用（非 git 环境）→ 跳过该检查 */ }
  // 6) 机制触点可达性（死规则检测；数据源 = data.md「机制登记表」）
  //    反面实证：LEASE/.owner.json 曾有 schema+doctor 检查、零流程触点——写入口/刷新点/接管仪式无一处接线（2026-09-23 审查）
  const dataP = path.join(root, '..', 'references', 'data.md');
  const mechSec = fs.existsSync(dataP) ? fs.readFileSync(dataP, 'utf8').match(/## 机制登记表[\s\S]*?(?=\n## |$)/)?.[0] : null;
  if (!mechSec && fs.existsSync(dataP)) { console.log('⛔ lint：references/data.md 存在但缺「## 机制登记表」段——触点可达/fixture落痕/大白话三检查整体失明（段头被改名或误删？对抗审查 F 实证形态）'); bad++; }
  if (mechSec) {
    for (const row of mechSec.split('\n').filter((l) => { const t = l.trim(); return t.startsWith('|') && !/^\|\s*-/.test(t); }).slice(1)) {
      const cells = row.split('|').map((c) => c.trim());
      const token = cells[1], touchCell = cells[3];
      if (!token || !touchCell) continue;
      const touchFiles = touchCell.split(/[,，、]+/).map((s) => s.trim().replace(/^`+|`+$/g, '').replace(/^references\//, '')).filter((s) => /^[\w.-]+\.md$/.test(s) || s.startsWith('templates/'));
      const nonMd = touchCell.split(/[,，、]+/).map((s) => s.trim().replace(/^`+|`+$/g, '').replace(/^references\//, '')).filter((s) => s && !/\.md$/.test(s));
      if (nonMd.length) console.log(`ℹ lint 机制 ${token}：触点列含非文档项「${nonMd.join('、')}」——字面 token 校验仅覆盖 *.md 项（测试触点由 fixture 落痕检查分守；攻击轮 E4：声明面与可验证面对齐）`);
      const unrecognized = touchCell.split(/[,，、]+/).map((s) => s.trim().replace(/^`+|`+$/g, '').replace(/^references\//, '')).filter((s) => /\.md$/.test(s) && !/^[\w.-]+\.md$/.test(s) && !s.startsWith('templates/'));
      if (unrecognized.length) { console.log(`⚠ lint 机制 ${token}：触点列无法识别的形式「${unrecognized.join('、')}」——只认裸 *.md / templates/*.md / references/*.md / 反引号包裹（剥壳后判）`); bad++; }
      if (!touchFiles.length) { console.log(`⛔ lint：机制 ${token} 触点列为空 = 死规则 → 接线或删除（induction.md 反面模式）`); bad++; continue; }
      for (const tf of touchFiles) {
        const rel = tf === 'SKILL.md' || tf === 'README.md' || tf.startsWith('templates/') ? tf : `references/${tf}`;
        const tp = path.join(root, '..', rel);
        if (!fs.existsSync(tp)) { console.log(`⚠ lint 机制 ${token}：触点文件不存在 ${rel}`); bad++; continue; }
        if (!fs.readFileSync(tp, 'utf8').includes(token)) { console.log(`⛔ lint：机制 ${token} 触点 ${rel} 无此 token = 死规则 → 接线（token 字面写入）或删触点`); bad++; }
      }
      // v2.29.0 fixture 落痕检查（治「覆盖跟着事故走」：机制↔夹具对照，登记即须有落痕）
      const fx = (cells[5] ?? '').trim();
      if (fx === 'tf.test.mjs') {
        if (!testSrc.includes(token)) { console.log(`⛔ lint：机制 ${token} fixture 落痕声明 tf.test.mjs 但测试文件无此 token → 补测试（先红后绿）`); bad++; }
      } else if (/^I\d+$/.test(fx)) {
        if (!invariantIds.includes(fx)) { console.log(`⛔ lint：机制 ${token} fixture 声明 ${fx} 但 INVARIANTS 无此行 → 修登记或补不变量`); bad++; }
      } else if (fx.startsWith('—') && fx.replace(/^—\s*[（(]?/, '').replace(/[）)\s]*$/, '').length < 6) { console.log(`⛔ lint：机制 ${token} fixture 豁免理由过短「${fx}」———<理由> 须 ≥6 字符说明（对抗审查 C1/C2 实证：裸—与—TODO 可免疫先红后绿纪律）`); bad++; } else if (!fx.startsWith('—')) { console.log(`⛔ lint：机制 ${token} fixture 落痕列须为 tf.test.mjs / I<N> / —<理由> 之一（当前「${fx}」）`); bad++; }
      // v2.43.0 大白话列非空检查（PLAIN_SPEECH_GATE 词表源——门脚本与呈报白话都从这里抄）
      const plainCell = (cells[7] ?? '').trim(); // v2.52.0 修列索引：七列表 cells[7] 才是大白话——旧读 cells[6]=检测列，自出生未看过真列（对抗审查 A1/A2 实证）
      if (!plainCell) { console.log(`⛔ lint：机制 ${token} 「大白话」列为空 → 一句人类解释（词表源，门脚本代号解释/呈报白话从这抄）`); bad++; }
    }
  }
  // 7) 事实禁改写（prose 禁复述可推导事实；清单真相源：data.md 表 / tf.mjs 分发区 / templates/ 目录）
  //    反面实证：不变量范围曾在 SKILL.md/README/脚本头注释四处各说一个数
  const factBans = [
    { re: /I1-I\d+/, why: '不变量范围只在 data.md 表（一行一条）' },
    { re: /零写入/, why: '脚本有明确写入口（tf.mjs 头注释「能力声明」），禁宣称零写入' },
    { re: /[零〇一二两三四五六七八九十\d]+\s*个(命令|模板|不变量)/, why: '清单以运行时/目录/表格为准，prose 禁计数' },
    { re: /tasks\/<task-id>/, why: '任务目录唯一写法 .taskflow/<task-id>/' },
  ];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(root, '..', f), 'utf8');
    txt.split('\n').forEach((l, i) => {
      for (const b of factBans) {
        const m = l.match(b.re);
        if (m) { console.log(`⚠ lint ${f}:${i + 1}: 事实复述「${m[0]}」→ ${b.why}`); bad++; }
      }
    });
  }
  // 8) 模板中性：templates/ 禁焊死项目专属工具标识符（snake_case）——模板依赖抽象，项目依赖具体；
  //    项目专属工具住 conventions.md 经 init 注入。反面实证：spec.md 曾焊死 pl5android2 专属 graph 工具引用
  const tmplDir = path.join(root, '..', 'templates');
  if (fs.existsSync(tmplDir)) {
    for (const f of fs.readdirSync(tmplDir).filter((x) => x.endsWith('.md'))) {
      fs.readFileSync(path.join(tmplDir, f), 'utf8').split('\n').forEach((l, i) => {
        const m = l.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/);
        if (m) { console.log(`⚠ lint templates/${f}:${i + 1}: 疑似项目专属工具标识符「${m[0]}」→ 模板只收注入（conventions.md），禁焊死工具引用`); bad++; }
      });
    }
  }
  // 9) 版本一致性：SKILL.md frontmatter version ↔ CHANGELOG 顶条目版本（v2.40.0；反面实证：v2.39.0 硬规则+机制落地无 CHANGELOG 条目，doctor --self 全绿放行——补录+棘轮机制化）
  const skillVerP = path.join(root, '..', 'SKILL.md');
  const clTopP = path.join(root, '..', 'CHANGELOG.md');
  if (fs.existsSync(skillVerP) && fs.existsSync(clTopP)) {
    const sv = fs.readFileSync(skillVerP, 'utf8').match(/^version:\s*(\S+)/m);
    const cv = fs.readFileSync(clTopP, 'utf8').match(/^##\s+(\S+)\s+—/m);
    if (sv && cv && sv[1] !== cv[1]) { console.log(`⛔ lint：版本不一致——SKILL.md version ${sv[1]} ≠ CHANGELOG 顶条目 ${cv[1]} → 补 CHANGELOG 条目（每版本 Why/规则/机械面/组合评估）或对齐版本号`); bad++; }
  }
  // 10) 简介版本串：SKILL.md description 尾部「版本 <v>」↔ frontmatter version（v2.56.3；用户 2026-10-11 拍板技能简介可见版本号——简介与 version 两处手写易漂移，lint 机械锁定）
  if (fs.existsSync(skillVerP)) {
    const skillTxt10 = fs.readFileSync(skillVerP, 'utf8');
    const dv10 = skillTxt10.match(/^version:\s*(\S+)/m);
    const dline10 = skillTxt10.split('\n').find((l) => l.startsWith('description:'));
    if (dv10 && dline10) {
      const inDesc10 = dline10.match(/版本\s*(\d+(?:\.\d+)+)/);
      if (!inDesc10) { console.log(`⛔ lint：description 未携带版本串 → 尾部补「版本 ${dv10[1]}。」（技能简介可见版本号——用户 2026-10-11 拍板）`); bad++; }
      else if (inDesc10[1] !== dv10[1]) { console.log(`⛔ lint：description 版本串 ${inDesc10[1]} ≠ version ${dv10[1]} → 升版本时两处同步改`); bad++; }
    }
  }
  // 11) 挂接对账（v2.70.0，JVM 可达性模型）：references/entry-routes.md 注册表 = root set，「指向/载体」= 边，
  //     本检查 = 可达性遍历——入口指向的文件与锚词必须真实可达（悬空=红）；SKILL.md description（加载面）
  //     与注册表双面对账（注册表宣称要覆盖的话术，description 里必须有锚词）；判定点纪律锚词必须 grep 得到
  //     （锚词落不了文件=死规则=红）。孤儿命令（分发区命令在 references/*.md 零提及）= ⚠ 提示级不计数
  //     （svc/nextid 等纯簿记命令可无话语入口，先观察再定级）。TF_ENTRY_ROUTES 可覆盖注册表路径（测试用）。
  const erP = process.env.TF_ENTRY_ROUTES ? path.resolve(process.env.TF_ENTRY_ROUTES) : path.join(root, '..', 'references', 'entry-routes.md');
  let erText = ''; try { erText = fs.readFileSync(erP, 'utf8'); } catch { /* 缺失走下方红 */ }
  const erTables = erText ? parsePipeTables(erText) : [];
  const rTab = erTables.find((tb) => (tb.header[0] ?? '') === '入口id');
  const jTab = erTables.find((tb) => (tb.header[0] ?? '') === '判定id');
  if (!erText || !rTab || !jTab) { console.log('⛔ lint：入口路由注册表缺失或不可解析（entry-routes.md 须含「入口id」「判定id」两表）——挂接对账失明（纪律：新入口先入表，再写触发表散文）'); bad++; }
  else {
    // v2.71.0 A3：锚词检测剥惰性文本（先例=doctor --self 剥注释防「只留注释骗过三源」）——HTML 注释与围栏代码块
    //   里的锚词不算可达：注释/示例里「落了锚」=死规则假绿，原文 includes 会放行
    const stripInert = (s) => String(s ?? '').replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '');
    // v2.71.0 A1/A6 行级 fail-closed：注册表解析出零有效行=红（含 TF_ENTRY_ROUTES 覆盖指向的文件）；
    //   全空单元格行原被 parsePipeTables 当分隔线吞、有指向内容但缺入口id的行原被 continue 免检——均改红并报行号
    if (!rTab.rows.length || !jTab.rows.length) { console.log(`⛔ lint 挂接对账：注册表解析出零有效行（表一 ${rTab.rows.length} 行 / 表二 ${jTab.rows.length} 行）→ 空表=挂接对账失明，补行或修注册表`); bad++; }
    let inFence = false;
    erText.split('\n').forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return; }
      if (inFence || !/^\s*\|/.test(l)) return;
      const cells0 = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (cells0.length && cells0.every((c) => c === '')) { console.log(`⛔ lint 挂接对账 ${path.basename(erP)}:${i + 1}: 全空单元格行（原被当分隔线吞）→ 删行或补内容（行级 fail-closed）`); bad++; }
    });
    const stripTick = (s) => String(s ?? '').replace(/^`+|`+$/g, '').trim();
    const reach = (label, ref) => {
      const i = String(ref ?? '').indexOf('::');
      const f = i < 0 ? String(ref ?? '').trim() : String(ref).slice(0, i).trim();
      const kw = i < 0 ? '' : String(ref).slice(i + 2).trim();
      const fp = f ? path.join(root, '..', f) : '';
      if (!f || !fp || !fs.existsSync(fp)) { console.log(`⛔ lint 挂接对账 ${label}：指向/载体文件不存在「${f}」（悬空边）→ 修注册表或补文件`); bad++; return null; }
      if (!kw) { console.log(`⛔ lint 挂接对账 ${label}：缺 ::锚词（${f}）→ 指向/载体须「文件路径::锚词」两段式`); bad++; return null; }
      const ftxtLive = stripInert(fs.readFileSync(fp, 'utf8'));
      if (!ftxtLive.includes(kw)) { console.log(`⛔ lint 挂接对账 ${label}：锚词缺失「${kw}」@ ${f} → 锚词落文件或修注册表`); bad++; }
      return ftxtLive;
    };
    const descLine = fs.readFileSync(path.join(root, '..', 'SKILL.md'), 'utf8').split('\n').find((l) => l.startsWith('description:')) ?? '';
    for (const row of rTab.rows) {
      const g = (name) => stripTick(row.cells[rTab.header.indexOf(name)]);
      const eid = g('入口id');
      if (!eid) { // v2.71.0 A1：有指向内容但缺 id 的行原被静默免检=行级 fail-open
        if (R(g('指向'))) { console.log(`⛔ lint 挂接对账 ${path.basename(erP)}:${row.line}: 行缺入口id 但指向列有内容「${g('指向')}」→ 补入口id 或删行（行级 fail-closed）`); bad++; }
        continue;
      }
      reach(`入口 ${eid}`, g('指向'));
      const loadCell = g('加载面'); // v2.71.0 A4：值容错——「是（主链路）」等漂移写法原被 ==='是' 静默禁用双面对账
      if (loadCell.startsWith('是')) {
        const a = g('description锚');
        if (!a) { console.log(`⛔ lint 挂接对账 入口 ${eid}：加载面=是 但 description锚 为空 → 填锚词或改加载面=否`); bad++; }
        else if (!descLine.includes(a)) { console.log(`⛔ lint 挂接对账 入口 ${eid}：description 无锚「${a}」→ 触发话术入 SKILL.md description（双面对账）`); bad++; }
      } else if (!loadCell.startsWith('否')) {
        console.log(`⛔ lint 挂接对账 入口 ${eid}：加载面值漂移「${loadCell}」（仅认「是*」/「否*」）→ 修正表值（旧严格匹配会把漂移值静默禁用成免检）`); bad++;
      }
    }
    for (const row of jTab.rows) {
      const g = (name) => stripTick(row.cells[jTab.header.indexOf(name)]);
      const jid = g('判定id');
      if (!jid) { // v2.71.0 A1：同 R 表行级 fail-closed
        if (R(g('载体'))) { console.log(`⛔ lint 挂接对账 ${path.basename(erP)}:${row.line}: 行缺判定id 但载体列有内容「${g('载体')}」→ 补判定id 或删行（行级 fail-closed）`); bad++; }
        continue;
      }
      const label = `判定 ${jid}${g('判定点') ? `（${g('判定点')}）` : ''}`;
      const i = g('载体').indexOf('::');
      const ftxt = reach(label, g('载体')); // v2.71.0 A3：返回剥惰性文本后的载体，纪律锚词同口径检测
      const kw = g('纪律锚词');
      if (ftxt && kw && i > 0) {
        const cf = g('载体').slice(0, i).trim();
        if (!ftxt.includes(kw)) { console.log(`⛔ lint 挂接对账 ${label}：纪律锚词缺失「${kw}」@ ${cf} → 载体落锚或修注册表`); bad++; }
      }
    }
    try {
      const tfSrc = fs.readFileSync(path.join(root, 'tf.mjs'), 'utf8');
      const docPool = refs.map((f) => path.join(root, '..', f)).filter((p) => fs.existsSync(p)).map((p) => fs.readFileSync(p, 'utf8')).join('\n');
      const orphans = [...new Set([...tfSrc.matchAll(/if \(cmd === (['"])([\w-]+)\1\)/g)].map((m) => m[2]))].filter((c) => !docPool.includes(c)); // v2.71.0 A7：补双引号分发形态
      for (const c of orphans) console.log(`⚠ lint 挂接对账：命令 ${c} 在 references/*.md 零提及（孤儿话语入口？）——纯簿记命令可无话语入口，确认后忽略（提示级不拦截）`);
    } catch { /* tf.mjs 不可读（--root 副本缺文件）→ 跳过孤儿检查 */ }
  }
  console.log(bad ? `\nlint：${bad} 项待修（spec 见 data.md；修文档不是修 lint）` : 'lint：全绿（步骤引用 / 编号连续 / 兼容标注 / 闸门关键词 / 未入库引用 / 机制触点 / 机制fixture落痕 / 事实禁改写 / 模板中性 / 版本一致 / 挂接对账）');
  return bad ? 1 : 0;
}
const rangeNums = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

if (cmd === 'ls') process.exit(ls(rest));
if (cmd === 'doctor') process.exit(doctor(rest));
if (cmd === 'reconcile') process.exit(reconcile(rest));
if (cmd === 'scout') process.exit(scout(rest));
if (cmd === 'skills') process.exit(skillsCmd(rest));
if (cmd === 'accept') process.exit(accept(rest[0], rest.slice(1)));
if (cmd === 'takeover') process.exit(takeover(rest));
if (cmd === 'park') process.exit(parkCmd(rest)); // PARK（v2.60.0）：搁置簿记，active→parked
if (cmd === 'unpark') process.exit(unparkCmd(rest)); // PARK（v2.60.0）：恢复搁置，parked→active
if (cmd === 'commit') process.exit(commitCmd(rest));
if (cmd === 'req-confirm') process.exit(reqConfirm(rest));
if (cmd === 'testplan') process.exit(testplan(rest));
if (cmd === 'diagnose') process.exit(diagnose(rest[0]));
if (cmd === 'nextid') process.exit(nextid(rest));
if (cmd === 'lock') process.exit(lockCmd(rest));
if (cmd === 'snapshot') process.exit(snapshotCmd(rest));
if (cmd === 'mergegate') process.exit(mergegateCmd(rest));
if (cmd === 'stale') process.exit(staleCmd(rest)); // STALE_CHECK（v2.59.0）：在途任务影响面漂移检查，只读
if (cmd === 'revert-plan') process.exit(revertPlanCmd(rest)); // Saga 补偿方案生成器（v2.69.0）：merged 任务的 revert 方案，只读不执行
if (cmd === 'gates') process.exit(gatesCmd(rest)); // 门责任链聚合（v2.69.0）：五道合并相关门一次跑完，只读
if (cmd === 'overlap') process.exit(overlapCmd(rest)); // DISPATCH_OVERLAP（v2.59.0）：并行派发写集求交预检，只读
if (cmd === 'impact') process.exit(impactCmd(rest)); // J19 牵连排查+J20 数据边界机械保底（v2.72.0）：basename 引用面+数据管道特征，只读恒 0
if (cmd === 'deploy') process.exit(deployCmd(rest));
if (cmd === 'migrate') process.exit(migrateCmd());
if (cmd === 'archive') process.exit(archiveCmd(rest));
if (cmd === 'svc') process.exit(svcCmd(rest));
if (cmd === 'mech') process.exit(mechCmd(rest));
if (cmd === 'lint') process.exit(lintCmd(rest));
console.error(`未知命令：${cmd}\n${USAGE}`);
process.exit(1);
