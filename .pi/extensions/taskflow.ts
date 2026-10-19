// taskflow.ts — taskflow 的 pi 宿主适配器（源模板住技能仓 .pi/extensions/，与 assets/guard/taskflow-guard.js 同源分宿主）
// 架构参照 obra/superpowers 的 .pi/extensions/superpowers.ts：一套技能内核，每宿主一个薄适配文件。
// 装配：用户级 `ln -sf <技能仓>/.pi/extensions/taskflow.ts ~/.pi/agent/extensions/taskflow.ts`
//       （或项目级放 <项目>/.pi/extensions/）；技能本体发现走既有路径（~/.pi/agent/skills 软链到技能仓根）。
//
// v2.63.0 范围（与 omp 版 assets/guard/taskflow-guard.js 逐条对照）：
//   【映射注入】宿主映射表——技能文件里的 omp 工具字样（omp Todo/task 子代理/@taskflow/--session）→ pi 等价物；
//     经 before_provider_request 前缀进 system，每请求静态注入（byte-identical 不破 prompt cache）。
//     通道实证：pi -p/print 模式下 context 事件的 messages 变更不生效（handler 触发、返回值被忽略，
//     2026-10-15 e2e），provider 层全模式必经。omp 版无此件（omp 是技能的原生宿主，无需翻译）。
//   【C 接力】压缩后把活任务接力线索附进注入块（一次性消费）。omp 版挂 session.compacting 返回 {context}；pi 的
//     SessionBeforeCompactResult 无 context 注入口（types.d.ts:1137 只有 cancel/compaction）→
//     改走 session_compact 置位、随下一请求的 system 注入块附加（一次性消费）。
//   【D 状态栏】活任务/等你验收/敞口——1:1 移植；ctx.ui.setStatus(key, text) 同名；任务清零时显式清除
//     （pi 文档明确 undefined=clear，omp 版不清是已知小尾巴，此处顺手收口）。
//   【B1 硬拦】tf.mjs commit --files 空格分隔多文件 → block。1:1 移植。
//   【A 部署墙】DEPLOY_SIG 分段判定 + tf.mjs deploy 入口放行 + TF_WALL 三档。判定 1:1 移植。
//   【G 编辑边界门】edit/write 路径对照声明清单（worktree 归属/兄弟 worktree/并集比对/簿记白名单）+
//     TF_BOUND 三档。判定 1:1 移植，白名单增 `.pi/`（pi 宿主簿记/扩展目录，对齐 omp 版的 `.omp/`）。
// 与 omp 版的明确差异（全部有据，升级 omp 版时同步对照）：
//   1. 警告档降级：pi 的 tool_call 结果只有 block/reason/terminate（无 additionalContext，
//      pi types.d.ts ToolCallEventResult）——A/G 的默认警告档在 pi 下实现为「拦截 + reason 尾附
//      TF_WALL=off / TF_BOUND=off 重试指引」：比 omp 警告档多一次重试往返，语义更保守不更松；
//      off/enforce 两档与 omp 完全一致。
//   2. 未移植（留后续版本）：B2 web-only 提醒（依赖 additionalContext）、E 输出规范注入、F 派发门
//      （依赖 pi-subagents 实际工具名锚定，需单独验证）、H 报告提醒（依赖 omp task-result 信封形态）、
//      I 词表反馈沉淀。
//   3. 采纳闸：同 project.json.mechanisms.TASKFLOW_GUARD——B/A/G/D 与 omp 版共用同一登记，双宿主一闸；
//      映射注入与 C 接力不受闸控（不是强制力，是技能可读性，零干扰边界=项目内有 .taskflow）。
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const MAPPING_MARKER = "taskflow:pi-host-mapping";

