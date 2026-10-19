#!/usr/bin/env node
// deploy-preflight.mjs — 部署预检 + 线上基线登记（DEPLOY_GATE 机制产物；细则 references/deploy-gate.md）
// 背景：2026-09-29 单日四起部署覆盖事故（治理静默滚回/签名册互相覆盖/版本撞号/假部署）——
//       多会话各自从自己分支构建部署同一台服务器，谁后上谁生效，git 不可见。本脚本把「线上是什么」
//       变成机器登记（live-state 基线），把「并集优先」从救火动作变成部署前强制步骤。
// 加固（2.40.0，对抗性审查四缺口）：⓪ 实况核验——预检实测服务器 jar md5 与基线比对，不符=红
//       （未登记的部署必然改变实际 jar 的 md5 → 下次预检必红）；--record --web-only 沿用基线 jar
//       （消「web-only 收尾手抄 jar 四件套」污染面）；verifying 让位机械化（验收中任务分支不在部署
//       分支血统=红）；.taskflow 定位走 git-common-dir（worktree 内跑不再静默跳过）。
//
// 用法：
//  预检(部署前必跑)：  node scripts/harness/deploy-preflight.mjs --branch <部署分支> [--web-only]
//                      [--server <host>] [--state-path <远程路径>] [--state-file <本地文件>]
//                      [--proc-probe <进程/容器探针命令>] [--jar-probe <jar实物md5探针命令>]
//  登记(部署收尾必跑)： node scripts/harness/deploy-preflight.mjs --record --branch B --commit C \
//                       --jar-md5 M --version V [--task T] [--by S] [--rollback R] \
//                       [--jar-path <服务器jar路径>] [--web-version W] [--web-fp F] [--state-file <本地文件>]
//  web-only 登记：      node scripts/harness/deploy-preflight.mjs --record --web-only --web-version W \
//                       [--web-fp F]（jar 沿用基线，须已有基线；首次登记仍走全量四件套）
//
// 预检查：⓪ 实况核验 live.jar.md5 == 实际 jar md5（jar.path 随模式取义：ssh=服务器路径 /
//         --state-file=本地路径；不符=红；ssh 读不到=红；--state-file 读不到=信息级跳过）
//         ① 血统门 live.jar.commit ⊆ --branch（红=并集优先：先 merge 线上任务分支再构建，拒绝直接上；
//         --web-only 跳过——jar 不动，web 血统由构建后签名门保证）
//         ② verifying 让位（机械化：验收中任务的分支存在且不在部署分支血统=红——部署将滚回其已上线
//         代码；分支引用缺失/无分支记录=信息级，已合并删除的分支不误拦）
//         ③ 进程/容器清点+新鲜度（opt-in：配置 --proc-probe 探针命令才启用，project.json deploy.procProbe
//         经 tf.mjs deploy 自动透传；无配置=信息级跳过——探针命令属项目侧事实，不进模板；
//         --state-file 替身模式+--proc-probe 并存照跑=夹具注入（硬规则 17））
//         ④ 构建源凭证在位（credgate，历史空包事故实证后上游化）：清单
//         deploy/frontend-credentials.json（CWD 相对）逐键断言 envPath（缺省 frontend/.env）内在位非空——
//         缺/空=红（构建将内联空串）；清单不在=信息级跳过（禁静默降级，跳过必须显式可见）
// 退出：0=过 / 1=红。状态文件 schema：live-deploy-state/1（jar.path 为 2.40.0 增量可选字段）。
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const has = (k) => args.includes('--' + k);
const SERVER = opt('server');
const STATE_PATH = opt('state-path') || '/opt/<app>/live-state.json';
const STATE_FILE = opt('state-file');
if (!SERVER && !STATE_FILE) {
  console.error('✗ 缺 --server <host>——目标服务器必填（按项目显式配置，本脚本不带默认主机；本地测试/CI 可用 --state-file 直读文件免 ssh）');
  process.exit(1);
}

const sh = (cmd, o = {}) => execFileSync('bash', ['-lc', cmd], { encoding: 'utf8', ...o });

