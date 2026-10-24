// taskflow-guard.js — TASKFLOW_GUARD 机制渲染产物（omp extension；源模板住技能仓 assets/guard/）
// 由 `node tf.mjs mech install TASKFLOW_GUARD` 渲染到项目 .omp/hooks/pre/（omp 自动发现加载）。
// 定位：taskflow 的全部强制力都要经模型一次正确执行——本 extension 把关键规则降到宿主层（模型绕不过）：
//   D 状态栏常显：活任务/待验收/敞口（I16 口径：verifying 已部署超 24h 未合并）——从"跑 ls 才见"变"常驻视野"
//   B 簿记校验：tf.mjs commit --files 空格分隔多文件 = 硬拦（连环踩坑实证）；deploy 不带 --web-only 且项目有 webCommands = 提醒
//   C 压缩接力注入：session.compacting 向压缩摘要注入 taskflow 接力线索——压缩不再丢任务上下文（铁律"先存档再跑"的宿主兜底）
//   A 部署墙：rsync/scp 部署特征、ssh+systemctl restart = 疑似绕过部署唯一入口（DEPLOY_ENTRY）
//   J 状态翻转墙（v2.69.0）：tool_call(edit/write/bash)——task.json/index.json 的 status/deploy.status 手改 = 物理拦截
//      （TF_STATUS 三档，缺省 enforce；翻转唯一合法写路径 = tf.mjs 各扳机命令，档案修复走 reconcile --fix）
//   K 验收期提醒（v2.69.0）：tool_call(bash)——git push/merge 时在档等验收任务 → 追加合并时序核对提醒（不拦；TF_VERIFY_WARN=off 关）
//   L 档案删除告警（v2.71.0）：tool_call(bash)——rm 触及 .taskflow/ 任务档案 = 不可逆删除风险 → 告警档提醒
//      （对齐 J 墙 off/warn/enforce 档位风格，缺省 warn；TF_RM_WARN=enforce 硬拦 / off 关闭；删除已归档任务须呈报
//      档案不可变原则逐用户确认——任务档案是跨会话账本，rm 删了没有 undo）
//   J19/J20 牵连排查+数据边界提醒（v2.72.0；v2.76.0 检索与文案修正）：tool_call(edit/write)——普通源码文件两检查
//      （.taskflow/ 档案走 J 墙/G 门不归这）：①J19 主名整词检索（去扩展名，.vue 例外）代码文件命中数 ≥
//      TF_IMPACT_THRESHOLD（缺省 3；文档散文提及不计、泛名不弹）→ 提醒呈报须含影响面清单（可跑 tf.mjs impact）；
//      ②J20 内容命中数据管道特征（edit 扫增量+盘上内容，注释行剔除）→ 提醒枚举真空与失真形态。纯提醒不拦：
//      TF_J19_WARN / TF_J20_WARN=off 各自关，缺省 warn、无 enforce 档——定位是「提醒必达」不是墙；两提醒同调用合并一条 additionalContext。
//   T 技能埋点（v2.69.0）：tool_call(read)——skill:// 加载计数入全局 skill-usage.jsonl（不受 guardOn 闸控，零内容仅计数，
//      供 tf.mjs skills --usage 报表；handler 整体吞错——omp hook fail-closed，抛错=阻断读取）
//   E 输出规范注入：before_provider_request 每轮把「双层输出规范 + 项目词表」前置进 system——
//      非 taskflow 会话也有叙事体+结构化底线；词表活读（.taskflow/glossary.md），词条改写下一轮即生效
//      （用户反馈「看不懂」→ 当场改写该词条白话到用户能理解的风格，无需重装 extension）
//   F 派发门：tool_call(task)——派发 prompt 引用 subtask spec 路径 → 校验必填节（背景/目标/验收/涉及文件/约束与禁止）
//      后把 spec 全文机械注入派发 prompt（{input} 替换）——「编排层凭记忆转述」物理失效（split.md 自包含纪律的宿主落地）；
//      引用了 spec 但文件缺失/必填节空 = 无条件 block；未引用 spec 的派发 = 提醒不拦（调研/审查类合法，三场景管制②③）
//   G 编辑边界门：tool_call(edit/write)——编辑路径归属任务后对照声明清单（spec「边界与影响面」+ subtasks「涉及文件」），
//      越界 = 默认警告 / TF_BOUND=enforce 硬拦 / off 单次跳过——单一职责与爆炸半径的机械不变量
//   H 同类排查提醒（v2.49.1 事件面重设计；v2.61.0 触发源收紧为子代理报告）：context 事件——子代理报告以
//      task-result 消息进入链（活体实证 tool_result(task) 只有 spawn 回执），尾部消息中「task-result 报告命中
//      blocker/阻塞/blocking/卡点」→ 追加三问提醒消息（幂等；普通对话/工具图例/自家提醒不含该标签不再误触发——
//      旧全文特征扫描曾自我喂养连续 8~10 轮，两会话实证）；CLASS_SWEEP_GATE，硬规则 25 的宿主轻提醒——
//      上游/下游/同类，修复前先扩散；提醒不拦，报告内否定语境（如「无 blockers」）仍会提醒=已知边界（频率低，提醒内自我声明兜底）
//   I 词表反馈沉淀（v2.57.0 用户拍板「逐轮催+压缩兜底」）：context 只数 user 角色强信号反馈（Set 去重计数），
//      词表未改写则 E 通道逐轮注入沉淀指令（可能猜错不拦操作），压缩时兜底一行——「反馈→沉淀」从模型自觉升级为宿主层闭环
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os'; // v2.54.1：G 门波浪号路径展开（编辑工具展开 ~ 而本层原不展开=清单内路径误报越界，另一 agent 会话 4 次误报实证）