// ---- 通用定位（1:1 移植自 assets/guard/taskflow-guard.js）----
function locateTasksDir(cwd) {
  try {
    const common = execFileSync('git', ['-C', cwd ?? process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const dir = path.join(path.dirname(common), '.taskflow');
    if (fs.existsSync(dir)) return dir;
  } catch { /* 非 git 目录 */ }
  return null;
}

function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

// 路径基归一：git rev-parse 返回真实路径，path.resolve 保留符号链接——两端基不一致时比对恒错（omp 版 v2.49.1 实证）
const realPath = (p) => { let cur = p; const suffix = []; for (;;) { try { return path.join(fs.realpathSync(cur), ...suffix); } catch { /* 该层不存在，上爬 */ } suffix.unshift(path.basename(cur)); const parent = path.dirname(cur); if (parent === cur) return p; cur = parent; } };

// 采纳闸：mechanisms.TASKFLOW_GUARD 登记（双宿主一闸；卸载=删文件或清登记皆可）
function guardOn(cwd) {
  try {
    const d = locateTasksDir(cwd);
    if (!d) return false;
    const j = JSON.parse(fs.readFileSync(path.join(d, 'project.json'), 'utf8'));
    return !!j?.mechanisms?.TASKFLOW_GUARD;
  } catch { return false; }
}

// ---- D：状态栏（1:1 移植；任务清零时显式清除）----
function statusLine(tasksDir) {
  const idx = readJsonSafe(path.join(tasksDir, 'index.json'))?.tasks ?? [];
  const active = idx.filter((t) => t?.status === 'active').length;
  const verifying = idx.filter((t) => t?.status === 'verifying');
  if (!active && !verifying.length) return '';
  let s = `tf:进行中${active}`;
  if (verifying.length) {
    let exposure = 0;
    for (const t of verifying) {
      const tj = readJsonSafe(path.join(tasksDir, t.id, 'task.json'));
      const at = tj?.deploy?.deployedAt;
      if (at && Date.now() - Date.parse(at) > 86400000) exposure++; // I16 口径：已部署未合并超 24h
    }
    s += ` 等你验收${verifying.length}${exposure ? ` ⚠${exposure}个已上线超24小时未合并` : ''}`;
  }
  return s;
}

function refreshStatus(ctx) {
  const dir = locateTasksDir(ctx?.cwd);
  if (!dir) return;
  const s = statusLine(dir);
  ctx.ui?.setStatus?.('tf', s || undefined); // pi：undefined=清除（空态不留陈旧残影）
}

// ---- B1：--files 空格分隔检测（1:1 移植）----
function spaceSeparatedFiles(cmd) {
  const at = cmd.indexOf('--files');
  if (at === -1) return false;
  const toks = cmd.slice(at + '--files'.length).trim().split(/\s+/);
  const files = [];
  for (const t of toks) { if (t.startsWith('-')) break; files.push(t); }
  return files.length > 1;
}

// ---- A：部署特征（1:1 移植）----
const DEPLOY_SIG = /\brsync\b[^\n|;&]*(\/opt\/|\.jar\b|\/web\/)|\bscp\b[^\n|;&]*(\/opt\/|\.jar\b|\/web\/)|\bssh\b[^\n|;&]*systemctl[^\n|;&]*(restart|stop|reload)/;

function bashGate(event, ctx) {
  const cmd = String(event.input?.command ?? '');
  if (!cmd) return undefined;
  // A 部署墙：分段判定+入口形态锚定（omp 版 v2.52.0 对抗审查语义，原样移植）
  const segs = cmd.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter(Boolean);
  const entryCall = (s) => /(^|[\/\s;&])tf\.mjs\s+deploy\b/.test(s);
  const badSeg = segs.find((s) => DEPLOY_SIG.test(s) && !entryCall(s));
  if (badSeg) {
    const mode = process.env.TF_WALL;
    if (mode === 'off') return undefined;
    const why = '这条命令像是在绕过统一部署入口直接部署（往服务器拷文件 / 重启服务）。TASKFLOW_GUARD 部署墙（pi 适配器，判定逻辑同 omp 版）提醒：本项目所有部署必须走唯一入口「node tf.mjs deploy」（DEPLOY_ENTRY：统一部署入口）。入口会自动做三件事——部署前预检（防止把别人刚上线的版本盖掉）、检查有没有任务正在线上等验收（有就先让位不部署）、把这次部署登记进档案。绕过入口直接部署 = 档案里缺这笔账，之后跑对账检查（doctor I17：把部署记录和服务器上的实际文件逐项比对）一定亮红灯。若确属人工回滚或特殊运维：与用户确认后，在命令前加 TF_WALL=off（表示本次跳过部署拦截）执行，并在 progress.md（任务进度文件）里记一行原因。';
    return mode === 'enforce'
      ? { block: true, reason: why }
      : { block: true, reason: `${why}\n（pi 适配器警告档说明：pi 的工具拦截结果没有「放行但附警告」通道，默认档以拦截+本指引代替 omp 版的警告放行——确要执行就按上面加 TF_WALL=off 重跑同一条命令。）` };
  }
  if (cmd.includes('tf.mjs')) {
    // B1 --files 空格分隔 = 调用即红（无警告档，双宿主一致）
    if (spaceSeparatedFiles(cmd)) {
      return { block: true, reason: '命令已拦下，格式错了：tf.mjs commit --files 的多个文件要用逗号分隔（正确写法：--files a.md,b.md），用空格分隔时只有第一个文件会被登记进档案（历史上多次踩过这个坑）。把空格改成逗号后重试。' };
    }
    // B2（deploy 缺 --web-only 提醒）未移植：pi 无 additionalContext 通道——见文件头差异说明 2。
  }
  return undefined;
}

// ---- G：编辑边界门（声明清单收集，1:1 移植）----
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

// v2.55.2 花括号展开：spec 清单常写 `docs/prd/{a,b,c}/functional.md` 缩写——不展开=清单内文件全误报（21 次误报实证）
const expandBraces = (p) => {
  const m = p.match(/^(.*?)\{([^{}]*)\}(.*)$/s);
  if (!m) return [p];
  return m[2].split(',').flatMap((alt) => expandBraces(m[1] + alt.trim() + m[3]));
};

function collectDeclaredFiles(taskDir) {
  const out = new Set();
  const addFromSection = (md, secRe) => {
    for (const lnRaw of extractSectionBody(md, secRe).split('\n')) {
      if (/明确不做|禁止|不含|不涉及|负面/.test(lnRaw)) continue; // 负面清单行排除（入清单=放行禁改文件）
      for (const ln of expandBraces(lnRaw)) {
        const m = ln.match(/^\s*[-*]\s+`?([^\s`（(，,：:]+)/);
        if (m) {
          const p = m[1].replace(/^\.\//, '').replace(/\/+$/, '');
          // bold 标签（**xxx**）= 模板小节标签非路径（v2.49.1 活体实证）
          if (p && !p.startsWith('<') && !/^\*\*.*\*\*$/.test(p)) out.add(p);
        }
        // 冒号后反引号路径（治截断）——仅声明语义行收集，禁止/负面清单行不入清单
        if (/改动文件|涉及文件|正向清单|文件集合|声明/.test(ln)) {
          for (const q of ln.matchAll(/`([^`\s]+)`/g)) {
            const p = q[1].replace(/^\.\//, '').replace(/\/+$/, '');
            if (p.includes('/') || /\.[A-Za-z0-9]+$/.test(p)) out.add(p);
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

function editGate(event, ctx) {
  const raw = event.input?.path;
  if (!raw || typeof raw !== 'string') return undefined;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(raw)) return undefined; // 协议地址过滤（agent:// 等非文件系统路径；≥2 字符不误伤 Windows 单字母盘符）
  const rawN = (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) ? path.join(os.homedir(), raw.slice(1)) : raw; // 波浪号展开：与编辑工具展开时机对齐（v2.54.1 实证）
  const cwd = ctx?.cwd;
  const dir = locateTasksDir(cwd);
  if (!dir) return undefined; // 零干扰边界
  const mainRoot = realPath(path.dirname(dir));
  const abs = realPath(path.resolve(cwd ?? process.cwd(), rawN)); // realpath 失败（新文件不存在）保 resolve 原值
  const idx = readJsonSafe(path.join(dir, 'index.json'))?.tasks ?? [];
  const live = idx.filter((t) => t?.status === 'active' || t?.status === 'verifying');
  if (!live.length) return undefined;
  // 归属判定：worktree 前缀（含兄弟子任务 worktree 命名 <task-worktree>-<n>-<slug>）；主仓库内编辑且仅一个活任务 → 归它
  let owner = null; let base = null;
  for (const t of live) {
    // 幽灵 worktree 防御（v2.61.1 F-01）：空/缺失跳过，绝不让空串进 realPath
    const rawW = typeof t.worktree === 'string' && t.worktree ? t.worktree : readJsonSafe(path.join(dir, t.id, 'task.json'))?.worktree;
    if (typeof rawW !== 'string' || !rawW) continue;
    const w = realPath(rawW); // 双向路径归一（realPath 失败保原值=worktree 已删场景）
    if (abs === w || abs.startsWith(w + path.sep)) { owner = t; base = w; break; }
    // 兄弟子任务 worktree：base 取子 worktree 根；数字段收紧防 `-backup` 类同名误归因（审查 blocker 1）
    const sib = abs.startsWith(w + '-') ? abs.slice(w.length + 1) : '';
    if (sib && /^\d+-/.test(sib)) {
      const cut = abs.indexOf(path.sep, w.length + 1);
      owner = t; base = cut === -1 ? abs : abs.slice(0, cut);
      break;
    }
  }
  const boundNote = (door) => `\n（pi 适配器警告档说明：pi 的工具拦截结果没有「放行但附警告」通道，默认档以拦截+本指引代替 omp 版的警告放行——确要执行就加 ${door}=off 后重试同一条编辑。）`;
  if (!owner) {
    if (abs !== mainRoot && !abs.startsWith(mainRoot + path.sep)) return undefined; // 主仓库与任何 worktree 之外 → 零干扰
    // 多活任务 × 主仓库编辑：并集比对（v2.49.1 活体实证修订——归属不明放行会让主路径永久静默）
    const union = new Set();
    for (const t of live) for (const p of collectDeclaredFiles(path.join(dir, t.id))) union.add(p);
    if (!union.size) return undefined; // 全部活任务都无清单 → 零干扰
    const relU = path.relative(mainRoot, abs);
    if (!relU || relU.startsWith('..')) return undefined;
    if (relU === '.taskflow' || relU.startsWith('.taskflow/') || relU.startsWith('.omp/') || relU.startsWith('.pi/') || path.basename(relU) === '.owner.json') return undefined; // 簿记白名单（.pi/=pi 宿主簿记目录）
    if ([...union].some((d) => relU === d || relU.startsWith(d.endsWith('/') ? d : d + '/'))) return undefined;
    const whyU = `TASKFLOW_GUARD G 编辑边界门（自动检查脚本的编辑范围检查）警告：${relU} 不在任何进行中任务（${live.map((t) => t.id).join('、')}）声明的改动清单里（各任务清单 = 任务说明书 spec 的「边界与影响面」+ 各子任务「涉及文件」的合计）。主仓库检出区应保持干净、只作合并落点——任务都在各自的 worktree（独立工作副本）里改代码。请先确定这个文件归属哪个任务：到对应 worktree 里开工，或把路径加进该任务 spec 清单并跑 node tf.mjs req-confirm（范围变更登记命令）留痕。确属例外情况：与用户确认后在命令前加 TF_BOUND=off（表示本次跳过边界检查）执行，并在 progress.md（任务进度文件）里记一行原因。`;
    const modeU = process.env.TF_BOUND;
    if (modeU === 'off') return undefined;
    return modeU === 'enforce' ? { block: true, reason: whyU } : { block: true, reason: whyU + boundNote('TF_BOUND') };
  }
  const rel = path.relative(base, abs);
  if (!rel || rel.startsWith('..')) return undefined;
  if (rel === '.taskflow' || rel.startsWith('.taskflow/') || rel.startsWith('.omp/') || rel.startsWith('.pi/') || path.basename(rel) === '.owner.json') return undefined; // 簿记白名单
  const declared = collectDeclaredFiles(path.join(dir, owner.id));
  if (!declared.length) return undefined; // 无清单可对照（未落 spec 的旧任务）→ 零干扰
  const hit = declared.some((d) => rel === d || rel.startsWith(d.endsWith('/') ? d : d + '/'));
  if (hit) return undefined;
  const why = `TASKFLOW_GUARD G 编辑边界门（自动检查脚本的编辑范围检查）警告：${rel} 不在任务 ${owner.id} 开工时声明的改动清单里（清单 = 任务说明书 spec 的「边界与影响面」一节 + 各子任务「涉及文件」的合计）——这条纪律是为了让一个任务只做一件事、出问题好回滚。确实需要改这个文件：先把它的路径加进 spec 对应清单，再跑 node tf.mjs req-confirm（范围变更登记命令）登记这次范围变更，然后继续。确属例外情况：与用户确认后在命令前加 TF_BOUND=off（表示本次跳过边界检查）执行，并在 progress.md（任务进度文件）里记一行原因。`;
  const mode = process.env.TF_BOUND;
  if (mode === 'off') return undefined;
  return mode === 'enforce' ? { block: true, reason: why } : { block: true, reason: why + boundNote('TF_BOUND') };
}

// ---- 映射注入 + C 接力（omp 版无对应件；pi 技能可读性层，不受采纳闸控）----
const MAPPING_TEXT = [
    '[taskflow 宿主映射表（pi 适配器注入，marker: ' + MAPPING_MARKER + '）]',
    '本会话可用 taskflow 技能。技能文件按 omp 宿主撰写，遇到以下字样按本表翻译成 pi 等价物：',
    '- 「omp Todo」「init 成 omp Todo」「挂 Todo」→ 用 pi 的 todo 工具（rpiv-todo）登记；todo 工具不可用就逐项写进任务 progress.md。Todo 勾选永远不是状态写入口，账本以 tf.mjs 为准',
    '- 「用 subagent 能力（实现用 general、调研用 explore）」→ 用 pi-subagents 扩展的 subagent 工具；不可用就在本会话顺序自做并在进度里注明，禁止发明不存在的工具调用',
    '- 「会话开头 @taskflow」→ 直接说「用 taskflow …」即可（pi 按技能描述自动触发，无需 @ 语法）',
    '- 「宿主提醒 TASKFLOW_GUARD」→ 本机装了 pi 适配器时 B/A/G 拦截与 D 状态栏照常生效；未装适配器的项目按 references 流程门与 validate-* 脚本自觉执行',
    '- tf.mjs 写命令（commit/takeover/lock）的 --session <会话ID> → 传环境变量 PI_SESSION_ID 的值（pi 的会话标识）',
].join('\n');

function handoffText(tasksDir) {
  const live = (readJsonSafe(path.join(tasksDir, 'index.json'))?.tasks ?? [])
    .filter((t) => t?.status === 'active' || t?.status === 'verifying');
  if (!live.length) return null;
  return [
    '[taskflow 接力线索（TASKFLOW_GUARD C，压缩后重注入）]',
    ...live.slice(0, 5).map((t) => `- 任务 ${t.id}（${t.status}）：${t.title ?? ''}｜分支 ${t.branch ?? '?'}`),
    '恢复入口：直接 node tf.mjs ls；下一步与未决风险以各任务 handoff.md 为准（摘要不准替代档案）',
  ].join('\n');
}

export default function taskflowPi(pi) {
  let armHandoff = false; // 压缩完成后置位；下一次 provider 请求附带接力线索（一次性消费）

  pi.on('session_start', async (_e, ctx) => {
    if (guardOn(ctx?.cwd)) refreshStatus(ctx);
  });

  // C 接力：压缩完成置位 → 下一次 provider 请求把活任务线索附进注入块（一次性消费）
  pi.on('session_compact', async (_e, ctx) => {
    armHandoff = true;
    if (guardOn(ctx?.cwd)) refreshStatus(ctx);
  });

  pi.on('turn_end', async (_e, ctx) => { if (guardOn(ctx?.cwd)) refreshStatus(ctx); });

  // 映射注入走 provider 层（before_provider_request 前置进 messages 首条 system）：print 模式实测 context 事件
  // 的 messages 变更不生效（handler 触发、返回值被忽略，2026-10-15 e2e）；且 pi 的 provider payload 没有
  // payload.system 字段（OpenAI 风格，system 在 messages[0]，e2e 日志实证）——注入点=messages[0].content 前缀。
  // MAPPING_TEXT 静态 → 每请求 byte-identical，prompt cache 不破；handoff 只在压缩后附加一次（允许破一次缓存）。
  pi.on('before_provider_request', async (event, ctx) => {
    const dir = locateTasksDir(ctx?.cwd);
    if (!dir) return undefined; // 零干扰边界：非 taskflow 项目不注入
    let inject = MAPPING_TEXT;
    if (armHandoff) {
      const handoff = handoffText(dir);
      if (handoff) inject += `\n\n${handoff}`;
      armHandoff = false; // 一次性消费（无活任务时保留武装，建档后下一请求补上）
    }
    const p = event.payload;
    const msgs = Array.isArray(p?.messages) ? p.messages : null;
    if (!msgs) return undefined;
    const m0 = msgs[0];
    if (m0?.role === 'system') {
      if (typeof m0.content === 'string') m0.content = `${inject}\n\n${m0.content}`;
      else if (Array.isArray(m0.content)) m0.content = [{ type: 'text', text: inject }, ...m0.content];
      // 其余 content 形态不识别 → 不动（零干扰）
    } else {
      msgs.unshift({ role: 'system', content: inject }); // 无 system 首条 → 前插一条
    }
    return p; // 原地变更+返回 payload（handlers chain；omp 版 E 通道同式）
  });

  // B1 / A（bash）与 G（edit/write）共用一个 tool_call 挂点，按 toolName 分流
  pi.on('tool_call', async (event, ctx) => {
    if (!guardOn(ctx?.cwd)) return undefined; // 采纳闸：未登记项目八功能全静默（含本适配器的 B/A/G/D）
    if (event.toolName === 'bash') return bashGate(event, ctx);
    if (event.toolName === 'edit' || event.toolName === 'write') return editGate(event, ctx);
    return undefined;
  });
}