function readLive() {
  if (STATE_FILE) return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  return JSON.parse(sh(`ssh ${SERVER} 'cat ${STATE_PATH}'`));
}
function writeLive(obj) {
  const body = JSON.stringify(obj, null, 2) + '\n';
  if (STATE_FILE) {
    writeFileSync(STATE_FILE, body);
    return;
  }
  // v2.52.0：ssh 写失败必须红——旧版丢弃 spawnSync 返回值，失败仍打「✓ 已登记」（对抗审查实锤：门自身长了它要治的「声称已做服务器无痕」同型病）
  const r = spawnSync('ssh', [SERVER, 'cat > ' + STATE_PATH], { input: body, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.error(`✗ live-state 写入失败（ssh ${r.error ? r.error.message : `exit ${r.status}`}）——登记未完成，排查 ssh/网络后重跑 --record（此时不能当已登记收口）`);
    process.exit(1);
  }
}

if (has('record')) {
  let prev = null;
  try { prev = readLive(); } catch { /* 首次登记无基线 */ }
  if (has('web-only')) {
    // web-only 部署收尾：jar 沿用基线（登记对称，消手抄污染——web 血统由签名册，jar 基线不许手抄）
    if (!prev?.jar?.commit) {
      console.error('✗ --record --web-only：无既有基线可沿用 jar——首次登记须全量 --record --branch --commit --jar-md5 --version');
      process.exit(1);
    }
    if (!opt('web-version')) {
      console.error('--record --web-only 缺 --web-version');
      process.exit(1);
    }
    writeLive({
      schema: 'live-deploy-state/1',
      updatedAt: new Date().toISOString(),
      by: opt('by') || 'unknown',
      jar: prev.jar,
      web: {
        version: opt('web-version'),
        entryFingerprint: opt('web-fp') || prev.web?.entryFingerprint || '',
        note: `web-only 部署（jar 沿用基线 ${prev.jar.version}）`
      },
      env: prev.env ?? {}
    });
    console.log(`✓ live-state 已登记(web-only): web ${opt('web-version')}（jar 沿用基线 ${prev.jar.version} @ ${prev.jar.commit}）`);
    process.exit(0);
  }
  const missing = ['branch', 'commit', 'jar-md5', 'version'].filter((k) => !opt(k));
  if (missing.length) {
    console.error('--record 缺参数: --' + missing.join(' --'));
    process.exit(1);
  }
  writeLive({
    schema: 'live-deploy-state/1',
    updatedAt: new Date().toISOString(),
    by: opt('by') || 'unknown',
    jar: {
      version: opt('version'),
      md5: opt('jar-md5'),
      branch: opt('branch'),
      commit: opt('commit'),
      task: opt('task') || '',
      rollbackPoint: opt('rollback') || '',
      path: opt('jar-path') || prev?.jar?.path || ''
    },
    web: {
      version: opt('web-version') || (prev?.web?.version ?? ''),
      entryFingerprint: opt('web-fp') || (prev?.web?.entryFingerprint ?? ''),
      note: opt('web-version') ? '本次部署更新 web' : '本次 jar-only 未动 web(沿用基线)'
    },
    env: prev?.env ?? {}
  });
  console.log(`✓ live-state 已登记: ${opt('version')} @ ${opt('commit')}(${opt('branch')})`);
  process.exit(0);
}

// ---- 预检 ----
const problems = [];
const branch = opt('branch');
if (!branch) {
  console.error('缺 --branch <部署分支>');
  process.exit(1);
}

let live;
try {
  live = readLive();
} catch {
  console.error(`✗ 无法读取 live-state 基线(${STATE_FILE || `${SERVER}:${STATE_PATH}`})——基线未采集或不可达。首次使用先人工核实线上实况，再以 --record 补基线；不许为绿灯编造基线`);
  process.exit(1);
}

// ⓪ 实况核验（2.40.0）：基线登记的 md5 与实际 jar md5 比对——不符=红。
//    未登记的部署必然改变实际 jar 的 md5 → 下次预检必红（治「B 部署不登记、C 含旧基线照常绿、B 被静默滚回」）。
//    jar.path 语义随模式：jarProbe 模式=注释性声明（实物以探针为准）/ ssh 模式=服务器路径 / --state-file 模式=本地路径（测试替身）。
//    jarProbe（v2.64.0，历史部署实证上游化）：配置 compose 容器内实物探针命令
//    （自带 ssh 前缀，如 `ssh <host> 'docker exec <app> sh -c "md5sum /opt/app/app.jar"'`）——以运行侧实物为
//    内容判据（用户拍板「看 jar 包实物而非登记/任务时间」）；治愈 jarPath 指向宿主机死文件时 record/I17
//    对账恒错位（compose 形态 systemd 遗留路径）。探针输出取首列 32 位 hex；非 hex=红（探针命令写错防呆）。
if (!live.jar?.path || !live.jar?.md5) {
  console.log('ℹ 实况核验: 基线未登记 jar.path/md5——跳过（--record 补 --jar-path <服务器jar路径> 后启用；未启用时未登记部署不可探测）');
} else {
  const JAR_PROBE = opt('jar-probe');
  let actual = null;
  if (JAR_PROBE) {
    try { actual = sh(JAR_PROBE).trim().split(/\s+/)[0]; } catch { /* 探针失败→下方红 */ }
    if (!actual || !/^[0-9a-f]{32}$/.test(actual)) {
      actual = null;
      problems.push(`实况核验: --jar-probe 探针无输出或非 md5（首列 32 位 hex）——运行侧实物不可得（容器没跑/探针命令错），基线不可信，先人工核实线上实况再 --record 补正`);
    }
  } else if (STATE_FILE) {
    try { actual = createHash('md5').update(readFileSync(live.jar.path)).digest('hex'); } catch { /* 本地不可读→信息级 */ }
    if (!actual) console.log(`ℹ 实况核验: --state-file 模式下 jar.path(${live.jar.path}) 本地不可读（可能为服务器路径）——跳过实测`);
  } else {
    try {
      actual = sh(`ssh ${SERVER} "md5sum '${live.jar.path}' 2>/dev/null || md5 -q '${live.jar.path}'"`).trim().split(/\s+/)[0];
    } catch { /* 下方红 */ }
    if (!actual) problems.push(`实况核验: 无法读取服务器 jar ${live.jar.path} 的 md5（路径错/权限/ssh 不通）——基线不可信，先人工核实线上实况再 --record 补正`);
  }
  if (actual) {
    if (actual !== live.jar.md5) {
      problems.push(`实况核验: 实际 jar md5 ${actual} ≠ 基线登记 ${live.jar.md5}——线上包与基线不符（未登记部署/手工动包/登记有误），先核实线上实况并 --record 补正基线，禁止盲上`);
    } else {
      console.log(`✓ 实况核验: 实际 jar md5 与基线一致（${actual.slice(0, 8)}…${JAR_PROBE ? '，jarProbe 实物探针' : ''}）`);
    }
  }
}

// ① 血统门（--web-only 跳过：jar 不动，web 血统由构建后签名门保证）
if (has('web-only')) {
  console.log(`ℓ web-only 部署：跳过 jar 血统门（线上 jar ${live.jar?.commit || '?'} 不动）；web 血统由构建后签名册哨兵保证`);
} else {
  let ancestor = false;
  try {
    sh(`git merge-base --is-ancestor '${live.jar.commit}' '${branch}'`);
    ancestor = true;
  } catch { /* 非祖先=血统门红 */ }
  if (!ancestor) {
    problems.push(
      `血统门: 线上 jar commit ${live.jar.commit}(${live.jar.branch || live.jar.version || '?'})` +
      ` 不在部署分支 ${branch} 血统内 → **并集优先**: 先 merge 线上任务分支再构建部署,否则=覆盖滚回`
    );
  } else {
    console.log(`✓ 血统门: 线上 ${live.jar.commit}(${live.jar.version}) ⊆ ${branch}`);
  }
}

// ② verifying 让位（2.40.0 机械化：验收中任务的分支存在且 ⊄ 部署分支血统=红——本次部署会滚回其已上线代码，
//    「撞号覆盖验收窗口」事故后门从信息级升机械级；分支引用缺失/无分支记录=信息级，已合并删除不误拦）
try {
  // 主仓库根定位走 git-common-dir（.taskflow 住主仓库根，任务 worktree 内跑不再静默跳过）
  const mainRoot = sh('git rev-parse --path-format=absolute --git-common-dir').trim().replace(/\/\.git$/, '');
  const index = JSON.parse(readFileSync(mainRoot + '/.taskflow/index.json', 'utf8'));
  const verifying = [];
  for (const t of index.tasks) {
    let tj;
    try { tj = JSON.parse(readFileSync(`${mainRoot}/.taskflow/${t.id}/task.json`, 'utf8')); } catch { continue; /* 单任务档案缺失不阻塞预检 */ }
    if (tj.status === 'verifying' || tj.deploy?.status === 'verifying') {
      const b = String(tj.branch || t.branch || '').replace(/^refs\/heads\//, '');
      verifying.push(`${t.id}(${b || '?'})`);
      if (!b) { console.log(`ℓ 验收窗口: ${t.id} 无分支记录——无法机械核对并集，人工确认`); continue; }
      let known = true;
      try { sh(`git rev-parse --verify --quiet 'refs/heads/${b}'`); } catch { known = false; }
      if (!known) { console.log(`ℓ 验收窗口: ${t.id} 分支 ${b} 引用不可得（可能已合并删除）——无法机械核对并集，人工确认`); continue; }
      let anc = true;
      try { sh(`git merge-base --is-ancestor 'refs/heads/${b}' '${branch}'`); } catch { anc = false; }
      if (!anc) {
        problems.push(`验收窗口: 任务 ${t.id}(${b}) 验收中且其分支不在部署分支 ${branch} 血统内 → 本次部署将滚回其已上线代码（并集优先：先 merge ${b} 再构建，或等其验收通过；本体部署不受限）`);
      }
    }
  }
  console.log(verifying.length
    ? `ℓ 验收窗口任务(非并集/非本体的部署应让位): ${verifying.join(', ')}`
    : 'ℓ 无 verifying 任务');
} catch {
  console.log('ℓ verifying 清单不可得(.taskflow 缺失?),跳过');
}

// ③ 进程/容器清点 + 新鲜度（opt-in，v2.62.0 自 worker-systemd-20261012 项目侧定制上游化）：
//    判定逻辑与行协议入模板，探针命令显式配置（--proc-probe；project.json deploy.procProbe 经 tf.mjs deploy
//    自动透传）——探针命令属项目侧事实（容器名/镜像 tag/unit 名/jar 路径全项目异构），不进模板。
//    无配置=信息级跳过（其他项目零误伤）；--state-file 替身模式+--proc-probe 并存照跑（夹具注入）。
//    探针输出行协议：JARMTIME <mtime> / CPIDS <pid…> / PROC <main|worker> <pid> <start秒> /
//    UNIT <unit名> <pid> <active态> / CONT <容器名> <镜像ID> <start秒> / IMGLATEST <镜像ID>。
//    判定：容器与 systemd 进程并存=红（切换混乱态）；容器形态无主服务容器（名含 app）=红；
//    运行旧镜像容器（≠IMGLATEST）=红（发版后未重建）；latest 指针镜像标签缺失=红；
//    清单外 none-type 进程（游离 worker）=红；进程早于 jar mtime=红（发版未重启）；两者皆无=红。
const PROC_PROBE = opt('proc-probe');
if (!PROC_PROBE) {
  console.log('ℓ 进程清点: 未配置 --proc-probe——跳过（容器/进程形态项目在 project.json deploy.procProbe 配置探针命令，tf.mjs deploy 自动透传）');
} else {
  let procOut = '';
  try {
    procOut = sh(PROC_PROBE).trim();
  } catch {
    problems.push('进程清点: 探针命令执行失败——无法确认进程/容器形态，先人工核清再部署');
  }
  if (procOut) {
    let jarMtime = 0;
    let imgLatest = '';
    let cpids = new Set();
    const procs = [];
    const units = [];
    const conts = [];
    for (const line of procOut.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'JARMTIME') jarMtime = Number(parts[1]) || 0;
      else if (parts[0] === 'CPIDS') cpids = new Set(parts.slice(1).map(Number).filter((n) => n > 0));
      else if (parts[0] === 'PROC') procs.push({ kind: parts[1], pid: Number(parts[2]), start: Number(parts[3]) });
      else if (parts[0] === 'UNIT') units.push({ unit: parts[1], pid: Number(parts[2]), active: parts[3] });
      else if (parts[0] === 'CONT') conts.push({ name: parts[1], sha: parts[2], start: Number(parts[3]) });
      else if (parts[0] === 'IMGLATEST') imgLatest = parts[1];
    }
    const procsFiltered = procs.filter((p) => !cpids.has(p.pid));
    const managed = new Set(units.filter((u) => u.active === 'active' && u.pid > 0).map((u) => u.pid));
    if (procsFiltered.length && conts.length) {
      problems.push(`进程清点: 容器与 systemd 识别进程并存（容器 ${conts.length} / 进程 ${procsFiltered.length}）——切换混乱态，只允许一种形态在跑`);
    }
    if (conts.length) {
      const app = conts.find((c) => c.name.includes('app'));
      if (!app) problems.push('进程清点: 容器形态但未见主服务容器（名含 app）');
      if (conts.some((c) => imgLatest && c.sha !== imgLatest)) {
        problems.push('进程清点: 存在运行旧镜像的容器（与 latest 指针镜像不一致）——发版后未重建，先重建容器再部署');
      }
      if (!imgLatest && conts.length) problems.push('进程清点: latest 指针镜像标签缺失——镜像版本纪律要求 latest 跟随已部署版本');
      if (!problems.some((p) => p.startsWith('进程清点'))) {
        console.log(`✓ 进程清点: 容器形态 ${conts.length} 个（${conts.map((c) => c.name).join(', ')}），镜像与 latest 指针一致`);
      }
    } else if (procsFiltered.length) {
      for (const p of procsFiltered.filter((x) => x.kind === 'worker' && !managed.has(x.pid))) {
        problems.push(`进程清点: 游离识别进程 pid=${p.pid}（不在任何受管 unit 实例下）——手动多开的旧代码会抢队列、逃过发版重启；先终止或收编再部署`);
      }
      for (const p of procsFiltered.filter((x) => jarMtime > 0 && x.start + 5 < jarMtime)) {
        problems.push(`进程清点: pid=${p.pid}(${p.kind}) 早于 jar 文件更新时间——运行旧代码（发版后未重启${p.kind === 'main' ? '主服务' : 'worker'}），先重启再部署`);
      }
      if (!problems.some((p) => p.startsWith('进程清点'))) {
        console.log(`✓ 进程清点: systemd 形态 ${procsFiltered.length} 个（main ${procsFiltered.filter((x) => x.kind === 'main').length} / worker ${procsFiltered.filter((x) => x.kind === 'worker').length}），均在册且新鲜（回滚期形态）`);
      }
    } else {
      problems.push('进程清点: 探针未上报任何识别进程/容器——主服务未运行？先核实再部署');
    }
  }
}

// ④ 构建源凭证在位（credgate，v2.62.0 自历史空包事故上游化）：前端凭证缺位不报错、
//    构建时内联空串、上线即「未配置 XX」白屏——git 对此不可见，部署前拦在构建源。
//    **CWD 相对语义（与②的定位分工，勿「统一」）**：②查簿记（.taskflow 恒在主仓库）走 git-common-dir；
//    ④查「本次构建将用哪份检出」走 CWD——任务 worktree 内跑 preflight 查的就是该 worktree 自己的 .env
//    （分支部署等价命令链必须在任务工作树内跑 preflight，细则 references/deploy-gate.md 凭证门约定节）。
//    清单 deploy/frontend-credentials.json（CWD 相对固定路径，envPath 可选缺省 frontend/.env，同样 CWD 相对；
//    chunkHint 本段忽略——部署后探针消费）。只判在位性，不做值格式校验（格式门误杀真值先例：企微 corpid 非 ww 前缀）。
const credManifestP = path.resolve('deploy', 'frontend-credentials.json');
if (!existsSync(credManifestP)) {
  console.log('ℓ 凭证门: 未配置清单(deploy/frontend-credentials.json)——跳过（前端项目建议登记键清单，细则 references/deploy-gate.md 凭证门约定节）');
} else {
  let credManifest = null;
  try {
    credManifest = JSON.parse(readFileSync(credManifestP, 'utf8'));
  } catch (e) {
    problems.push(`凭证门: 清单解析失败（${e?.message ?? e}）——deploy/frontend-credentials.json 须为合法 JSON`);
  }
  if (credManifest) {
    const credEnvPath = credManifest.envPath || 'frontend/.env';
    const credEnv = new Map();
    let credEnvOk = true;
    try {
      for (const line of readFileSync(path.resolve(credEnvPath), 'utf8').split(/\r?\n/)) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
        if (m !== null) credEnv.set(m[1], m[2].trim().replace(/^["']|["']$/g, ''));
      }
    } catch {
      credEnvOk = false;
      problems.push(`凭证门: ${credEnvPath} 不可读——清单在而 env 文件缺失（任务 worktree 常见态），补齐后再部署`);
    }
    if (credEnvOk) {
      const credMissing = (credManifest.keys ?? []).map((k) => k.name).filter((n) => !(credEnv.get(n) ?? '').length);
      if (credMissing.length) {
        problems.push(`凭证门: ${credEnvPath} 键缺失或为空 → [${credMissing.join(' ')}]——构建将内联空串（历史空包事故同型），补齐后再部署`);
      } else {
        console.log(`✓ 凭证门: ${(credManifest.keys ?? []).length} 键在位（${credEnvPath}）`);
      }
    }
  }
}

if (problems.length) {
  console.error('✗ 部署预检不通过:');
  for (const m of problems) console.error('  - ' + m);
  process.exit(1);
}
console.log(`✓ 部署预检通过: ${branch}${has('web-only') ? '（web-only）' : ''}`);