function locateTasksDir(cwd) {
  try {
    const common = execFileSync('git', ['-C', cwd ?? process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const dir = path.join(path.dirname(common), '.taskflow');
    if (fs.existsSync(dir)) return dir;
  } catch { /* 非 git 目录 */ }
  return null;
}

function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

// 路径基归一（v2.49.1 活体第 4 缺陷）：git rev-parse 返回真实路径（/private/tmp/...），path.resolve 保留符号链接
// （/tmp/...）——两端基不一致时 startsWith/relative 恒错，F/G 比对在 symlink 环境全静默（/tmp 复现实证）。
const realPath = (p) => { let cur = p; const suffix = []; for (;;) { try { return path.join(fs.realpathSync(cur), ...suffix); } catch { /* 该层不存在，上爬 */ } suffix.unshift(path.basename(cur)); const parent = path.dirname(cur); if (parent === cur) return p; cur = parent; } }; // 递归归一到最深层存在祖先（新文件连目录都可能不存在——/var→/private/var、/tmp→/private/tmp 两环境实证）

// ---- J：状态翻转墙机器快照（v2.69.0）----
// 与 scripts/taskflow-state-machine.mjs 的 TRANSITIONS、references/data.md 状态机表同源——
// 改状态机必同步此处与该模块；版本漂移由 mech check 兜底。
const STATE_SNAPSHOT = {
  states: ['active', 'verifying', 'parked', 'merged', 'archived'],
  legal: [ // [from, to] 白名单（from null=建档前）；archive 是物理归层无 status 翻转，不入本表
    [null, 'active'], ['active', 'verifying'], ['active', 'merged'],
    ['active', 'parked'], ['parked', 'active'], ['verifying', 'merged'],
  ],
};
// J 门核心判定：对 edit/write 落在 task.json/index.json 的写入做「翻转前后」语义比对。
// 返回 null=放行；否则返回违规原因串。旧文件不存在（新建档案）仅 status=active 放行；
// 新内容解析失败视同违规（坏档案）；顶层 status 或 deploy.status 任一变化即翻转。
function judgeStatusFlip(abs, event) {
  const oldJ = readJsonSafe(abs);
  const toText = () => {
    if (event.toolName === 'write') return typeof event.input?.content === 'string' ? event.input.content : null;
    const disk = (() => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } })();
    if (disk === null) return null;
    const os = event.input?.old_string; const ns = event.input?.new_string;
    if (typeof os !== 'string' || typeof ns !== 'string') return null;
    return disk.split(os).join(ns); // edit 语义模拟：字面替换（与编辑工具同序；替换不命中=新内容=旧内容=放行）
  };
  let newJ = null;
  try { newJ = JSON.parse(toText()); } catch { /* 坏 JSON */ }
  const show = (v) => (v === undefined || v === null ? '（无）' : String(v));
  const tail = `违规（data.md 状态机表：翻转唯一写路径 commit --deployed / accept --pass / park / unpark / archive；档案修复走 node tf.mjs reconcile --fix）。单次豁免：命令前加 TF_STATUS=off`;
  if (!newJ || typeof newJ !== 'object') {
    return `TASKFLOW_GUARD J 状态翻转墙：${abs} 新内容解析失败（坏档案）——${tail}`;
  }
  const fromS = oldJ?.status; const toS = newJ.status;
  const fromD = oldJ?.deploy?.status; const toD = newJ.deploy?.status;
  if (!oldJ) { // 新建档案：仅 status=active（且不带 verifying 部署态）放行
    if (toS === 'active' && toD !== 'verifying') return null;
    return `TASKFLOW_GUARD J 状态翻转墙：${abs} 新建档案 status ${show(toS)} 非法（仅 active 可建档）——${tail}`;
  }
  if (fromS === toS && fromD === toD) return null; // 无翻转
  const flips = [];
  if (fromS !== toS) flips.push(`status ${show(fromS)}→${show(toS)}`);
  if (fromD !== toD) flips.push(`deploy.status ${show(fromD)}→${show(toD)}`);
  const legal = STATE_SNAPSHOT.legal.some(([f, t]) => f === fromS && t === toS);
  return `TASKFLOW_GUARD J 状态翻转墙：${abs} ${flips.join(' + ')} ${legal ? '' : '（该翻转亦不在状态机白名单）'}——${tail}`;
}

// ---- D：状态栏 / E：实况行共用的活任务分桶（v2.69.0 抽取） ----
// verifying 用 isVerifying 双源口径（顶层 status 或 deploy.status 任一命中，v2.18.2 同源）
function collectLive(tasksDir) {
  const out = { active: [], verifying: [], parked: [] };
  const idx = readJsonSafe(path.join(tasksDir, 'index.json'))?.tasks ?? [];
  for (const row of idx) {
    if (!row?.id) continue;
    const tj = readJsonSafe(path.join(tasksDir, row.id, 'task.json')); // 事实源 task.json（I1），缺档回退 index 行
    const status = tj?.status ?? row?.status;
    const item = { id: row.id, status, deployedAt: tj?.deploy?.deployedAt ?? null };
    if (status === 'verifying' || tj?.deploy?.status === 'verifying') out.verifying.push(item);
    else if (status === 'active') out.active.push(item);
    else if (status === 'parked') out.parked.push(item);
  }
  return out;
}


// ---- D：状态栏 ----
function statusLine(tasksDir) {
  const live = collectLive(tasksDir); // v2.69.0 改分桶数据源（verifying 双源口径），显示行为不变
  if (!live.active.length && !live.verifying.length) return '';
  let s = `tf:进行中${live.active.length}`;
  if (live.verifying.length) {
    let exposure = 0;
    for (const t of live.verifying) {
      if (t.deployedAt && Date.now() - Date.parse(t.deployedAt) > 86400000) exposure++; // I16 口径：已部署未合并超 24h
    }
    s += ` 等你验收${live.verifying.length}${exposure ? ` ⚠${exposure}个已上线超24小时未合并` : ''}`;
  }
  return s;
}
function refreshStatus(ctx) {
  const dir = locateTasksDir(ctx?.cwd);
  if (!dir) return;
  const s = statusLine(dir);
  if (s) ctx.ui?.setStatus?.('tf', s);
}

// ---- B：簿记参数校验 ----
// --files 是逗号分隔列表；空格分隔只落首个文件（2026-10-09 多子代理连环踩坑实证）
function spaceSeparatedFiles(cmd) {
  const at = cmd.indexOf('--files');
  if (at === -1) return false;
  const toks = cmd.slice(at + '--files'.length).trim().split(/\s+/);
  const files = [];
  for (const t of toks) { if (t.startsWith('-')) break; files.push(t); }
  return files.length > 1;
}

// ---- A：部署特征 ----
const DEPLOY_SIG = /\brsync\b[^\n|;&]*(\/opt\/|\.jar\b|\/web\/)|\bscp\b[^\n|;&]*(\/opt\/|\.jar\b|\/web\/)|\bssh\b[^\n|;&]*systemctl[^\n|;&]*(restart|stop|reload)/;
// ---- I：反馈信号（用户「看不懂」类强信号；「人话」单词不单列——问原理也命中，2026-10-11 本会话实证误报） ----
const FEEDBACK_SIG = /看不懂|没看懂|看不明白|读不懂|没明白|不明白|什么意思|说人话|讲人话|太术语/;
// ---- E：输出规范注入（词表活读） ----
function buildInject(cwd) {
  const dir = locateTasksDir(cwd);
  if (!dir) return null; // 零干扰边界：无 .taskflow 的项目不注入
  const lines = [
    '[面向用户输出规范（TASKFLOW_GUARD 注入）]',
    '- 给用户看的内容：完整因果句（谁、对谁、做了什么、所以怎样）、结论先行；术语/代号/缩写首次出现后面直接跟括号大白话（白话从下方词表抄，词表没有的词当场补录；用户说看不懂 → 当场改写词表，下一轮生效）',
    '- 多个并列/对比先给骨架（表格/编号清单/矩阵），格子内用叙事句展开；禁名词定语堆栈、禁未解释的代号；一段一个中心 ≤4 句',
  ];
  const glossary = readGlossary(path.join(dir, 'glossary.md'));
  if (glossary.length) {
    lines.push('- 行话对照（写作时先对表说人话，词表可迭代——用户说看不懂就改写白话）：');
    for (const g of glossary) lines.push(`  ${g.term}=${g.plain}`);
  }
  const live = collectLive(dir); // E 实况状态行（v2.69.0）：活任务分桶入 system，每轮刷新
  const shortTs = (iso) => (typeof iso === 'string' && !Number.isNaN(Date.parse(iso)) ? iso.slice(5, 16).replace('T', ' ') : null);
  const vPart = live.verifying
    .map((t) => { const at = shortTs(t.deployedAt); return at ? `${t.id}（部署 ${at}）` : t.id; })
    .join('、');
  const parts = [];
  if (live.active.length) parts.push(`活 ${live.active.map((t) => t.id).join('、')}`);
  if (vPart) parts.push(`等验收 ${vPart}`);
  if (live.parked.length) parts.push(`挂起 ${live.parked.map((t) => t.id).join('、')}`);
  if (parts.length) lines.push(`taskflow 实况：${parts.join('；')}`);
  return lines.join('\n');
}
function readGlossary(p) {
  const text = (() => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } })();
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    if (!cells[1] || !cells[2] || /^[-: ]+$/.test(cells[1]) || cells[1] === '行话') continue;
    rows.push({ term: cells[1], plain: cells[2] });
  }
  return rows;
}

// ---- F：派发门（spec 校验 + 机械注入）----
const SPEC_REF_RE = /\.taskflow\/[^\s'"`()[\]（）]*spec\.md/g; // 派发词里引用的 spec 路径（.taskflow/<id>/subtasks/<n>/spec.md 或任务级 spec.md）
const SUBSPEC_REQUIRED = [
  ['背景', /^背景(\s|$|（)/],
  ['目标', /^目标(\s|$|（)/],
  ['验收', /^验收(\s|$|（)/],
  ['涉及文件', /^涉及文件(\s|$|（)/],
  ['约束与禁止', /^约束与禁止(\s|$|（)/],
];
const TASKSPEC_REQUIRED = [
  ['目标', /^目标(\s|$|（)/],
  ['验收标准', /^验收标准(\s|$|（)/],
];

function resolveSpecRef(ref, cwd, mainRoot) {
  // .taskflow/ 住主仓库（worktree 内会话也要回主仓库找）；绝对路径原样
  const cands = path.isAbsolute(ref)
    ? [ref]
    : [mainRoot ? path.join(mainRoot, ref) : null, cwd ? path.join(cwd, ref) : null].filter(Boolean);
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* 候选不存在 */ } }
  return null;
}

function extractSectionBody(md, nameRe) {
  // 从 '## <名>' 节取正文到下一个 '## '（'###' 子节留在正文内）；节不存在返回 ''
  const lines = md.split('\n');
  let inSec = false;
  const body = [];
  for (const ln of lines) {
    if (/^##\s/.test(ln)) {
      if (inSec) break;
      inSec = nameRe.test(ln.replace(/^##\s+/, '')); // 节名测试剥掉 '## ' 前缀（锚定 ^ 的节名正则才对得上）
      continue;
    }
    if (inSec) body.push(ln);
  }
  return body.join('\n');
}

function validateSpecRequired(text, isSubtask) {
  const missing = [];
  for (const [name, re] of isSubtask ? SUBSPEC_REQUIRED : TASKSPEC_REQUIRED) {
    const body = extractSectionBody(text, re);
    // 占位不算内容：剥注释 / 剥 `<占位符>` bullet / 剥「（暂无）」
    const solid = body.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*[-*]\s*<[^>]*>.*$/gm, '').replace(/（暂无）/g, '').trim();
    if (!solid) missing.push(body.trim() ? `${name}（仅占位）` : name);
  }
  return missing;
}

// ---- G：编辑边界门（声明清单收集）----
// v2.55.2 花括号展开：spec 清单常写 `docs/prd/{a,b,c}/functional.md` 缩写（subtask spec 模板同款）——收集器不展开=清单内文件全误报（Rewriter 子代理会话 21 次误报实证）。单层通配递归展开，嵌套 {a{b,c}} 亦支持；无 {} 原样返回。
const expandBraces = (p) => {
  const m = p.match(/^(.*?)\{([^{}]*)\}(.*)$/s);
  if (!m) return [p];
  return m[2].split(',').flatMap((alt) => expandBraces(m[1] + alt.trim() + m[3]));
};

function collectDeclaredFiles(taskDir) {
  const out = new Set();
  const addFromSection = (md, secRe) => {
    for (const lnRaw of extractSectionBody(md, secRe).split('\n')) {
      if (/明确不做|禁止|不含|不涉及|负面/.test(lnRaw)) continue; // v2.52.0 负面清单行排除实装（文档与注释早已宣称、代码缺失——入清单=放行禁改文件，对抗审查实锤）
      // v2.61.1 F-02 先整行花括号展开再收集：bullet 正则字符类排除逗号，`docs/prd/{x,y}/functional.md`
      // 在收集阶段截断成 `docs/prd/{x`（无闭括号串 expandBraces 原样返回=真路径清单外误报，审查实锤；
      // v2.55.2 只对反引号 matchAll 分支生效，主流 bullet 写法仍断）。展开后行内不再有 {a,b}，收集零截断
      for (const ln of expandBraces(lnRaw)) {
        const m = ln.match(/^\s*[-*]\s+`?([^\s`（(，,：:]+)/);
        if (m) {
          const p = m[1].replace(/^\.\//, '').replace(/\/+$/, '');
          // bold 标签（**xxx**）= 模板小节标签非路径——活体实证：当路径收集后清单全是垃圾、真路径被冒号截断（v2.49.1）
          if (p && !p.startsWith('<') && !/^\*\*.*\*\*$/.test(p)) out.add(p); // 花括号已在上层整行展开
        }
        // 冒号后反引号路径（治截断：「改动文件集合声明**：`a.swift`、`b.swift`」）——仅声明语义行收集，
        // 禁止/负面清单行（明确不做/禁止改动）的反引号路径不入清单（入=放行禁改文件）
        if (/改动文件|涉及文件|正向清单|文件集合|声明/.test(ln)) {
          for (const q of ln.matchAll(/`([^`\s]+)`/g)) {
            const p = q[1].replace(/^\.\//, '').replace(/\/+$/, '');
            if (p.includes('/') || /\.[A-Za-z0-9]+$/.test(p)) out.add(p); // 像路径才收：含 / 或带扩展名；花括号已在上层整行展开
          }
        }
      }
    }
  };
  const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const specMd = readSafe(path.join(taskDir, 'spec.md'));
  if (specMd) {
    addFromSection(specMd, /^边界与影响面(\s|$|（)/);
    addFromSection(specMd, /^涉及文件(\s|$|（)/);
  }
  const subRoot = path.join(taskDir, 'subtasks');
  let subs = [];
  try { subs = fs.readdirSync(subRoot, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { /* 无子任务 */ }
  for (const d of subs) addFromSection(readSafe(path.join(subRoot, d.name, 'spec.md')), /^涉及文件(\s|$|（)/);
  return [...out];
}
// ---- J19/J20 机械件独立副本（v2.72.0 起；v2.76.0 检索修正——与 scripts/tf.mjs impact 命令同款逻辑，
// 守门是独立渲染产物必须自包含，两处改动须同步+跑 tf.test.mjs 对账）----
// E1/D1/S10-8：J19 泛名清单（主名命中即不弹——全仓高频且引用语义不可辨，防噪音疲劳）；文档/帮助文本判定（不计 J19 阈值）
const TF_GENERIC_BASENAMES = new Set(['index', 'main', 'app', 'utils', 'util', 'helpers', 'helper', 'types', 'type', 'constants', 'constant', 'config', 'conf', 'api', 'common', 'shared', 'global', 'misc']);
const isDocPath = (f) => /\.(?:md|mdx|txt|rst|adoc)$/i.test(f) || /^(?:README|CHANGELOG|LICENSE|CONTRIBUTING)/i.test(path.basename(f)) || /(?:^|\/)docs?\//i.test(f);
// v2.77.1（R2 F2b①，与 scripts/tf.mjs impact EXT_FAMILY 同款映射——守门是独立渲染产物必须自包含，两处改动须同步+跑 tf.test.mjs 对账）：
// 同扩展名族映射；族外扩展名不设限由「异扩展名命中过半」跨语言歧义注记兜底（F2b②）；.vue=null（检索串带扩展名，限定 .vue 族会漏 .ts 消费方）
const EXT_FAMILY = {
  '.ts': ['.ts', '.tsx', '.mts', '.cts'], '.tsx': ['.ts', '.tsx', '.mts', '.cts'], '.mts': ['.ts', '.tsx', '.mts', '.cts'], '.cts': ['.ts', '.tsx', '.mts', '.cts'],
  '.js': ['.js', '.jsx', '.mjs', '.cjs'], '.jsx': ['.js', '.jsx', '.mjs', '.cjs'], '.mjs': ['.js', '.jsx', '.mjs', '.cjs'], '.cjs': ['.js', '.jsx', '.mjs', '.cjs'],
  '.java': ['.java'], '.kt': ['.kt', '.kts'], '.kts': ['.kt', '.kts'], '.scala': ['.scala'], '.groovy': ['.groovy'],
  '.py': ['.py'], '.rb': ['.rb'], '.php': ['.php'], '.go': ['.go'], '.rs': ['.rs'], '.swift': ['.swift'], '.cs': ['.cs'],
  '.c': ['.c', '.h'], '.h': ['.c', '.h'], '.cpp': ['.cpp', '.cc', '.cxx', '.hpp'], '.cc': ['.cpp', '.cc', '.cxx', '.hpp'], '.cxx': ['.cpp', '.cc', '.cxx', '.hpp'], '.hpp': ['.cpp', '.cc', '.cxx', '.hpp'],
  '.vue': null,
};
// D3②③/S10-8：J20 词表补英文管道形态（i 志大小写）；算子补 reduce/aggregate + i 志 + SQL GROUP BY 形态；
// 注释行（//、/*、*、<!--、# 开头）剔除后再计数——注释/UI 文案里的词提及不算管道证据（真仓实测误报主源）
const J20_WORD_RE = /环比|同比|上期|较上期|对比|排名|统计|previous[\s_-]*(?:period|month|week)|last[\s_-]*(?:period|month|week)|month[\s_-]*over[\s_-]*month|year[\s_-]*over[\s_-]*year/gi;
const J20_CODE_RE = /\b(?:sum|count|avg|max|min|sort|reduce|aggregate)\s*\(/gi;
function j20CodeLines(text) { // D3④：首 500+尾 200 行窗口（固定 500 行窗口漏文件尾部管道）；注释行剔除
  const lines = String(text ?? '').split('\n');
  const win = lines.length > 700 ? [...lines.slice(0, 500), ...lines.slice(-200)] : lines;
  return win.filter((l) => { const t = l.trim(); return t && !/^(?:\/\/|\/\*|\*|<!--|#)/.test(t); });
}
function j20Scan(text) { // 词特征任一命中；代码特征须 ≥2 个不同算子（单 sort(/count( 全仓皆是无害噪音）；GROUP BY 单独记一算子
  const body = j20CodeLines(text).join('\n');
  const words = [...new Set(body.match(J20_WORD_RE) ?? [])];
  const codes = new Set((body.match(J20_CODE_RE) ?? []).map((s) => s.replace(/\s+/g, '')));
  if (/\bGROUP\s+BY\b/i.test(body)) codes.add('GROUP BY');
  return { hit: words.length > 0 || codes.size >= 2, detail: [...words, ...codes].slice(0, 6).join('、') };
}

export default function taskflowGuard(pi) {
  pi.setLabel('Taskflow Guard');

  // v2.54.0 采纳面自检（对抗审查实证：任意 token mech install 都渲染 guard——未采纳 TASKFLOW_GUARD 的项目被 F 硬拦/A 警告误伤）：
  // 未在 project.json.mechanisms 登记采纳 → 八功能整体静默（卸载语义：删文件或清登记皆可关闭）
  const guardOn = (cwd) => { try { const d = locateTasksDir(cwd); if (!d) return false; const j = JSON.parse(fs.readFileSync(path.join(d, 'project.json'), 'utf8')); return !!j?.mechanisms?.TASKFLOW_GUARD; } catch { return false; } };

  pi.on('session_start', async (_e, ctx) => { if (guardOn(ctx?.cwd)) refreshStatus(ctx); });
  pi.on('turn_end', async (_e, ctx) => { if (guardOn(ctx?.cwd)) refreshStatus(ctx); });
  // I 沉淀状态（会话内）：seen=已计数反馈文本（context 每轮重放全量消息，Set 去重）；pending=未沉淀计数（写词表清零）
  const sed = { seen: new Set(), pending: 0 };

  pi.on('session.compacting', async (_e, ctx) => {
    if (!guardOn(ctx?.cwd)) return undefined;
    const dir = locateTasksDir(ctx?.cwd);
    const live = (readJsonSafe(path.join(dir, 'index.json'))?.tasks ?? [])
      .filter((t) => t?.status === 'active' || t?.status === 'verifying');
    const lines = live.length ? [
      '压缩摘要必须保留 taskflow 接力线索（TASKFLOW_GUARD 宿主注入）：',
      ...live.slice(0, 5).map((t) => `- 任务 ${t.id}（${t.status}）：${t.title ?? ''}｜分支 ${t.branch ?? '?'}`),
      '恢复入口：会话开头 @taskflow 或直接 node tf.mjs ls；下一步与未决风险以各任务 handoff.md 为准（摘要不准替代档案）',
    ] : [];
    if (sed.pending > 0) lines.push(`- 词表反馈沉淀（TASKFLOW_GUARD I）：还有 ${sed.pending} 处「看不懂」类反馈未处理——压缩前先把涉事术语的大白话改写/补录进 .taskflow/glossary.md（词表活读下一轮生效）`);
    if (!lines.length) return undefined;
    return { context: lines };
  });

  pi.on('tool_call', async (event, ctx) => {
    if (!guardOn(ctx?.cwd)) return undefined; // v2.54.0 采纳面自检
    if (event.toolName !== 'bash') return undefined;
    const cmd = String(event.input?.command ?? '');
    if (!cmd) return undefined;

    // A 部署墙：tf.mjs deploy 入口自身放行（入口内部的 ssh/rsync 不经宿主 bash 工具，不会触发本拦截）
    // v2.52.0 分段判定+入口形态锚定（对抗审查实证）：旧「全串含 tf.mjs+deploy 即放行」让组合命令「入口调用 && rsync 上包」整体绕过墙；
    // 旧 B2「全串含 deploy 词即提醒」让只读 grep/cat/sed 提及 deploy-preflight 也误触（活体两次实证）。现按 &&/;;/换行 分段逐段判。
    const segs = cmd.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter(Boolean);
    const entryCall = (s) => /(^|[\/\s;&])tf\.mjs\s+deploy\b/.test(s);
    const badSeg = segs.find((s) => DEPLOY_SIG.test(s) && !entryCall(s));
    if (badSeg) {
      const mode = process.env.TF_WALL;
      if (mode === 'off') return undefined;
      const why = '这条命令像是在绕过统一部署入口直接部署（往服务器拷文件 / 重启服务）。TASKFLOW_GUARD 部署墙（taskflow 装在 omp 里的自动检查脚本，这一条是它的部署拦截）提醒：本项目所有部署必须走唯一入口「node tf.mjs deploy」（DEPLOY_ENTRY：统一部署入口）。入口会自动做三件事——部署前预检（防止把别人刚上线的版本盖掉）、检查有没有任务正在线上等验收（有就先让位不部署）、把这次部署登记进档案。绕过入口直接部署 = 档案里缺这笔账，之后跑对账检查（doctor I17：把部署记录和服务器上的实际文件逐项比对）一定亮红灯。若确属人工回滚或特殊运维：与用户确认后，在命令前加 TF_WALL=off（表示本次跳过部署拦截）执行，并在 progress.md（任务进度文件）里记一行原因。';
      return mode === 'enforce' ? { block: true, reason: why } : { additionalContext: `⚠ ${why}` };
    }

    // J bash 通道（v2.69.0）：重定向/tee/sed -i 触及任务档案且非 tf.mjs 命令 = 疑似手改 status。
    // bash 写入是整文件覆盖，无法像 edit/write 那样做翻转前后比对，按 TF_STATUS 档直接处理。
    if (!cmd.includes('tf.mjs') && /(>|>>|\btee\s|\bsed\s+-i)[^|;&]*(task\.json|index\.json)/.test(cmd)) {
      const modeJ = process.env.TF_STATUS;
      if (modeJ !== 'off' && locateTasksDir(ctx?.cwd)) {
        const why = 'TASKFLOW_GUARD J 状态翻转墙：bash 重定向/tee/sed 触及任务档案（task.json/index.json）——手改 status = 违规（data.md 状态机表：翻转唯一写路径 commit --deployed / accept --pass / park / unpark / archive；档案修复走 node tf.mjs reconcile --fix）。单次豁免：命令前加 TF_STATUS=off';
        return modeJ === 'warn' ? { additionalContext: `⚠ ${why}` } : { block: true, reason: why };
      }
    }

    // L 档案删除告警（v2.71.0）：rm 触及 .taskflow/ 任务档案 = 不可逆删除风险 → 告警档（对齐 J 墙档位风格，缺省 warn）。
    // 档案是跨会话账本（任务状态、checkpoint、决策、交接记录），rm 删了没有 undo；删除已归档任务须走归档清理确认（逐用户确认）。
    if (/\brm\b/.test(cmd) && /\.taskflow/.test(cmd) && process.env.TF_RM_WARN !== 'off') {
      const dirL = locateTasksDir(ctx?.cwd);
      if (dirL) {
        const why = 'TASKFLOW_GUARD L 档案删除告警：rm 命令触及 .taskflow/ 任务档案——档案是跨会话账本（任务状态、checkpoint（检查点）、决策、交接记录都在里面），删除不可恢复。删除已归档任务须先呈报档案不可变原则并逐用户确认；确属有意删除（废弃临时目录等）：命令前加 TF_RM_WARN=off 单次豁免，并在 progress.md（任务进度文件）记一行原因。';
        return process.env.TF_RM_WARN === 'enforce' ? { block: true, reason: why } : { additionalContext: `⚠ ${why}` };
      }
    }

    // K 验收期 git 操作提醒（v2.69.0）：在档等验收任务时 git push/merge 先提醒核对合并时序。
    // 不拦——部署服务器拉取 push 属合法流量；TF_VERIFY_WARN=off 关闭（仅 off 档，缺省开）。
    if (/\bgit (push|merge)\b/.test(cmd) && process.env.TF_VERIFY_WARN !== 'off') {
      const dirK = locateTasksDir(ctx?.cwd);
      const vt = dirK ? collectLive(dirK).verifying.filter((t) => t.status !== 'merged') : [];
      if (vt.length) {
        return { additionalContext: `⚠ TASKFLOW_GUARD K：任务 ${vt.map((t) => t.id).join('、')} 正在等验收——push/merge 前先核对 conventions.md 合并时序（默认先合并后部署验收；验收先行项目 verifying 悬置更长属正常）。确无涉任务或已核对时序：忽略本提醒；TF_VERIFY_WARN=off 关闭本提醒。` };
      }
    }

    if (cmd.includes('tf.mjs')) {
      // B1 --files 空格分隔 = 调用即红（旧形态：静默落错账，事后 doctor 补登）
      if (spaceSeparatedFiles(cmd)) {
        return { block: true, reason: '命令已拦下，格式错了：tf.mjs commit --files 的多个文件要用逗号分隔（正确写法：--files a.md,b.md），用空格分隔时只有第一个文件会被登记进档案（历史上多次踩过这个坑）。把空格改成逗号后重试。' };
      }
      // B2 deploy 缺 --web-only 提醒（不拦：jar-only 部署合法；项目有 webCommands 时才提醒）——v2.52.0 收紧为入口形态锚定
      if (entryCall(cmd) && !cmd.includes('--web-only') && !cmd.includes('--dry-run')) {
        const dir = locateTasksDir(ctx?.cwd);
        const web = dir ? readJsonSafe(path.join(dir, 'project.json'))?.deploy?.webCommands : null;
        if (Array.isArray(web) && web.length) {
          return { additionalContext: '⚠ 提醒（不拦执行）：tf.mjs deploy 默认只更新后端程序包（jar：服务器上运行的程序文件）；本项目还配置了前端更新命令（webCommands），这次部署不会带上前端——需要再跑一次 node tf.mjs deploy --web-only 单独更新前端，并核对服务器上的前端文件确实是新版本（历史事故：后端更新了、前端没跟上）。' };
        }
      }
    }
    return undefined;
  });

  // F 派发门：派发 prompt 引用 spec → 校验必填节 → {input} 机械注入全文（凭记忆转述物理失效）
  pi.on('tool_call', async (event, ctx) => {
    if (!guardOn(ctx?.cwd)) return undefined; // v2.54.0 采纳面自检
    if (event.toolName !== 'task') return undefined;
    const input = event.input;
    const tasks = Array.isArray(input?.tasks) ? input.tasks : null;
    if (!tasks || !tasks.length) return undefined;
    const dir = locateTasksDir(ctx?.cwd);
    if (!dir) return undefined; // 零干扰边界：非 taskflow 项目不校验不注入（审查 blocker 2——其余 handler 同款守卫）
    const mainRoot = path.dirname(dir);
    const rebuilt = [];
    let modified = false;
    for (const t of tasks) {
      const prompt = String(t?.task ?? '');
      const refs = [...new Set([...prompt.matchAll(SPEC_REF_RE)].map((m) => m[0]))];
      if (!refs.length) { rebuilt.push(null); continue; }
      let firstAbs = null;
      for (const ref of refs) {
        const abs = resolveSpecRef(ref, ctx?.cwd, mainRoot);
        if (!abs) {
          return { block: true, reason: `TASKFLOW_GUARD F 派发门：派发词引用的 spec 不存在（${ref}）——先按 templates/subtask-spec.md 落规格再派发（split.md：spec 必须自包含，执行者只认文档不认会话记忆）` };
        }
        const missing = validateSpecRequired(fs.readFileSync(abs, 'utf8'), ref.includes('/subtasks/'));
        if (missing.length) {
          return { block: true, reason: `TASKFLOW_GUARD F 派发门：${ref} 必填节缺失或为空——${missing.join('、')}；补齐后再派发（subtask spec 节名：背景/目标/验收/涉及文件/约束与禁止；任务级 spec 节名：目标/验收标准）` };
        }
        firstAbs ??= abs;
      }
      const specText = fs.readFileSync(firstAbs, 'utf8');
      const taskId = firstAbs.match(/\.taskflow[^/]*\/([^/]+)\//)?.[1] ?? null;
      const tj = dir && taskId ? readJsonSafe(path.join(dir, taskId, 'task.json')) : null;
      const wt = tj?.worktree ? `\n工作目录（worktree）：${tj.worktree}\n` : '';
      rebuilt.push(
        `[TASKFLOW_GUARD F 派发门——以下 spec 全文机械读取自 ${refs[0]}（split.md 自包含纪律的宿主落地，编排层凭记忆转述=违规）]\n\n`
        + `${specText}\n${wt}\n`
        + '——范围纪律：只做本子任务范围内的事，不顺手改其他代码；完成后报告：改动文件清单、验收命令运行结果、遗留问题。\n'
        + `——编排层原始派发词（原样保留备查）：\n${prompt}`,
      );
      modified = true;
    }
    if (!modified) {
      // 未引用 spec：有活任务的 taskflow 项目提醒（不拦——调研/审查类派发合法，三场景管制②③）
      const idx = dir ? readJsonSafe(path.join(dir, 'index.json'))?.tasks ?? [] : [];
      if (idx.some((x) => x?.status === 'active' || x?.status === 'verifying')) {
        return { additionalContext: '⚠ TASKFLOW_GUARD F（自动检查脚本的派发检查）提醒，不拦截：实现类子代理派发应先写好任务说明书（spec：.taskflow/<任务id>/subtasks/<编号>/spec.md，含背景/目标/验收/涉及文件/约束五节），并在派发词里引用它的路径——omp（运行本技能的宿主工具）会校验五节是否齐全，再把说明书全文原样塞给子代理，防止凭记忆转述、细节走样。调研/审查类派发不受此约束，可忽略本提醒。' };
      }
      return undefined;
    }
    return { input: { ...input, tasks: tasks.map((t, i) => (rebuilt[i] === null ? t : { ...t, task: rebuilt[i] })) } };
  });

  // G 编辑边界门：edit/write 路径对照任务声明清单——越界默认警告 / TF_BOUND=enforce 硬拦 / off 跳过
  pi.on('tool_call', async (event, ctx) => {
    if (!guardOn(ctx?.cwd)) return undefined; // v2.54.0 采纳面自检
    if (event.toolName !== 'edit' && event.toolName !== 'write') return undefined;
    const raw = event.input?.path;
    if (!raw || typeof raw !== 'string') return undefined;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(raw)) return undefined; // v2.55.2 协议地址过滤：agent://（子代理消息）/conflict://（解冲突块）/xd:// 等非文件系统路径不入比对（scheme≥2 字符不误伤 Windows 单字母盘符；主会话 conflict:// 与 agent:// 两形态实证误报）
    const rawN = (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) ? path.join(os.homedir(), raw.slice(1)) : raw; // v2.54.1 波浪号展开：与编辑工具展开时机对齐（path.resolve 不展开 ~，旧版把 ~/x 拼成 <cwd>/~/x → 前缀比对必失败误报越界）
    const dir = locateTasksDir(ctx?.cwd);
    if (!dir) return undefined; // 零干扰边界
    const mainRoot = realPath(path.dirname(dir)); // 路径基归一：git 真实路径 ↔ resolve 符号链接路径统一（symlink 环境比对恒错实证）
    const abs = realPath(path.resolve(ctx?.cwd ?? process.cwd(), rawN)); // realpath 失败（新文件不存在）保 resolve 原值；v2.54.1 rawN=波浪号已展开
    // J 状态翻转墙（v2.69.0）：先于 G 边界门——G 的簿记白名单会放行 .taskflow 内编辑，status 手改必须先在这里拦
    const bname = path.basename(abs);
    if ((bname === 'task.json' || bname === 'index.json') && abs.startsWith(dir + path.sep)) {
      const whyJ = judgeStatusFlip(abs, event);
      if (whyJ) {
        const modeJ = process.env.TF_STATUS;
        if (modeJ !== 'off') return modeJ === 'warn' ? { additionalContext: `⚠ ${whyJ}` } : { block: true, reason: whyJ };
      }
    }
    const idx = readJsonSafe(path.join(dir, 'index.json'))?.tasks ?? [];
    const live = idx.filter((t) => t?.status === 'active' || t?.status === 'verifying');
    if (!live.length) return undefined;
    // 归属判定：worktree 前缀（含兄弟子任务 worktree 命名 <task-worktree>-<n>-<slug>）；主仓库内编辑且仅一个活任务 → 归它
    let owner = null; let base = null;
    for (const t of live) {
      // v2.61.1 F-01 幽灵 worktree：两级查找后仍空/缺失 → 跳过该任务归属判定，绝不让空串进 realPath
      // （realPath('') 抛错上爬到 realpathSync('.') 返回项目根，`if (!w)` 拦不住真值——无 worktree 任务
      // 变成罩住整个主仓库的幽灵归属；guard-h-misfire-20261013 档案 task.json 即无 worktree 字段=活体暴露面）
      const rawW = typeof t.worktree === 'string' && t.worktree ? t.worktree : readJsonSafe(path.join(dir, t.id, 'task.json'))?.worktree; // worktree 事实源=task.json（I1）
      if (typeof rawW !== 'string' || !rawW) continue;
      const w = realPath(rawW); // 双向路径归一（realPath 失败保原值=worktree 已删场景）
      if (abs === w || abs.startsWith(w + path.sep)) { owner = t; base = w; break; }
      // 兄弟子任务 worktree（<task-worktree>-<n>-<slug>）：base 取子 worktree 根，rel 才是仓库相对路径（直接 base=w 会以 '..' 开头被下方守卫放行=死路，审查 blocker 1）；数字段收紧防 `-backup` 类同名误归因
      const sib = abs.startsWith(w + '-') ? abs.slice(w.length + 1) : '';
      if (sib && /^\d+-/.test(sib)) {
        const cut = abs.indexOf(path.sep, w.length + 1);
        owner = t; base = cut === -1 ? abs : abs.slice(0, cut);
        break;
      }
    }
    if (!owner) {
      if (abs !== mainRoot && !abs.startsWith(mainRoot + path.sep)) return undefined; // 主仓库与任何 worktree 之外 → 零干扰
      // 多活任务 × 主仓库编辑：并集比对（v2.49.1 活体实证修订——旧「归属不明放行」在 status 悬挂脏数据下
      // 变成主路径永久静默：TeslaCamView 两个已合并任务未翻 merged，G 门全灭。并集命中放行，全不命中点名全部活任务）
      const union = new Set();
      for (const t of live) for (const p of collectDeclaredFiles(path.join(dir, t.id))) union.add(p);
      if (!union.size) return undefined; // 全部活任务都无清单 → 零干扰
      const relU = path.relative(mainRoot, abs);
      if (!relU || relU.startsWith('..')) return undefined;
      if (relU === '.taskflow' || relU.startsWith('.taskflow/') || relU.startsWith('.omp/') || path.basename(relU) === '.owner.json') return undefined; // 簿记白名单
      if ([...union].some((d) => relU === d || relU.startsWith(d.endsWith('/') ? d : d + '/'))) return undefined;
      const whyU = `TASKFLOW_GUARD G 编辑边界门（自动检查脚本的编辑范围检查）警告：${relU} 不在任何进行中任务（${live.map((t) => t.id).join('、')}）声明的改动清单里（各任务清单 = 任务说明书 spec 的「边界与影响面」+ 各子任务「涉及文件」的合计）。主仓库检出区应保持干净、只作合并落点——任务都在各自的 worktree（独立工作副本）里改代码。请先确定这个文件归属哪个任务：到对应 worktree 里开工，或把路径加进该任务 spec 清单并跑 node tf.mjs req-confirm（范围变更登记命令）留痕。确属例外情况：与用户确认后在命令前加 TF_BOUND=off（表示本次跳过边界检查）执行，并在 progress.md（任务进度文件）里记一行原因。`;
      const modeU = process.env.TF_BOUND;
      if (modeU === 'off') return undefined;
      return modeU === 'enforce' ? { block: true, reason: whyU } : { additionalContext: `⚠ ${whyU}` };
    }
    const rel = path.relative(base, abs);
    if (!rel || rel.startsWith('..')) return undefined;
    if (rel === '.taskflow' || rel.startsWith('.taskflow/') || rel.startsWith('.omp/') || path.basename(rel) === '.owner.json') return undefined; // 簿记白名单
    const declared = collectDeclaredFiles(path.join(dir, owner.id));
    if (!declared.length) return undefined; // 无清单可对照（未落 spec 的旧任务）→ 零干扰
    const hit = declared.some((d) => rel === d || rel.startsWith(d.endsWith('/') ? d : d + '/'));
    if (hit) return undefined;
    const why = `TASKFLOW_GUARD G 编辑边界门（自动检查脚本的编辑范围检查）警告：${rel} 不在任务 ${owner.id} 开工时声明的改动清单里（清单 = 任务说明书 spec 的「边界与影响面」一节 + 各子任务「涉及文件」的合计）——这条纪律是为了让一个任务只做一件事、出问题好回滚。确实需要改这个文件：先把它的路径加进 spec 对应清单，再跑 node tf.mjs req-confirm（范围变更登记命令）登记这次范围变更，然后继续。确属例外情况：与用户确认后在命令前加 TF_BOUND=off（表示本次跳过边界检查）执行，并在 progress.md（任务进度文件）里记一行原因。`;
    const mode = process.env.TF_BOUND;
    if (mode === 'off') return undefined;
    return mode === 'enforce' ? { block: true, reason: why } : { additionalContext: `⚠ ${why}` };
  });
  // I 消账：write/edit 落在项目词表 = 本批反馈已沉淀（宽松判定——不校验改写内容，质量由验收把）
  pi.on('tool_call', async (event, ctx) => {
    if (!guardOn(ctx?.cwd)) return undefined;
    const p = String(event?.input?.path ?? '');
    if ((event?.toolName === 'write' || event?.toolName === 'edit') && p.includes('.taskflow') && p.endsWith('glossary.md') && sed.pending > 0) {
      sed.pending = 0;
      sed.seen.clear();
    }
    return undefined;
  });

  // T 技能加载埋点（v2.69.0）：read(skill://) 计数入全局单文件（TF_SKILL_USAGE 或 ~/.omp/agent/skill-usage.jsonl）。
  // 不受 guardOn 闸控——全局能力地图数据（项目外读取也要计数）；仅计数零内容（只记技能名与项目名）；
  // handler 整体吞错——omp hook fail-closed，抛错=阻断读取，埋点绝不能拦主流程。
  pi.on('tool_call', async (event, ctx) => {
    try {
      if (event?.toolName !== 'read') return undefined;
      const p = event.input?.path;
      if (typeof p !== 'string' || !p.startsWith('skill://')) return undefined;
      const skill = p.slice('skill://'.length).split('/')[0];
      if (!skill) return undefined;
      const file = process.env.TF_SKILL_USAGE || path.join(os.homedir(), '.omp', 'agent', 'skill-usage.jsonl');
      fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), skill, project: path.basename(ctx?.cwd ?? process.cwd()) }) + '\n');
    } catch { /* 埋点失败静默 */ }
    return undefined;
  });

  // J19 牵连排查 + J20 数据边界提醒（v2.72.0；v2.76.0 检索修正）：edit/write 触及普通源码文件时两检查（.taskflow/ 档案走
  // 上方 J 墙/G 门，本 handler 直接放行）。①J19：目标主名（去扩展名，.vue 例外）在仓内被代码文件命中数 ≥
  // TF_IMPACT_THRESHOLD（缺省 3，与 tf.mjs impact 共用）→ 提醒呈报带影响面清单（文档散文提及不计阈值、泛名不弹）；
  // ②J20：内容命中数据管道特征（edit 扫 new_string+old_string+盘上内容——管道特征常是这次编辑才进入文件的，旧实现读
  // 编辑前磁盘内容恰在引入时刻不弹；注释行剔除）→ 提醒枚举真空与失真形态。纯提醒不拦：TF_J19_WARN / TF_J20_WARN
  // 各自 off 关闭，缺省 warn、无 enforce 档——定位是「提醒必达」不是墙。同一调用两提醒合并一条 additionalContext（换行分隔）。
  // 性能纪律：检索走 git grep -w（tracked+未忽略；node_modules/.git 天然排除），内容只读首 500+尾 200 行做特征探测。
  // 挂 tool_call 末位：既有测试按 handlers['tool_call'] 下标定位 handler（0=bash/1=task/2=G 门/3=I 消账/4=T 埋点），追加不挪既有下标。
  pi.on('tool_call', async (event, ctx) => {
    try {
      if (!guardOn(ctx?.cwd)) return undefined;
      if (event.toolName !== 'edit' && event.toolName !== 'write') return undefined;
      const raw = event.input?.path;
      if (!raw || typeof raw !== 'string') return undefined;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(raw)) return undefined; // 协议地址（agent:// / xd:// 等）与 G 门同款过滤
      const dir = locateTasksDir(ctx?.cwd);
      if (!dir) return undefined; // 零干扰边界
      const rawN = (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) ? path.join(os.homedir(), raw.slice(1)) : raw;
      const abs = realPath(path.resolve(ctx?.cwd ?? process.cwd(), rawN)); // realpath 归一（symlink 环境路径基一致；不存在的新文件保最深存在祖先）
      // 文件自己的工作区为检索根（worktree 会话也算——主仓 .taskflow 定位采纳面，检索面跟文件走）
      let top = null;
      try { top = execFileSync('git', ['-C', path.dirname(abs), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* 目录尚未落盘等 */ }
      if (!top) { try { top = execFileSync('git', ['-C', ctx?.cwd ?? process.cwd(), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return undefined; } }
      const rel = path.relative(top, abs);
      if (!rel || rel.startsWith('..')) return undefined; // 仓库之外零干扰
      if (rel === '.taskflow' || rel.startsWith(`.taskflow${path.sep}`)) return undefined; // 档案归 J 墙/G 门管
      const warns = [];
      if (process.env.TF_J19_WARN !== 'off') {
        // v2.76.0（A2 审查 E1/D1）：检索串去扩展名取主名（.vue 例外——import 习惯带 .vue）+ -w 整词（api.ts 检索不再误中
        // myapi.ts 子串）+ 代码/文档分组（README/CHANGELOG/docs/*.md 散文提及不计阈值——散文充数曾把真仓 44% 前端
        // 文件顶过阈值）+ 泛名降档（index/utils/types/constants/api/config 等泛名引用语义不可辨，不弹防噪音疲劳）。
        const ext = path.extname(rel);
        const mainName = path.basename(rel, ext);
        const key = ext === '.vue' ? path.basename(rel) : mainName;
        if (!TF_GENERIC_BASENAMES.has(mainName.toLowerCase())) {
          const th = (() => { const v = parseInt(process.env.TF_IMPACT_THRESHOLD ?? '', 10); return Number.isFinite(v) && v >= 1 ? v : 3; })();
          // v2.77.1（R2 F2b，与 tf.mjs impact 同款）：检索限定同扩展名族——share.ts 检索串「share」曾以整词命中 Java
          // 注释/文案膨胀 40×；族外扩展名不设限 + 异扩展名命中过半附跨语言歧义注记（F2b②）
          const family = EXT_FAMILY[ext.toLowerCase()];
          const scopes = Array.isArray(family) ? family.map((e) => `*${e}`) : null;
          let files = [];
          try {
            files = execFileSync('git', ['-C', top, 'grep', '--untracked', '-I', '-l', '-F', '-w', '-e', key, '--', ...(scopes ?? ['.']), `:!${rel}`],
              { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).split('\n').filter(Boolean);
          } catch (e) { if (e?.status !== 1) files = null; } // 1=无匹配（正常空）；其余=检索失败按无清单处理（提醒不拦，宁缺勿噪）
          if (files !== null) {
            const codeFiles = files.filter((f) => !isDocPath(f));
            const codeN = codeFiles.length;
            if (codeN >= th) {
              let xl = '';
              if (family === undefined) {
                const foreign = codeFiles.filter((h) => path.extname(h).toLowerCase() !== ext.toLowerCase());
                if (foreign.length * 2 > codeN) xl = `；命中跨语言形态，basename 泛用词风险高（异扩展名 ${foreign.length}/${codeN}）——import/引用路径逐条核对`;
              }
              warns.push(`TASKFLOW_GUARD J19 牵连排查提醒：${rel} 字符串命中 ${codeN} 个代码文件（grep 级，含注释/文案，非引用语义）${xl}——改动呈报须含影响面清单（可跑 node tf.mjs impact --files ${rel}）；分析由 impact-analysis 技能引导（引用形态清单+检索序列）`);
            }
          }
        }
      }
      if (process.env.TF_J20_WARN !== 'off') {
        let text = null;
        if (event.toolName === 'write' && typeof event.input?.content === 'string') text = event.input.content; // 未落盘新文件也有探测面
        else if (event.toolName === 'edit') {
          // v2.76.0 D3①：扫本次编辑增量（new_string+old_string）拼盘上内容——管道特征常是「这次编辑」才进入文件，
          // 旧实现读编辑前磁盘内容，恰在引入时刻不弹（最该弹的那次不弹，A2 实测四连漏报之首）
          const parts = [];
          if (typeof event.input?.new_string === 'string') parts.push(event.input.new_string);
          if (typeof event.input?.old_string === 'string') parts.push(event.input.old_string);
          try { parts.push(fs.readFileSync(abs, 'utf8')); } catch { /* 新文件落盘前 */ }
          if (parts.length) text = parts.join('\n');
        } else { try { text = fs.readFileSync(abs, 'utf8'); } catch { text = null; } }
        if (text != null) {
          const j20 = j20Scan(text);
          if (j20.hit) { // 词特征任一命中；代码特征 ≥2 个不同算子（单 sort(/count( 全仓皆是无害噪音）
            warns.push(`TASKFLOW_GUARD J20 数据边界提醒：${rel} 疑涉数据管道（命中特征：${j20.detail}）——枚举真空与失真形态（空集/单条/首期无参照/异常值/口径变更/范围串扰），禁算了不传/传空容器/硬凑对比；分析由 data-boundary 技能引导（五维度检查清单+三禁）`);
          }
        }
      }
      if (!warns.length) return undefined;
      return { additionalContext: warns.map((w) => `⚠ ${w}`).join('\n') };
    } catch { return undefined; } // 提醒失败静默——hook fail-closed，绝不拦主流程
  });

  // H 同类排查提醒（v2.49.1 事件面重设计；v2.61.0 触发源收紧为子代理报告）：子代理报告不走 tool_result——活体实证
  // tool_result(task) 的 content 只是 spawn 回执（「Spawned agent…」），报告以 task-result 消息进入后续 context 链。
  // 挂 context：尾部消息中「含 task-result 标签且命中特征词」→ 追加一条三问提醒消息（幂等；非 taskflow 静默）。
  // v2.61.0 修复高频误触发：旧判定扫尾部全部消息文本——编排模型自述（「无 blockers」）/工具图例（⛔/⚠ 行）/
  // H 自家提醒文本都含特征词，逐轮自我喂养（两会话连续 8~10 轮实证）。现限定真实子代理报告的信封标签
  // （<task-result id=…> 带属性与 <task-result> 无属性形态都认，不判 role——自动投递/链内嵌两路径都稳健），
  // 普通对话/图例/自家提醒永不再武装；报告内否定语境（如「无 blockers」）仍会提醒=已知边界。
  pi.on('context', async (event, ctx) => {
    if (!guardOn(ctx?.cwd)) return undefined; // v2.54.0 采纳面自检
    const msgs = Array.isArray(event?.messages) ? event.messages : null;
    if (!msgs || !msgs.length) return undefined;
    const textOf = (m) => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join(' ') : '');
    const tail = msgs.slice(-3);
    const BLOCKER_RE = /block(?:er|ing|ed)s?|阻塞|卡点|卡住/i; // 变体容忍（v2.61.1 补 blocked/卡住：「I am blocked by…」「卡住了」此前零检出）；报告内否定语境误提醒=已知边界（记 taskflow-guard.md）
    const hit = tail.some((m) => { const t = textOf(m); return /<task-result[\s>]/i.test(t) && BLOCKER_RE.test(t); }); // v2.61.0 来源限定：只武装子代理报告
    if (!hit) return undefined;
    if (tail.some((m) => textOf(m).includes('TASKFLOW_GUARD H：'))) return undefined; // 幂等：本轮已提醒
    const dir = locateTasksDir(ctx?.cwd);
    if (!dir) return undefined; // 零干扰边界：非 taskflow 项目不提醒
    return { messages: [...msgs, { role: 'user', content: '⚠ TASKFLOW_GUARD H：这是第 H 号提醒（taskflow 装在 omp 里的自动检查脚本发的），可能猜错，不拦任何操作——子代理报告里出现了「阻塞 / blocker / 卡点」字样，猜测你可能在处理一个被卡住的问题。如果确实要修 bug，动手前先答三个问题（同类排查，CLASS_SWEEP_GATE：修一处之前先查清影响范围的规矩）：① 上游——坏结果的输入/前提从哪来，源头干净吗；② 下游——修好的东西被谁在用，要不要同步改；③ 同类——同样的写法还有几处（用 grep：按关键词在代码里搜索的工具——搜同模式），多处就逐处修或逐处注记。排查结论记到任务记录本（findings：.taskflow/<任务id>/findings.md），修复代码要附这份清单。如果报告说的其实是「无阻塞」、或只是在讨论「阻塞」这个词本身，忽略本条。\n受影响面定位可跑 tf.mjs impact 或挂 impact-analysis 技能。' }] };
  });
  // I 词表反馈沉淀检测（v2.57.0）：context 每轮重放全量消息——只数 user 角色强信号（含 TASKFLOW_GUARD 的自家注入不数）；
  // 字符串 Set 去重防重放重复计数；检测只计数不追加消息（提醒走 E 通道，避免双通道噪音）
  pi.on('context', async (event, ctx) => {
    if (!guardOn(ctx?.cwd)) return undefined;
    const msgs = Array.isArray(event?.messages) ? event.messages : null;
    if (!msgs || !msgs.length) return undefined;
    for (const m of msgs) {
      if (m?.role !== 'user') continue;
      const text = typeof m?.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join(' ') : '';
      if (!text || text.includes('TASKFLOW_GUARD') || !FEEDBACK_SIG.test(text)) continue;
      if (sed.seen.has(text)) continue;
      sed.seen.add(text);
      sed.pending += 1;
    }
    return undefined;
  });

  pi.on('before_provider_request', async (event, ctx) => {
    if (!guardOn(ctx?.cwd)) return undefined; // v2.54.0 采纳面自检（E 输出规范同受采纳面约束——文档 20 行口径 v2.54.0 同步）
    let inject = buildInject(ctx?.cwd);
    if (!inject) return undefined;
    if (sed.pending > 0) inject += `\n[词表反馈沉淀（TASKFLOW_GUARD I——检测到你看不懂的反馈、词表还没更新）] 本会话已检测到 ${sed.pending} 条「看不懂」类反馈、项目词表尚未改写——把涉事术语的大白话改写/补录进 .taskflow/glossary.md（改完下一轮生效；这可能猜错，不拦任何操作）。`;
    const p = event.payload;
    if (typeof p?.system === 'string') p.system = `${inject}\n\n${p.system}`;
    else if (Array.isArray(p?.system)) p.system = [{ type: 'text', text: inject }, ...p.system];
    else if (p && typeof p === 'object') p.system = inject;
    return p; // 完整替换 payload 返回（handlers chain；注入内容确定性=cache warming 的 byte-identical 保持）
  });
}
