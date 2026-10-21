#!/usr/bin/env node
// tf.mjs 冒烟测试：自建 fixture 仓库，验证 ls / doctor / reconcile 的输出词汇与退出码契约。
// 覆盖形态：一致任务 / I1 对账漂移 / I2 漏网 commit / I3 worktree 丢失 / 游离分支+worktree / index 幽灵登记 /
//           损坏 JSON 大声报 / reconcile 幂等回写 / doctor --all 使 I5 可达 / I11-I13 需求门 /
//           svc 服务端口租约（claim 让位/回收/补登 + release + doctor I14 对账）/
//           PARK 搁置状态（park/unpark 正负路 + ls 已搁置渲染 + stale 排除）+ doctor I18 账实对账（v2.60.0）。
// 运行：node ~/.config/opencode/skills/taskflow/scripts/tf.test.mjs

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = new URL('./tf.mjs', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-test-'));
const repo = path.join(tmp, 'repo');
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };
const sh = (cmd, cwd) => execFileSync('bash', ['-c', cmd], { cwd, stdio: 'ignore' });
const run = (args, cwd) => spawnSync('node', [script, ...args], { cwd, encoding: 'utf8' });

try {
  // ---- fixture 搭建 ----
  fs.mkdirSync(repo, { recursive: true });
  sh('git init -q -b main && git config user.email t@t && git config user.name t', repo);
  sh("echo '.taskflow/' >> .git/info/exclude", repo);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  sh('git add -A && git commit -qm init', repo);

  // t1：一致任务（真实 worktree + 分支与 checkpoint 对齐）
  const t1wt = path.join(tmp, 't1-wt');
  sh(`git worktree add -q -b task/t1-ok-20260101 ${t1wt}`, repo);
  fs.writeFileSync(path.join(t1wt, 'f.txt'), '1\n');
  sh('git add -A && git commit -qm "c1: 完成表单校验"', t1wt);
  const c1 = execFileSync('git', ['-C', t1wt, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();

  // scout 的 git 检索源（同时作为 t1 的第二笔存档，保持 I2 一致）
  fs.writeFileSync(path.join(t1wt, 'g.txt'), '弹层 返回键\n');
  sh('git add -A && git commit -qm "fix: 弹层返回键收口"', t1wt);
  const c2 = execFileSync('git', ['-C', t1wt, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();

  // 链式样例（baseBranch=task/t1-ok-20260101，无 derivedFrom——ls 派生标记的 baseBranch 回退路径）
  const chainWt = path.join(tmp, 'chain-wt');
  sh(`git worktree add -q -b task/chain-sample-20260101 ${chainWt} task/t1-ok-20260101`, repo);
  fs.writeFileSync(path.join(chainWt, 'h.txt'), '6\n');
  sh('git add -A && git commit -qm "c6: 链式存档"', chainWt);
  const chainC = execFileSync('git', ['-C', chainWt, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();

  // t2：漂移任务（index 说 merged、task.json 说 active；分支领先 1 commit=漏网；worktree 目录缺失）
  const base = execFileSync('git', ['-C', repo, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', repo, 'rev-parse', 'main^{tree}'], { encoding: 'utf8' }).trim();
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const stray = execFileSync('git', ['-C', repo, 'commit-tree', tree, '-p', base, '-m', 'stray work after cp'], { encoding: 'utf8', env }).trim();
  execFileSync('git', ['-C', repo, 'update-ref', 'refs/heads/task/t2-drift-20260101', stray]);

  // 游离：未登记的 worktree + 分支
  const strayWt = path.join(tmp, 'stray-wt');
  sh(`git worktree add -q -b feat/stray ${strayWt}`, repo);

  const J = (o) => JSON.stringify(o, null, 2);
  const now = '2026-09-16T10:00:00+08:00';
  const tasksDir = path.join(repo, '.taskflow');
  fs.mkdirSync(path.join(tasksDir, 't1-ok-20260101'), { recursive: true });
  fs.mkdirSync(path.join(tasksDir, 't2-drift-20260101'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 't1-ok-20260101', 'task.json'), J({
    id: 't1-ok-20260101', title: '一致性样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'active',
    branch: 'task/t1-ok-20260101', worktree: t1wt, baseBranch: 'main', createdAt: now, lastActiveAt: now, sessionID: 'ses_a',
    checkpoints: [{ ts: now, commit: c2, summary: 'c1: 完成表单校验', files: ['f.txt'] }],
    subtasks: [{ id: '1-a', title: 'a', status: 'done', spec: 'subtasks/1-a/spec.md', worktree: null, branch: null }],
  }));
  fs.writeFileSync(path.join(tasksDir, 't2-drift-20260101', 'task.json'), J({
    id: 't2-drift-20260101', title: '漂移样例', goal: 'g', tier: 'medium', anchor: 'managed', status: 'active',
    branch: 'task/t2-drift-20260101', worktree: path.join(tmp, 'missing-wt'), createdAt: now, lastActiveAt: now, sessionID: 'ses_b',
    dependencies: '基于 task/t1-ok-20260101@abc（上游合并 main 后本分支 rebase）',
    derivedFrom: 't1-ok-20260101',
    checkpoints: [{ ts: now, commit: base.slice(0, 7), summary: 'init', files: [] }], subtasks: [],
  }));
  fs.writeFileSync(path.join(tasksDir, 'index.json'), J({ tasks: [
    { id: 't1-ok-20260101', title: '一致性样例', status: 'active', tier: 'small', branch: 'task/t1-ok-20260101', worktree: t1wt, sessionID: 'ses_a', createdAt: now, lastActiveAt: now },
    { id: 't2-drift-20260101', title: '漂移样例', status: 'merged', tier: 'medium', branch: 'task/t2-drift-20260101', worktree: path.join(tmp, 'missing-wt'), sessionID: 'ses_b', createdAt: now, lastActiveAt: now },
    { id: 't3-ghost-20260101', title: '幽灵登记', status: 'active', tier: 'small', branch: 'task/t3', worktree: null, sessionID: 'ses_c', createdAt: now, lastActiveAt: now },
    { id: 't5-gone-20260101', title: '归档样例', status: 'merged', tier: 'small', branch: 'task/t5-gone-20260101', worktree: path.join(tmp, 't5-wt-gone'), sessionID: 'ses_e', createdAt: now, lastActiveAt: now, mergedAt: now },
    { id: 'chain-sample-20260101', title: '链式样例', status: 'active', tier: 'small', branch: 'task/chain-sample-20260101', worktree: chainWt, sessionID: 'ses_f', createdAt: now, lastActiveAt: now },
  ]}));

  // t4：损坏任务（半截 JSON——必须大声报出，不许静默消失）
  fs.mkdirSync(path.join(tasksDir, 't4-bad-20260101'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 't4-bad-20260101', 'task.json'), '{"id": "t4-bad-20260101", "title');

  // t5：merged 任务，分支从未创建（I5 场景：只有 --all 才体检得到）
  fs.mkdirSync(path.join(tasksDir, 't5-gone-20260101'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 't5-gone-20260101', 'task.json'), J({
    id: 't5-gone-20260101', title: '归档样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'merged',
    branch: 'task/t5-gone-20260101', worktree: path.join(tmp, 't5-wt-gone'), createdAt: now, lastActiveAt: now, sessionID: 'ses_e',
    checkpoints: [], subtasks: [], mergedAt: now,
  }));

  // 链式样例 task.json（baseBranch 指向 task/t1，无 derivedFrom——覆盖 ls 回退路径）
  fs.mkdirSync(path.join(tasksDir, 'chain-sample-20260101'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 'chain-sample-20260101', 'task.json'), J({
    id: 'chain-sample-20260101', title: '链式样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'active',
    branch: 'task/chain-sample-20260101', worktree: chainWt, baseBranch: 'task/t1-ok-20260101', createdAt: now, lastActiveAt: now, sessionID: 'ses_f',
    checkpoints: [{ ts: now, commit: chainC, summary: 'c6: 链式存档', files: ['h.txt'] }],
    subtasks: [],
  }));

  // scout 检索源：conventions 禁止事项 / decisions（含 ⛔ 已推翻）/ 任务 findings（git 源在 t1 段）
  fs.writeFileSync(path.join(tasksDir, 'conventions.md'), '# 项目约定\n\n## 禁止事项\n- 禁止：弹层不开 pushState 直接吃返回键\n');
  fs.mkdirSync(path.join(tasksDir, 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 'decisions', '2026-01-01-popstate.md'), '# popstate 规约\n\n底部弹层必须占一条历史。\n');
  fs.writeFileSync(path.join(tasksDir, 'decisions', '2026-01-02-old-approach.md'), '# ⛔ 已被 xxx 推翻\n\n旧方案：返回键弹层。\n');
  fs.writeFileSync(path.join(tasksDir, 't1-ok-20260101', 'findings.md'), '# Findings\n\n- 被否决方案「弹层不占历史」——否决：数据丢失。\n');
  fs.writeFileSync(path.join(tasksDir, 't1-ok-20260101', 'spec.md'), [
    '# Spec — 一致性样例', '',
    '## 目标', '', 'g', '',
    '## 验收标准', '',
    '- [x] AC1 单测全绿（验证：npm test）', '',
    '## 用户验收（部署后给用户的验收脚本）', '',
    '1. 打开上报页 → 点「大类」→ 预期：底部弹出选择层，按返回键只关层不退页', '',
    '## 约束', '', '- 无', '',
  ].join('\n'));
  fs.writeFileSync(path.join(tasksDir, 't2-drift-20260101', 'spec.md'), [
    '# Spec — 漂移样例', '',
    '## 验收标准', '',
    '- [ ] AC1 漏网补登（验证：doctor I2 绿）', '- [ ] AC2 幂等（验证：重跑零 diff）', '',
  ].join('\n'));

  // ---- ls 断言 ----
  const ls = run(['ls'], repo);
  ok(ls.status === 0, `ls 退出码 0（实际 ${ls.status}）`);
  ok(ls.stdout.includes('登记任务'), 'ls 输出「登记任务」节');
  ok(ls.stdout.includes('目标'), 'ls 表格含「目标」列（用户知道任务是干嘛的）');
  ok(ls.stdout.includes('t1-ok-20260101') && ls.stdout.includes('一致性样例'), 'ls 列出一致任务');
  ok(ls.stdout.includes('游离工作') && ls.stdout.includes('feat/stray'), 'ls 列出游离 worktree/分支');
  ok(ls.stdout.includes('t3-ghost-20260101'), 'ls 提示 index 幽灵登记');
  ok(/\|\s*t1-ok-20260101\s*\|\s*—\s*\|/.test(ls.stdout) && /\|\s*t1-ok-20260101\s*\|\s*t2-drift-20260101\s*\|/.test(ls.stdout), 'ls 双列层级：t1 一级行（二级=—）+ t2 二级行（一级=t1、二级=t2），每行自足归属');
  ok(/\|\s*t1-ok-20260101\s*\|\s*chain-sample-20260101 ⛓t1-ok-20260101\s*\|/.test(ls.stdout), 'ls 双列层级：链式任务二级行保留 ⛓ 标记（baseBranch=task/*，rebase/并集部署约束语义）');

  // ---- doctor 断言 ----
  const doc = run(['doctor'], repo);
  ok(doc.status === 1, `doctor 有差异 → 退出码 1（实际 ${doc.status}）`);
  ok(doc.stdout.includes('I4'), 'doctor 检查 I4（状态文件不进 git）');
  ok(/⚠ I1 对账：index\.status=merged ≠ task\.json\.status=active/.test(doc.stdout), 'doctor 检出 I1 对账漂移');
  ok(doc.stdout.includes('I2 漏网 1 commit'), 'doctor 检出 I2 漏网 commit');
  ok(doc.stdout.includes('I3 worktree 丢失'), 'doctor 检出 I3 worktree 丢失');
  ok(doc.stdout.includes('t3-ghost-20260101'), 'doctor 报告幽灵登记');
  ok(doc.stdout.includes('只读'), 'doctor 重申修复由编排层执行（脚本只读）');

  const doc1 = run(['doctor', 't1-ok-20260101'], repo);
  ok(doc1.status === 0, `一致任务 doctor 退出码 0（实际 ${doc1.status}）`);
  ok(doc1.stdout.includes('全绿'), '一致任务输出「全绿」');

  const docMiss = run(['doctor', 'no-such'], repo);
  ok(docMiss.status === 1 && docMiss.stdout.includes('未找到任务'), '未知任务 id → 退出码 1 + 提示');

  // ---- 损坏检测 / reconcile / doctor --all（v3 最小集）----
  const ls2 = run(['ls'], repo);
  ok(ls2.stdout.includes('解析失败') && ls2.stdout.includes('t4-bad-20260101'), '损坏 task.json 在 ls 大声报出（不静默消失）');

  const rec = run(['reconcile'], repo);
  ok(rec.status === 1, `reconcile dry-run 有账目差异 → 退出码 1（实际 ${rec.status}）`);
  ok(rec.stdout.includes('t2-drift-20260101') && rec.stdout.includes('status'), 'reconcile 列出 I1 漂移（t2 index=merged vs task=active）');
  ok(rec.stdout.includes('t3-ghost-20260101'), 'reconcile 报告幽灵登记');
  ok(rec.stdout.includes('t4-bad-20260101'), 'reconcile 报告损坏任务（只报不修）');
  ok(rec.stdout.includes('baseBranch'), 'reconcile 建议 prose dependencies 补 baseBranch 字段');

  const recFix = run(['reconcile', '--fix'], repo);
  ok(recFix.stdout.includes('已回写'), 'reconcile --fix 执行回写（原子写）');
  ok(recFix.status === 1, `损坏任务仍在 → --fix 后退出码仍 1（实际 ${recFix.status}）`);

  // 同源双档（derivedFrom == 链式基线任务）→ ↳⛓ 合并显示；放 reconcile 之后——t2 加 baseBranch 前它须保持"dependencies prose 提到 task/* 但缺 baseBranch"（depHint 断言依赖）
  const t2j = JSON.parse(fs.readFileSync(path.join(tasksDir, 't2-drift-20260101', 'task.json'), 'utf8'));
  t2j.baseBranch = 'task/t1-ok-20260101';
  fs.writeFileSync(path.join(tasksDir, 't2-drift-20260101', 'task.json'), J(t2j));
  const lsDual = run(['ls'], repo);
  ok(/\|\s*t1-ok-20260101\s*\|\s*t2-drift-20260101 ⛓t1-ok-20260101\s*\|/.test(lsDual.stdout), 'ls 同源双档（derivedFrom+baseBranch 同源）：二级行显示且 ⛓ 约束标记保留');
  const t10dir = path.join(tasksDir, 't10-orphan-20260101');
  fs.mkdirSync(t10dir, { recursive: true });
  fs.writeFileSync(path.join(t10dir, 'task.json'), J({ id: 't10-orphan-20260101', title: '孤儿簇样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'active', branch: 'task/t10-orphan-20260101', worktree: null, derivedFrom: 'ghost-src-20260101', createdAt: now, lastActiveAt: now, sessionID: 'ses_g', checkpoints: [], subtasks: [] }));
  const tgOrphanDir = path.join(tasksDir, 'tg-orphan-20260101');
  fs.mkdirSync(tgOrphanDir, { recursive: true });
  fs.writeFileSync(path.join(tgOrphanDir, 'task.json'), J({ id: 'tg-orphan-20260101', title: '孤儿簇兄弟样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'active', branch: 'task/tg-orphan-20260101', worktree: null, derivedFrom: 'ghost-src-20260101', createdAt: now, lastActiveAt: now, sessionID: 'ses_h', checkpoints: [], subtasks: [] }));
  const lsGhost = run(['ls'], repo);
  ok(/t10-orphan-20260101（源:ghost-src-20260101，不在档）/.test(lsGhost.stdout) && /tg-orphan-20260101（源:ghost-src-20260101，不在档）/.test(lsGhost.stdout), 'ls 孤儿源标注：源不在档的簇头一级列自带（源:xxx，状态）——血缘随行自足，无需组头行');
  const docAfter = run(['doctor', 't2-drift-20260101'], repo);
  ok(!/I1 对账：index\./.test(docAfter.stdout), '--fix 后 t2 的 I1 对账漂移消失');

  // 修好损坏 JSON → 补登记 → 幂等终态
  fs.writeFileSync(path.join(tasksDir, 't4-bad-20260101', 'task.json'), J({
    id: 't4-bad-20260101', title: '修复后', goal: 'g', tier: 'small', anchor: 'managed', status: 'active',
    branch: null, worktree: null, createdAt: now, lastActiveAt: now, sessionID: 'ses_d', checkpoints: [], subtasks: [],
  }));
  run(['reconcile', '--fix'], repo);
  const rec2 = run(['reconcile'], repo);
  ok(rec2.status === 0 && rec2.stdout.includes('账目一致'), '修复损坏后 reconcile 到达幂等终态（退出码 0）');

  const docAll = run(['doctor', '--all'], repo);
  ok(docAll.stdout.includes('I5') && docAll.stdout.includes('t5-gone'), 'doctor --all 使 I5（merged 分支被删）可达');
  const docDef = run(['doctor'], repo);
  ok(!docDef.stdout.includes('I5') && docDef.stdout.includes('ℹ I8 t5-gone-20260101'), 'doctor 缺省：I5 体检不进日常噪音，I8 提示行在（根层死任务可见）');

  // ---- scout：历史检索（改形裁决的替代机制：检索归脚本、判断归模型）----
  const sc = run(['scout', '弹层'], repo);
  ok(sc.status === 0, 'scout 正常退出 0');
  ok(sc.stdout.includes('conventions.md') && sc.stdout.includes('禁止'), 'scout 命中 conventions 禁止事项');
  ok(sc.stdout.includes('2026-01-01-popstate.md'), 'scout 命中 decisions 决策库');
  ok(sc.stdout.includes('⛔已推翻'), 'scout 标注已推翻的决策（降信任）');
  ok(sc.stdout.includes('findings.md'), 'scout 命中任务档案（被否决方案）');
  ok(sc.stdout.includes('弹层返回键收口'), 'scout 命中 git 历史（-S 拾取/消息匹配）');
  ok(sc.stdout.includes('硬规则 9'), 'scout 输出回归判定提示（bug 先判回归，禁直接再补丁）');
  const scNone = run(['scout', '绝不存在的词xyzq'], repo);
  ok(scNone.status === 0 && scNone.stdout.split('ℹ 无命中').length - 1 === 4, '四层全部无命中也逐层表态（沉默不算完成）');
  const scNoKw = run(['scout'], repo);
  ok(scNoKw.status === 1, '缺关键词 → 退出码 1');

  // ---- skills：领域技能在场检测（换机检测 → 用户选装）----
  const envRun = (args, cwd, env) => spawnSync('node', [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  const fakeSkillDirs = path.join(tmp, 'skills-a');
  fs.mkdirSync(path.join(fakeSkillDirs, 'ui-ux-pro-max'), { recursive: true });
  const fakeReg = path.join(tmp, 'reg.json');
  fs.writeFileSync(fakeReg, JSON.stringify({ skills: [
    { id: 'ui-ux-pro-max', domains: ['前端UI'], desc: 'UI/UX 设计情报', install: 'npx skills add a/b -g -y' },
    { id: 'tdd', domains: ['测试'], desc: '测试驱动开发', install: 'npx skills add c/d -g -y' },
  ]}));
  const sk = envRun(['skills'], repo, { TF_SKILL_DIRS: fakeSkillDirs, TF_SKILLS_REGISTRY: fakeReg });
  ok(sk.status === 1, `skills 有缺 → 退出码 1（实际 ${sk.status}）`);
  ok(sk.stdout.includes('✓ ui-ux-pro-max'), 'skills 报已装技能');
  ok(sk.stdout.includes('✗ tdd') && sk.stdout.includes('npx skills add c/d'), 'skills 报缺失并给安装方式');
  ok(sk.stdout.includes('未经'), 'skills 提示：不装则如实注记「未经 XX 审查」');
  fs.mkdirSync(path.join(fakeSkillDirs, 'tdd'), { recursive: true });
  const sk2 = envRun(['skills'], repo, { TF_SKILL_DIRS: fakeSkillDirs, TF_SKILLS_REGISTRY: fakeReg });
  ok(sk2.status === 0 && sk2.stdout.includes('全部就位'), '补装后 skills 全绿（退出码 0）');

  // 符号链接安装位（如 .testbed -> 项目目录）必须识别为已装
  const realSkill = path.join(tmp, 'real-skill-dir');
  fs.mkdirSync(realSkill, { recursive: true });
  const fakeSkillDirs2 = path.join(tmp, 'skills-b');
  fs.mkdirSync(fakeSkillDirs2, { recursive: true });
  fs.symlinkSync(realSkill, path.join(fakeSkillDirs2, 'tdd'));
  const sk3 = envRun(['skills', '测试'], repo, { TF_SKILL_DIRS: fakeSkillDirs2, TF_SKILLS_REGISTRY: fakeReg });
  ok(sk3.stdout.includes('✓ tdd') && !sk3.stdout.includes('✗ tdd'), '符号链接安装位识别为已装（.testbed 场景）');

  // ---- accept：验收简报（部署后呈用户——验什么、怎么验、怎么回复）----
  const ac1 = run(['accept', 't1-ok-20260101'], repo);
  ok(ac1.status === 0, `accept 找到任务 → 退出码 0（实际 ${ac1.status}）`);
  ok(ac1.stdout.includes('验收简报') && ac1.stdout.includes('一致性样例'), 'accept 输出简报含任务标题');
  ok(ac1.stdout.includes('用户验收') && ac1.stdout.includes('底部弹出选择层'), 'accept 优先提取「用户验收」节原文');
  ok(!ac1.stdout.includes('AC1'), '有用户验收节时不混入工程 AC');
  ok(ac1.stdout.includes('验收通过'), 'accept 说明怎么回复（验收通过才归档）');
  const ac2 = run(['accept', 't2-drift-20260101'], repo);
  ok(ac2.status === 0 && ac2.stdout.includes('AC1') && ac2.stdout.includes('AC2'), '无用户验收节 → 回退用 AC 列表（待模型翻译成操作步骤）');
  ok(ac2.stdout.includes('翻译'), 'accept 提醒编排层把 AC 翻译成用户操作路径');
  const acMiss = run(['accept', 't5-gone-20260101'], repo);
  ok(acMiss.status === 1, '无 spec 无验收内容 → 退出码 1');
  const acNone = run(['accept', 'no-such'], repo);
  ok(acNone.status === 1, '任务不存在 → 退出码 1');

  // ---- commit：安全提交（复刻 2026-09-17 双会话同桌事故——本会话只该装订自己的文件）----
  fs.writeFileSync(path.join(t1wt, 'other-a.txt'), 'x\n');   // 他人留下的在途文件
  fs.writeFileSync(path.join(t1wt, 'other-b.txt'), 'y\n');
  fs.writeFileSync(path.join(t1wt, 'mine.txt'), 'z\n');       // 本会话的文件
  const beforeN = Number(execFileSync('git', ['-C', t1wt, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim());

  const cRefuse = run(['commit', '-m', '试试直接提'], t1wt);
  ok(cRefuse.status === 1 && cRefuse.stdout.includes('拒绝提交'), '未声明范围 → 拒绝提交（防 add -A 卷入他人在途工作）');
  ok(cRefuse.stdout.includes('other-a.txt') && cRefuse.stdout.includes('mine.txt'), '拒绝时列出全部未提交文件');
  const refuseN = Number(execFileSync('git', ['-C', t1wt, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim());
  ok(refuseN === beforeN, '拒绝路径零副作用（没有 add、没有 commit）');

  const cFiles = run(['commit', '-m', '只装订自己的文件', '--files', 'mine.txt'], t1wt);
  ok(cFiles.status === 0 && cFiles.stdout.includes('已提交'), '--files 只提交指定文件');
  ok(cFiles.stdout.includes('还剩'), '提交后打印桌上剩余（双活场景一眼可见）');
  const stLeft = execFileSync('git', ['-C', t1wt, 'status', '--porcelain'], { encoding: 'utf8' });
  ok(stLeft.includes('other-a.txt') && stLeft.includes('other-b.txt'), '他人在途文件未被卷入 ✓');
  ok(!stLeft.includes('mine.txt'), 'mine.txt 已入库 ✓');
  ok(Number(execFileSync('git', ['-C', t1wt, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()) === beforeN + 1, '只产生 1 个新提交');

  const cAll = run(['commit', '-m', '接管清点后整批归档', '--all'], t1wt);
  ok(cAll.status === 0 && cAll.stdout.includes('--all'), '--all 显式卷入全部（带警示语）');
  ok(!execFileSync('git', ['-C', t1wt, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '--all 后工作区干净');

  const cIdem = run(['commit', '-m', '幂等检查'], t1wt);
  ok(cIdem.status === 0 && cIdem.stdout.includes('无可提交'), '干净工作区 → 幂等提示（退出码 0）');

  // ---- testplan：测试计划选择器（按改动文件集命中规则表 → 四道门计划）----
  const tpBack = run(['testplan', '--files', 'backend-java/src/main/java/Foo.java'], repo);
  ok(tpBack.status === 0 && tpBack.stdout.includes('后端域') && tpBack.stdout.includes('全量'), '后端域文件 → 命中 mvn 全量门');
  const tpShared = run(['testplan', '--files', 'frontend/src/components/FilterSheet.vue'], repo);
  ok(tpShared.status === 0 && tpShared.stdout.includes('共享组件') && tpShared.stdout.includes('受影响'), '共享组件 → 命中 graph 受影响流+消费方');
  const tpAi = run(['testplan', '--files', 'backend-java/src/main/java/.../ai/SummaryFocus.java'], repo);
  ok(tpAi.status === 0 && tpAi.stdout.includes('一致性') && tpAi.stdout.includes('契约'), 'AI 摘要文件 → 命中契约+一致性断言');
  const tpAsset = run(['testplan', '--files', '.testbed/lib/config.ts,frontend/e2e/02.spec.ts'], repo);
  ok(tpAsset.status === 0 && tpAsset.stdout.includes('同批'), '测试资产变更 → 命中同批纪律');
  const tpContract = run(['testplan', '--files', 'docs/design/report/api.md,frontend/src/types/report.ts'], repo);
  ok(tpContract.status === 0 && (tpContract.stdout.includes('typecheck') || tpContract.stdout.includes('契约')), '契约/类型变更 → 命中 ApiTest+typecheck（断言加括号收紧）');
  const tpNone = run(['testplan', '--files', 'README.md'], repo);
  ok(tpNone.status === 0 && tpNone.stdout.includes('未命中') && tpNone.stdout.includes('通用'), '未命中规则 → 通用清单兜底');
  const tpTask = run(['testplan', 't1-ok-20260101'], repo);
  ok(tpTask.status === 0 && tpTask.stdout.includes('四道门'), '按任务 id：读分支 diff → 输出四道门计划');
  const tpNoArgs = run(['testplan'], repo);
  ok(tpNoArgs.status === 1, '无任务无 --files → 退出码 1（边界值：空输入）');
  const tpNoTask = run(['testplan', 'no-such-task'], repo);
  ok(tpNoTask.status === 1 && tpNoTask.stdout.includes('未找到'), '任务不存在 → 退出码 1 + 提示');

  // ---- diagnose：诊断证据包装配（诊断五步第②步的机械部分）----
  const dg = run(['diagnose', 't1-ok-20260101'], repo);
  ok(dg.status === 0 && dg.stdout.includes('诊断证据包'), 'diagnose 输出证据包标题');
  ok(dg.stdout.includes('提交史') && dg.stdout.includes('测试资产'), '证据包含提交史与测试资产节');
  ok(dg.stdout.includes('scout') && dg.stdout.includes('testing.md'), '含下一步提示（scout 模板+手册引用）');
  ok(dg.stdout.includes('.testbed'), '.testbed 运行记录节（无目录时如实说明）');
  const dgMiss = run(['diagnose', 'no-such'], repo);
  ok(dgMiss.status === 1, 'diagnose 任务不存在 → 退出码 1');

  // ---- I7：defect→test 门禁（kind=bugfix × 测试改动 有/无 → ⚠/✓；缺省跳过）----
  const t6wt = path.join(tmp, 't6-wt');
  sh(`git worktree add -q -b task/t6-bugfix-20260101 ${t6wt}`, repo);
  fs.mkdirSync(path.join(t6wt, 'src'), { recursive: true });
  fs.writeFileSync(path.join(t6wt, 'src', 'Fix.java'), 'x\n');
  sh('git add -A && git commit -qm "fix: 修复弹层返回键"', t6wt);
  fs.mkdirSync(path.join(tasksDir, 't6-bugfix-20260101'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 't6-bugfix-20260101', 'task.json'), J({
    id: 't6-bugfix-20260101', title: 'bugfix 样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'active', kind: 'bugfix',
    branch: 'task/t6-bugfix-20260101', worktree: t6wt, createdAt: now, lastActiveAt: now, sessionID: 'ses_f', checkpoints: [], subtasks: [],
  }));
  const dI7bad = run(['doctor', 't6-bugfix-20260101'], repo);
  ok(dI7bad.stdout.includes('I7') && dI7bad.stdout.includes('无测试改动'), 'I7：bugfix 无测试改动 → 咬住（defect→test 门禁）');
  fs.writeFileSync(path.join(t6wt, 'src', 'FixTest.java'), 't\n');
  sh('git add -A && git commit -qm "test: 回归锁"', t6wt);
  const dI7ok = run(['doctor', 't6-bugfix-20260101'], repo);
  ok(dI7ok.stdout.includes('✓ I7'), 'I7：补测试文件后转绿');
  const dNoKind = run(['doctor', 't1-ok-20260101'], repo);
  ok(!dNoKind.stdout.includes('I7'), 'kind 缺省 → I7 不打扰');

  // ---- commit 同批纪律提醒 ----
  fs.mkdirSync(path.join(t1wt, '.testbed', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(t1wt, '.testbed', 'lib', 'config.ts'), 'x\n');
  const cBatch = run(['commit', '-m', '哨兵配置调整', '--files', '.testbed/lib/config.ts'], t1wt);
  ok(cBatch.status === 0 && cBatch.stdout.includes('同批'), '提交命中测试资产路径 → 输出同批纪律警示');
  // ---- nextid：共享计数器占号（全分支扫描 max+1，防并行分支撞号）----
  const migDir = 'backend-java/src/main/resources/db/migration';
  fs.mkdirSync(path.join(repo, migDir), { recursive: true });
  fs.writeFileSync(path.join(repo, migDir, 'V19__init.sql'), '-- init\n');
  fs.writeFileSync(path.join(repo, migDir, 'V20__add_col.sql'), '-- c\n');
  sh('git add -A && git commit -qm "migrations V19 V20"', repo);
  const nidWt = path.join(tmp, 'nid-wt');   // 未合并分支上占号 V21（3fabae7a 事故复刻）
  sh('git worktree add -q -b task/other-mig ' + nidWt, repo);
  fs.writeFileSync(path.join(nidWt, migDir, 'V21__other.sql'), '-- o\n');
  sh('git add -A && git commit -qm "V21 on branch"', nidWt);
  const ni = run(['nextid', '--pattern', 'V', '--path', migDir], repo);
  ok(ni.status === 0 && ni.stdout.includes('V21'), 'nextid 扫到未合并分支的 V21（--all 全分支）');
  ok(ni.stdout.includes('V22') && ni.stdout.includes('下一个可用'), 'nextid 给出下一个可用号 V22');
  ok(ni.stdout.includes('占号'), 'nextid 提示占号纪律（写入 spec 边界节/让位先例）');
  const niNone = run(['nextid', '--pattern', 'X', '--path', 'no/such/dir'], repo);
  ok(niNone.status === 1, '无匹配编号 → 退出码 1（边界值：空结果）');
  const niArgs = run(['nextid'], repo);
  ok(niArgs.status === 1, '缺参数 → 退出码 1（边界值：空输入）');

  // ---- nextid --reserve：原子占号（登记独占创建，重查自动计入已占用）----
  const niRes1 = run(['nextid', '--pattern', 'V', '--path', migDir, '--reserve'], repo);
  ok(niRes1.status === 0 && niRes1.stdout.includes('已占号') && niRes1.stdout.includes('V22'), '第一个会话 --reserve 占下 V22');
  const niRes2 = run(['nextid', '--pattern', 'V', '--path', migDir, '--reserve'], repo);
  ok(niRes2.status === 0 && niRes2.stdout.includes('V23'), '第二个会话再占 → 自动拿到 V23（登记互斥，不撞号）');
  const niChk = run(['nextid', '--pattern', 'V', '--path', migDir], repo);
  ok(niChk.stdout.includes('V22') && niChk.stdout.includes('V23') && niChk.stdout.includes('V24'), '普通查询把已占号计入已占用 → 下一号 V24（同源）');
  const resDir = path.join(tasksDir, '.reservations');
  ok(fs.existsSync(resDir) && fs.readdirSync(resDir).length >= 2, '登记文件落盘（.taskflow/.reservations/）');

  // ---- reconcile 命令锁：陈旧可强占 + 运行后清理 ----
  const locksDir = path.join(tasksDir, '.locks');
  fs.mkdirSync(path.join(locksDir, 'reconcile'), { recursive: true });
  const staleP = path.join(locksDir, 'reconcile', 'ts');
  fs.writeFileSync(staleP, String(Date.now() - 120000));   // 2 分钟前的陈旧锁
  const recStale = run(['reconcile', '--fix'], repo);
  ok(recStale.status === 0 || recStale.stdout.includes('账目一致'), '陈旧锁（>60s）自动强占放行');
  ok(!fs.existsSync(path.join(locksDir, 'reconcile')), '命令退出后锁清理（无残留）');
  fs.mkdirSync(path.join(locksDir, 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(locksDir, 'reconcile', 'ts'), String(Date.now()));  // 新鲜锁=另一进程在跑
  const recBusy = run(['reconcile', '--fix'], repo);
  ok(recBusy.stdout.includes('另一进程') && recBusy.status === 1, '新鲜锁 → 提示另一进程在跑 + 退出码 1（互斥生效）');
  const recDry = run(['reconcile'], repo);   // dry-run 绝不能删别人的活跃锁（审查阻塞项#1）
  ok(fs.existsSync(path.join(locksDir, 'reconcile')), 'dry-run 不触碰活跃锁（只读进程无权清理）');
  fs.rmSync(path.join(locksDir, 'reconcile'), { recursive: true, force: true });  // 手动清场

  // ---- nextid --versions：版本号占面（内容计数器——历史撞号三连让位的解药）----
  fs.writeFileSync(path.join(repo, 'backend-java', 'pom.xml'), '<project><version>1.2.6</version></project>\n');
  sh('git add -A && git commit -qm "pom 1.2.6"', repo);
  fs.writeFileSync(path.join(nidWt, 'backend-java', 'pom.xml'), '<project><version>1.3.1</version></project>\n');
  sh('git add -A && git commit -qm "branch pom 1.3.1"', nidWt);
  const niVer = run(['nextid', '--versions', '--path', 'backend-java/pom.xml'], repo);
  ok(niVer.status === 0 && niVer.stdout.includes('1.2.6') && niVer.stdout.includes('1.3.1'), '--versions 列出各分支版本号占面（含未合并分支）');
  ok(niVer.stdout.includes('task/other-mig'), '按分支逐行列出（谁占了什么号一眼可见）');
  ok(niVer.stdout.includes('让位'), '撞号时让位惯例提示');

  // ---- 数据目录平台中立（.taskflow）+ 存量兼容 + migrate ----
  ok(fs.existsSync(path.join(repo, '.taskflow', 't1-ok-20260101', 'task.json')), '新默认目录 .taskflow 生效（fixture 全量走新路径）');
  const lrepo = path.join(tmp, 'legacy-repo');
  fs.mkdirSync(lrepo, { recursive: true });
  sh('git init -q . && git config user.email t@t && git config user.name t', lrepo);
  sh("printf '.opencode/tasks/\\n' >> .git/info/exclude", lrepo);
  const ldir = path.join(lrepo, '.opencode', 'tasks');
  fs.mkdirSync(path.join(ldir, 'old-20260101'), { recursive: true });
  fs.writeFileSync(path.join(ldir, 'old-20260101', 'task.json'), J({ id: 'old-20260101', title: '旧目录任务', goal: '', tier: 'small', status: 'active', createdAt: '2026-01-01T00:00:00Z' }));
  const legacyLs = run(['ls'], lrepo);
  ok(legacyLs.status === 0 && legacyLs.stdout.includes('old-20260101'), '存量兼容：旧 .opencode/tasks/ 不迁移也能跑');
  const mig = run(['migrate'], lrepo);
  ok(mig.status === 0 && fs.existsSync(path.join(lrepo, '.taskflow', 'old-20260101', 'task.json')) && !fs.existsSync(ldir), 'migrate 一键搬迁 + 旧目录消失');
  ok(!fs.existsSync(path.join(lrepo, '.opencode')), '空的旧父目录 .opencode 顺手清掉（非空则保留——dx 有别的房客）');
  const lexcl = fs.readFileSync(path.join(lrepo, '.git', 'info', 'exclude'), 'utf8');
  ok(lexcl.includes('.taskflow/') && !lexcl.includes('.opencode/tasks/'), 'migrate 顶替 .git/info/exclude 条目');
  const migLs = run(['ls'], lrepo);
  ok(migLs.status === 0 && migLs.stdout.includes('old-20260101'), '搬迁后新目录可读');
  const brepo = path.join(tmp, 'both-repo');
  fs.mkdirSync(brepo, { recursive: true });
  sh('git init -q . && git config user.email t@t && git config user.name t', brepo);
  fs.mkdirSync(path.join(brepo, '.opencode', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(brepo, '.taskflow'), { recursive: true });
  const migBoth = run(['migrate'], brepo);
  ok(migBoth.status === 1 && migBoth.stdout.includes('并存'), '新旧并存 → 拒绝自动合并、退出 1（人工核对）');

  // ---- 活死分层：archive/ + journal/ 归位 ----
  const t2dir = path.join(tasksDir, 't2-drift-20260101');
  fs.writeFileSync(path.join(t2dir, 'task.json'), J({ id: 't2-drift-20260101', title: '漂移样例', goal: 'g', tier: 'medium', anchor: 'managed', status: 'merged', branch: 'task/t2-drift-20260101', worktree: path.join(tmp, 'missing-wt'), sessionID: 'ses_b', createdAt: now, lastActiveAt: now }));
  fs.writeFileSync(path.join(t2dir, 'progress.md'), '过程记录');
  fs.writeFileSync(path.join(t2dir, 'findings.md'), '发现：archive 分层测试');
  fs.writeFileSync(path.join(t2dir, 'handoff.md'), '# Handoff\n\n## 下一步\n\n- [x] 已完成项不应混入种子\n- [ ] 等宽数字（tnum）与矢量图标\n- [ ] chips 对比度补达标\n');
  const i8def = run(['doctor'], repo);
  ok(i8def.stdout.includes('I8') && i8def.stdout.includes('archive'), 'I8 缺省可达：根层死任务不归位在缺省体检可见（假归档实证的盲区）');
  const i8pre = run(['doctor', '--all'], repo);
  ok(i8pre.stdout.includes('I8') && i8pre.stdout.includes('archive'), 'I8（提示级）：merged 未住 archive/ 被点名');
  const archLive = run(['archive', 't1-ok-20260101'], repo);
  ok(archLive.status === 1 && archLive.stdout.includes('活任务'), 'archive 点名活任务 → 拒动退出 1');
  const arch = run(['archive'], repo);
  ok(arch.status === 0 && fs.existsSync(path.join(tasksDir, 'archive', 't2-drift-20260101', 'task.json')), 'archive 批量：merged 目录搬入 archive/');
  ok(arch.stdout.includes('续迭代入口') && arch.stdout.includes('「@taskflow 继续 t2-drift-20260101 的迭代'), 'archive：输出可复制的续迭代入口句');
  ok(arch.stdout.includes('等宽数字') && arch.stdout.includes('对比度'), 'archive：待办种子摘自 handoff 未勾项');
  ok(!arch.stdout.includes('已完成项'), 'archive：已勾项不混入种子');
  ok(fs.existsSync(path.join(tasksDir, 'archive', 't2-drift-20260101', 'journal', 'progress.md')) && !fs.existsSync(t2dir), 'journal 归位：三件套进 journal/，旧目录消失');
  const lsAfter = run(['ls'], repo);
  ok(!lsAfter.stdout.includes('| t2-drift') && lsAfter.stdout.includes('已合并归档'), 'ls 折叠：归档后活表清爽');
  const lsAll = run(['ls', '--all'], repo);
  ok(lsAll.stdout.includes('t2-drift'), 'ls --all 展开已归档');
  const i8post = run(['doctor', '--all'], repo);
  ok(!i8post.stdout.includes('I8'), 'I8 复查：归档后不再提示');
  const archAgain = run(['archive'], repo);
  ok(archAgain.status === 0 && archAgain.stdout.includes('无可归档'), 'archive 幂等：重跑零动作');
  const scoutAfter = run(['scout', '分层'], repo);
  ok(scoutAfter.stdout.includes('archive 分层测试'), 'scout 双层+journal：归档任务的 findings 仍翻得到');

  // ---- state-express 新增：I2 merge 标记语义 / I9 lease / lint ----
  const t1dir2 = path.join(tasksDir, 't1-ok-20260101');
  const t1j = JSON.parse(fs.readFileSync(path.join(t1dir2, 'task.json'), 'utf8'));
  t1j.checkpoints.push({ ts: now, commit: base, type: 'merge', summary: 'merge: 合入 main', files: [] });
  fs.writeFileSync(path.join(t1dir2, 'task.json'), J(t1j));
  const i2m = run(['doctor', 't1-ok-20260101'], repo);
  ok(i2m.stdout.includes('I2 merge 标记') && i2m.stdout.includes('已在主 ref 历史'), 'I2：merge 标记不参与 tip 对比，改校验主 ref 历史');
  ok(!i2m.stdout.includes('被回退') && !i2m.stdout.includes('不在分支历史'), 'I2：merge 条目不再误报 tip 漂移');
  const t1jL = JSON.parse(fs.readFileSync(path.join(t1dir2, 'task.json'), 'utf8'));
  t1jL.activeLease = { sessionID: 'ses_other_12345678', acquiredAt: now, heartbeatAt: new Date(Date.now() - 5 * 60000).toISOString() };
  fs.writeFileSync(path.join(t1dir2, 'task.json'), J(t1jL));
  const i9a = run(['doctor', 't1-ok-20260101'], repo);
  ok(i9a.stdout.includes('I9 lease 活跃') && i9a.stdout.includes('他会在途'), 'I9：lease 活跃 → 他会在途提示');
  const t1jE = JSON.parse(fs.readFileSync(path.join(t1dir2, 'task.json'), 'utf8'));
  t1jE.activeLease.heartbeatAt = new Date(Date.now() - 3 * 3600000).toISOString();
  fs.writeFileSync(path.join(t1dir2, 'task.json'), J(t1jE));
  // 无作证场景需 tip 也早于心跳：钉一笔 4 小时前的空 commit（fixture 全程秒级跑完，不钉则 tip 恒为「刚刚」必触发侧信道）
  const d4h = new Date(Date.now() - 4 * 3600000).toISOString();
  sh(`GIT_COMMITTER_DATE="${d4h}" GIT_AUTHOR_DATE="${d4h}" git commit --allow-empty -qm "anchor: 4h前"`, t1wt);
  const i9b = run(['doctor', 't1-ok-20260101'], repo);
  ok(i9b.stdout.includes('I9 lease 已过期') && i9b.stdout.includes('可接管'), 'I9：lease 过期且无代码作证 → 可接管提示');
  // polish：I9 git 侧信道——名义过期但分支 tip 晚于心跳 → 实际活跃（代码作证），不误杀
  fs.writeFileSync(path.join(t1wt, 'h.txt'), '侧信道心跳\n');
  sh('git add -A && git commit -qm "wip: 侧信道心跳"', t1wt);
  const i9c = run(['doctor', 't1-ok-20260101'], repo);
  ok(i9c.stdout.includes('实际活跃') && i9c.stdout.includes('代码作证'), 'I9 侧信道：tip 晚于心跳 → 实际活跃不误杀');
  const lnt = run(['lint'], repo);
  ok(lnt.status === 0 && lnt.stdout.includes('lint：全绿'), 'lint：对 skill 自身全绿（引用/编号/兼容标注/闸门）');

  // status-exit：无活任务 + 有归档 → ls 打印可续迭代入口句（status/resume 共用出口）
  // fixture 的 t4/t6/chain-sample 也是 active——一并落死凑出「零活任务」场景；mergedAt 钉旧日期防挤掉 t2 的候选位
  for (const [id, when] of [['t1-ok-20260101', new Date().toISOString()], ['t4-bad-20260101', '2026-09-10T00:00:00+08:00'], ['t6-bugfix-20260101', '2026-09-10T00:00:00+08:00'], ['chain-sample-20260101', '2026-09-10T00:00:00+08:00'], ['t10-orphan-20260101', '2026-09-10T00:00:00+08:00'], ['tg-orphan-20260101', '2026-09-10T00:00:00+08:00']]) {
    const pth = path.join(tasksDir, id, 'task.json');
    const tj = JSON.parse(fs.readFileSync(pth, 'utf8'));
    tj.status = 'merged'; tj.mergedAt = when;
    fs.writeFileSync(pth, J(tj));
  }
  run(['archive'], repo);
  const lsF = run(['ls'], repo);
  ok(lsF.stdout.includes('可续迭代') && lsF.stdout.includes('「@taskflow 继续 t1-ok-20260101 的迭代'), 'ls：无活任务+有归档 → 打印可续迭代入口句');
  ok(lsF.stdout.includes('「@taskflow 继续 t2-drift-20260101 的迭代'), 'ls：候选含更早归档任务（按 mergedAt 倒序）');
  ok(lsF.stdout.includes('原样转述'), 'ls：无活任务时附转述提示（防模型散文化收尾）');
  // ---- 隔离三件套：commit --session 乐观锁 + doctor I10 worktree 属主 ----
  const t7wt = path.join(tmp, 't7-wt');
  sh(`git worktree add -q -b task/t7-lock-20260101 ${t7wt}`, repo);
  fs.mkdirSync(path.join(tasksDir, 't7-lock-20260101'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 't7-lock-20260101', 'task.json'), J({ id: 't7-lock-20260101', title: '锁样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'active', branch: 'task/t7-lock-20260101', worktree: t7wt, baseBranch: 'main', createdAt: now, lastActiveAt: now, checkpoints: [], subtasks: [] }));
  fs.writeFileSync(path.join(t7wt, 'f7.txt'), 'x\n');
  const lockFill = run(['commit', '-m', 'a 首占回填', '--files', 'f7.txt', '--session', 'ses_A'], t7wt);
  ok(lockFill.status === 0 && JSON.parse(fs.readFileSync(path.join(tasksDir, 't7-lock-20260101', 'task.json'), 'utf8')).sessionID === 'ses_A', '乐观锁：sessionID 空 → 提交成功并回填属主');
  fs.writeFileSync(path.join(t7wt, 'f7.txt'), 'y\n');
  const lockRej = run(['commit', '-m', 'b 抢占', '--files', 'f7.txt', '--session', 'ses_B'], t7wt);
  ok(lockRej.status === 1 && lockRej.stdout.includes('接管'), '乐观锁：属主不符 → 拒写退出 1（含接管提示）');
  const t7j2 = JSON.parse(fs.readFileSync(path.join(tasksDir, 't7-lock-20260101', 'task.json'), 'utf8'));
  t7j2.sessionID = 'ses_B';
  fs.writeFileSync(path.join(tasksDir, 't7-lock-20260101', 'task.json'), J(t7j2));
  const lockOk = run(['commit', '-m', 'b 接管后提交', '--files', 'f7.txt', '--session', 'ses_B'], t7wt);
  ok(lockOk.status === 0, '乐观锁：接管（sessionID 改 B）后同会话提交成功');
  const i10a = run(['doctor', 't7-lock-20260101'], repo);
  ok(i10a.stdout.includes('I10') && i10a.stdout.includes('无主'), 'I10：worktree 缺 .owner.json 被点名');
  fs.writeFileSync(path.join(t7wt, '.owner.json'), JSON.stringify({ sessionID: 'ses_B', pid: 999999999, started_at: now }));
  const i10b = run(['doctor', 't7-lock-20260101'], repo);
  ok(i10b.stdout.includes('已死') && i10b.stdout.includes('接管'), 'I10：属主 pid 死 → 可接管提示');

  // ---- 隔离三件套补丁：未出生分支上的乐观锁（demo 抓到的静默解除）----
  const urepo = path.join(tmp, 'unborn-repo');
  fs.mkdirSync(urepo, { recursive: true });
  sh('git init -q -b main . && git config user.email t@t && git config user.name t', urepo);
  const uwt = path.join(tmp, 'unborn-wt');
  sh(`git worktree add -q -b task/u1-20260101 ${uwt}`, urepo);
  fs.mkdirSync(path.join(urepo, '.taskflow', 'u1-20260101'), { recursive: true });
  fs.writeFileSync(path.join(urepo, '.taskflow', 'u1-20260101', 'task.json'), J({ id: 'u1-20260101', title: '未出生分支锁', goal: 'g', tier: 'small', anchor: 'managed', status: 'active', branch: 'task/u1-20260101', worktree: uwt, createdAt: now, lastActiveAt: now, checkpoints: [], subtasks: [] }));
  fs.writeFileSync(path.join(uwt, 'fu.txt'), '1\n');
  const unbornFill = run(['commit', '-m', 'u 首占', '--files', 'fu.txt', '--session', 'ses_U'], uwt);
  ok(unbornFill.status === 0 && JSON.parse(fs.readFileSync(path.join(urepo, '.taskflow', 'u1-20260101', 'task.json'), 'utf8')).sessionID === 'ses_U', '乐观锁在未出生分支（仓库首个提交）也生效：symbolic-ref 不依赖 HEAD 可解析');

  // ---- I6 基线语义：仅活任务查、落后主干可检出、死任务跳过（用 t7——t1 已被上方可续迭代测试归档消费）----
  const i6ok = run(['doctor', 't7-lock-20260101'], repo);
  ok(i6ok.stdout.includes('✓ I6'), 'I6：活任务分支包含基线+主干 → 绿');
  sh('echo more > m.txt && git add -A && git commit -qm "main 前进"', repo);
  const i6behind = run(['doctor', 't7-lock-20260101'], repo);
  ok(i6behind.stdout.includes('⚠ I6'), 'I6：主干有新提交未进任务分支 → 点名 rebase');
  const i6dead = run(['doctor', '--all'], repo);
  const t2sec = i6dead.stdout.split('## ').find((s) => s.includes('t2-drift-20260101')) ?? '';
  ok(t2sec.length > 0 && !t2sec.includes('I6'), 'I6：merged/archived 任务跳过（死任务无 rebase 可言）');

  // ---- v2.15.0 待验收置顶：verifying 排 active 前 + 挂起天数 + 待你验收块（先红后绿）----
  const t8dir = path.join(tasksDir, 't8-wait-20260101');
  fs.mkdirSync(t8dir, { recursive: true });
  const d3d = new Date(Date.parse(now) - 3 * 86400000).toISOString();
  fs.writeFileSync(path.join(t8dir, 'task.json'), J({ id: 't8-wait-20260101', title: '等验收样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'verifying', branch: 'task/t8-wait-20260101', worktree: null, createdAt: d3d, lastActiveAt: d3d, checkpoints: [], subtasks: [] }));
  const t9dir = path.join(tasksDir, 't9-live-20260101');
  fs.mkdirSync(t9dir, { recursive: true });
  fs.writeFileSync(path.join(t9dir, 'task.json'), J({ id: 't9-live-20260101', title: '刚活跃样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'active', branch: 'task/t9-live-20260101', worktree: null, createdAt: now, lastActiveAt: now, checkpoints: [], subtasks: [] }));
  const lsNudge = run(['ls'], repo);
  ok(lsNudge.stdout.includes('待你验收'), 'ls：verifying 存在 → 打印「待你验收」块');
  ok(lsNudge.stdout.includes('accept t8-wait-20260101'), 'ls：待验收块含逐条 accept 简报入口');
  ok(lsNudge.stdout.indexOf('t8-wait-20260101') < lsNudge.stdout.indexOf('t9-live-20260101'), 'ls：verifying 置顶（排在 active 之前）');
  const expDays = Math.max(0, Math.floor((Date.now() - Date.parse(d3d)) / 86400000)); // 与实现同源：真实时钟 - lastActiveAt
  ok(lsNudge.stdout.includes(`等验收(${expDays}天)`), 'ls：verifying 状态列显示挂起天数');
  ok(lsNudge.stdout.includes('先递「待你验收」清单'), 'ls：尾行提示改为先递待验收清单再问继续哪个');

  // ---- v2.18.2 部署态验收盲区：task.status=active 但 deploy.status=verifying → 也进📌待验收块（先红后绿）----
  const tAdir = path.join(tasksDir, 't10-depver-20260101');
  fs.mkdirSync(tAdir, { recursive: true });
  const d1d = new Date(Date.parse(now) - 86400000).toISOString();
  fs.writeFileSync(path.join(tAdir, 'task.json'), J({
    id: 't10-depver-20260101', title: '部署待验收样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'active',
    branch: 'task/t10-depver-20260101', worktree: null, createdAt: d1d, lastActiveAt: d1d, checkpoints: [], subtasks: [],
    deploy: { status: 'verifying', deployedAt: d1d, version: '0.0.1' },
  }));
  const lsDep = run(['ls'], repo);
  ok(lsDep.stdout.includes('accept t10-depver-20260101'), 'ls：deploy.status=verifying（顶层 active）也进「待你验收」块——部署后不再被遮蔽');
  const expDepDays = Math.max(0, Math.floor((Date.now() - Date.parse(d1d)) / 86400000)); // 与实现同源：真实时钟 - deploy.deployedAt
  ok(lsDep.stdout.includes(`等验收(${expDepDays}天)`), 'ls：部署待验收任务状态列显示挂起天数（deployedAt 优先）');
  ok(lsDep.stdout.indexOf('t10-depver-20260101') < lsDep.stdout.indexOf('t9-live-20260101'), 'ls：部署待验收与 verifying 同组置顶（排纯 active 之前）');

  // ---- v2.19.0 根因加固：写路径单源 / 部署扳机 / 老化升级（先红后绿）----
  // t11：active + 空 sessionID + index 补登记（sessionID 空）→ --session 回填后 index 必须同步；--deployed 触发状态翻转
  const t11dir = path.join(tasksDir, 't11-dep-20260101');
  fs.mkdirSync(t11dir, { recursive: true });
  const t11wt = path.join(tmp, 't11-wt');
  sh(`git worktree add -q -b task/t11-dep-20260101 ${t11wt}`, repo);
  fs.writeFileSync(path.join(t11wt, 'd.txt'), '1\n');
  sh('git add -A && git commit -qm "c1: 部署物"', t11wt);
  fs.writeFileSync(path.join(t11dir, 'task.json'), J({
    id: 't11-dep-20260101', title: '部署扳机样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'active',
    branch: 'task/t11-dep-20260101', worktree: t11wt, baseBranch: 'main', createdAt: now, lastActiveAt: now, sessionID: '', checkpoints: [], subtasks: [],
  }));
  const idxPath = path.join(tasksDir, 'index.json');
  if (!fs.existsSync(idxPath)) fs.writeFileSync(idxPath, J({ tasks: [] }));
  const idx0 = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  if (!idx0.tasks.some((e) => e.id === 't11-dep-20260101')) idx0.tasks.unshift({ id: 't11-dep-20260101', branch: 'task/t11-dep-20260101' });
  fs.writeFileSync(idxPath, JSON.stringify(idx0, null, 2));

  fs.writeFileSync(path.join(t11wt, 'd.txt'), '2\n'); // 给 --files 一份未提交改动（空改动会被「无可提交」早退）
  const depC = run(['commit', '-m', 'deploy: v0.0.1', '--files', 'd.txt', '--session', 'ses_D', '--deployed', 'v0.0.1 冒烟 6/6'], t11wt);
  ok(depC.status === 0, 'commit --deployed：提交成功退出 0');
  const t11j = JSON.parse(fs.readFileSync(path.join(t11dir, 'task.json'), 'utf8'));
  ok(t11j.sessionID === 'ses_D', 'commit --session：属主回填 task.json');
  ok(t11j.status === 'verifying' && t11j.deploy?.status === 'verifying' && !!t11j.deploy?.deployedAt && t11j.deploy?.note === 'v0.0.1 冒烟 6/6', 'commit --deployed：active→verifying 机械翻转 + deploy{status,deployedAt,note} 落档');
  const idxRow = JSON.parse(fs.readFileSync(idxPath, 'utf8')).tasks.find((e) => e.id === 't11-dep-20260101');
  ok(idxRow?.sessionID === 'ses_D' && idxRow?.status === 'verifying', '写路径单源：task.json 落盘后 index 行机械同步（I1 漂移根因封堵）');
  const lsT11 = run(['ls'], repo);
  ok(lsT11.stdout.includes('accept t11-dep-20260101'), 'ls：--deployed 翻转后任务进📌待验收块（与 v2.18.2 链路贯通）');

  // 老化升级：把 t11 部署时间拨到 8 天前 → ls ⛔ 需你决策块点名
  const d8 = new Date(Date.now() - 8 * 86400000).toISOString();
  t11j.deploy.deployedAt = d8;
  t11j.lastActiveAt = d8;
  fs.writeFileSync(path.join(t11dir, 'task.json'), JSON.stringify(t11j, null, 2));
  const ls8 = run(['ls'], repo);
  ok(ls8.stdout.includes('⛔ 需你决策') && ls8.stdout.includes('t11-dep-20260101') && ls8.stdout.includes('部署等验收 8 天'), 'ls：等验收 >7 天 → ⛔ 需你决策块点名（老化不再均质）');

  // verifying 幂等：再 --deployed 仅更新注记，不重置 deployedAt、不报错
  fs.writeFileSync(path.join(t11wt, 'd.txt'), '3\n');
  sh('git add -A && git commit -qm "deploy2"', t11wt);
  fs.writeFileSync(path.join(t11wt, 'd.txt'), '4\n');
  const depC2 = run(['commit', '-m', 'deploy: 注记更新', '--files', 'd.txt', '--session', 'ses_D', '--deployed', '注记二'], t11wt);
  const t11j2 = JSON.parse(fs.readFileSync(path.join(t11dir, 'task.json'), 'utf8'));
  ok(depC2.status === 0 && t11j2.status === 'verifying' && t11j2.deploy?.deployedAt === d8 && t11j2.deploy?.note === '注记二', 'commit --deployed 幂等：verifying 下仅更新注记（deployedAt 不重置）');

  // doctor I6 落后提交数可见（t7 此前已因「main 前进」处于 I6 ⚠ 态）
  const i6cnt = run(['doctor', 't7-lock-20260101'], repo);
  const i6flat = i6cnt.stdout.replace(/\n/g, ' ');
  ok(/I6 (基线|主干) .*(落后|领先).*[1-9][0-9]* 个提交/.test(i6flat), 'doctor I6：量化落后提交数（冲突税机械可见）');

  // ---- v2.21.0 自洽根治：doctor --self 三源一致 / accept --pass / takeover / lint 三新检查 ----
  // 造一个落后的 origin/main（远端跟踪 ref 先命中场景）：本地合并未 push 时 accept --pass 不得误拒
  sh('git update-ref refs/remotes/origin/main main~1', repo); // 指向 t11 分支分叉前的旧提交
  // doctor --self：真实 spec 三源一致绿；--data 副本缺行红（I7/I8 类「只活在代码里」漂移在提交时刻红灯）
  const selfOk = run(['doctor', '--self'], repo);
  ok(selfOk.status === 0 && selfOk.stdout.includes('三源一致'), 'doctor --self：真实 spec 三源一致 → 绿');
  const selfNegData = path.join(tmp, 'self-neg.md');
  fs.writeFileSync(selfNegData, fs.readFileSync(path.join(script, '..', '..', 'references', 'data.md'), 'utf8').replace(/^\| I7 \|[^\n]*\n/m, ''));
  const selfNeg = run(['doctor', '--self', '--data', selfNegData], repo);
  ok(selfNeg.status === 1 && selfNeg.stdout.includes('I7'), 'doctor --self：spec 缺 I7 行 → 红点名（唯一 spec 名存实亡的解药）');

  // accept --pass：未合并拒绝（merged 语义=已合并+验收通过）→ 合并后翻转+index 同步 → 幂等
  const apEarly = run(['accept', 't11-dep-20260101', '--pass'], repo);
  ok(apEarly.status === 1 && apEarly.stdout.includes('未并入主分支'), 'accept --pass：分支未并入 main → 拒绝（verify-first 必须先合并，脚本强制）');
  sh('git merge -q --no-ff task/t11-dep-20260101 -m "merge: t11 合入 main"', repo);
  const apOk = run(['accept', 't11-dep-20260101', '--pass'], repo);
  ok(apOk.status === 0 && apOk.stdout.includes('merged'), 'accept --pass：验收翻转 *→merged 机械落定');
  const t11j3 = JSON.parse(fs.readFileSync(path.join(t11dir, 'task.json'), 'utf8'));
  ok(t11j3.status === 'merged' && !!t11j3.mergedAt, 'accept --pass：task.json 落 merged+mergedAt（手改 status 非法化后的唯一写路径）');
  ok(JSON.parse(fs.readFileSync(idxPath, 'utf8')).tasks.find((e) => e.id === 't11-dep-20260101')?.status === 'merged', 'accept --pass：index 行机械同步（写路径单源）');
  const apAgain = run(['accept', 't11-dep-20260101', '--pass'], repo);
  ok(apAgain.status === 0 && apAgain.stdout.includes('幂等'), 'accept --pass：重跑幂等（不重置 mergedAt）');
  const apNoBranch = run(['accept', 't9-live-20260101', '--pass'], repo);
  ok(apNoBranch.status === 1 && apNoBranch.stdout.includes('未并入主分支'), 'accept --pass：无部署项目 active 直接翻转也要先合并（状态机无跳道）');

  // takeover：接管仪式机械部分（sessionID + LEASE + .owner.json + 清点清单）；旧属主被乐观锁拒写
  const tk1 = run(['takeover', 't7-lock-20260101', '--session', 'ses_C'], repo);
  ok(tk1.status === 0 && tk1.stdout.includes('桌面清点清单') && tk1.stdout.includes('已接管'), 'takeover：接管仪式输出清点清单（清点判断归编排层）');
  const t7j3 = JSON.parse(fs.readFileSync(path.join(tasksDir, 't7-lock-20260101', 'task.json'), 'utf8'));
  ok(t7j3.sessionID === 'ses_C' && t7j3.activeLease?.sessionID === 'ses_C', 'takeover：sessionID 更新 + LEASE 刷新（死规则接线）');
  ok(JSON.parse(fs.readFileSync(path.join(t7wt, '.owner.json'), 'utf8')).sessionID === 'ses_C', 'takeover：.owner.json 重写（OWNER_JSON 属主凭证）');
  fs.writeFileSync(path.join(t7wt, 'f7.txt'), 'z\n');
  const lockOld = run(['commit', '-m', '前任属主再写', '--files', 'f7.txt', '--session', 'ses_B'], t7wt);
  ok(lockOld.status === 1 && lockOld.stdout.includes('接管仪式'), 'takeover 后旧属主 commit 仍被乐观锁拒绝');
  ok(run(['takeover', 't2-drift-20260101', '--session', 'ses_X'], repo).status === 1, 'takeover：终态/不存在任务拒接');
  ok(run(['takeover', 't-nonexist', '--session', 'ses_Z'], repo).status === 1, 'takeover：任务不存在 → 退出码 1');
  ok(run(['takeover', 't7-lock-20260101', '--session'], repo).status === 1, 'takeover：--session 缺值 → 退出码 1（防吞 flag）');
  ok(run(['takeover', 't7-lock-20260101'], repo).status === 1, 'takeover：缺 --session → 退出码 1（边界值：空输入）');

  // lint 三新检查负例（fake root：事实禁改写 / 机制死规则 / 模板中性）
  const fakeRoot = path.join(tmp, 'fake-skill');
  fs.mkdirSync(path.join(fakeRoot, 'references'), { recursive: true });
  fs.mkdirSync(path.join(fakeRoot, 'templates'), { recursive: true });
  fs.mkdirSync(path.join(fakeRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(fakeRoot, 'scripts', 'tf.mjs'), '');
  fs.writeFileSync(path.join(fakeRoot, 'SKILL.md'), '本脚本零写入，按不变量 I1-I6 体检\n');
  fs.writeFileSync(path.join(fakeRoot, 'README.md'), '');
  for (const f of ['merge.md', 'checkpoint.md', 'domain.md', 'resume.md', 'new-task.md']) fs.writeFileSync(path.join(fakeRoot, 'references', f), '');
  fs.writeFileSync(path.join(fakeRoot, 'references', 'data.md'), [
    '# data', '',
    '## 机制登记表', '',
    '| token | 定义处 | 触点 | 采纳产物 | fixture 落痕 | 检测 | 大白话 |', '| --- | --- | --- | --- | --- | --- | --- |',
    '| GOODTOKEN | x | references/resume.md | —（无产物，理由写足长度） | —（prose 门无脚本，理由完整） | t | 开工前先问三件事 |', '',
  ].join('\n'));
  fs.writeFileSync(path.join(fakeRoot, 'templates', 't.md'), '反向依赖用 get_impact_radius_tool 实证\n');
  const lnt2 = run(['lint', '--root', fakeRoot], repo);
  ok(lnt2.status === 1, 'lint：fake root 有漂移 → 退出码 1');
  ok(lnt2.stdout.includes('零写入'), 'lint 事实禁改写：零写入宣称被点名');
  ok(lnt2.stdout.includes('I1-I'), 'lint 事实禁改写：不变量范围复述被点名');
  ok(lnt2.stdout.includes('死规则') && lnt2.stdout.includes('GOODTOKEN'), 'lint 机制触点：token 不在触点文件 = 死规则被点名');
  ok(lnt2.stdout.includes('get_impact_radius_tool'), 'lint 模板中性：项目专属工具标识符被点名');

  // ---- v2.52.0 lint 检查器自身修复的红绿两路（对抗审查 A1/A2/B1/B3/C1/C2/F 实证形态，副本真跑）----
  const mkLintCase = (name, dataMd) => {
    const fr = path.join(tmp, name);
    for (const d of ['references', 'templates', 'scripts']) fs.mkdirSync(path.join(fr, d), { recursive: true });
    fs.writeFileSync(path.join(fr, 'scripts', 'tf.mjs'), '// INVARIANTS\n');
    fs.writeFileSync(path.join(fr, 'SKILL.md'), 'x\n\n不审查，不合并；需求变更门\n');
    fs.writeFileSync(path.join(fr, 'README.md'), '');
    fs.writeFileSync(path.join(fr, 'references', 'resume.md'), 'GOODTOKEN\n\n需求锚定\n');
    fs.writeFileSync(path.join(fr, 'references', 'data.md'), dataMd + '\n状态机（唯一事实源\n');
    return run(['lint', '--root', fr], repo);
  };
  const hdr7 = ['| token | 定义处 | 触点 | 采纳产物 | fixture 落痕 | 检测 | 大白话 |', '| --- | --- | --- | --- | --- | --- | --- |'];
  const cPlain = mkLintCase('fake-plain', ['# data', '', '## 机制登记表', '', ...hdr7, '| GOODTOKEN | x | resume.md | —（无产物，理由写足长度） | —（无脚本，理由写足长度） | t |  |', ''].join('\n'));
  ok(cPlain.status === 1 && cPlain.stdout.includes('大白话」列为空'), 'lint 列索引：真大白话列（第 7 列）清空 → 红（旧代码读第 6 列检测列，此形态恒绿）');
  const cDetect = mkLintCase('fake-detect', ['# data', '', '## 机制登记表', '', ...hdr7, '| GOODTOKEN | x | resume.md | —（无产物，理由写足长度） | —（无脚本，理由写足长度） |  | 一句解释 |', ''].join('\n'));
  ok(!cDetect.stdout.includes('大白话」列为空'), 'lint 列索引反向：检测列清空、大白话列在位 → 不误报（旧代码读错列此形态误红）');
  const cBlind = mkLintCase('fake-blind', ['# data', '', '## 机制登记', '', '本节机制登记表为 lint 数据源。', ''].join('\n'));
  ok(cBlind.status === 1 && cBlind.stdout.includes('三检查整体失明'), 'lint 段失明：段头被改名 → ⛔（旧版整个检查静默跳过且全绿）');
  const cExempt = mkLintCase('fake-exempt', ['# data', '', '## 机制登记表', '', ...hdr7, '| GOODTOKEN | x | resume.md | —（无产物，理由写足长度） | —TODO | t | 一句解释 |', ''].join('\n'));
  ok(cExempt.status === 1 && cExempt.stdout.includes('豁免理由过短'), 'lint 豁免校验：fixture 列裸「—TODO」→ 红（旧版零校验，—开头任意串免疫先红后绿纪律）');
  const cTouch = mkLintCase('fake-touch', ['# data', '', '## 机制登记表', '', ...hdr7, '| GOODTOKEN | x | `resume.md`, references/resume.md | —（无产物，理由写足长度） | —（无脚本，理由写足长度） | t | 一句解释 |', ''].join('\n'));
  ok(cTouch.status === 0, 'lint 触点归一化：反引号与 references/ 前缀剥壳后仍识别（token 在文件全绿；旧版静默丢弃后误判死规则）');
  const tfmjsSrc = fs.readFileSync(new URL('./tf.mjs', import.meta.url), 'utf8');
  ok(!tfmjsSrc.includes('验证通过'), 'v2.52.0 机器输出面：tf.mjs 源零「验证通过」残留（convText/agText 渲染源——四路独立证实第 6 处漏网）');
  ok(tfmjsSrc.includes('用户回「验收通过」'), 'v2.52.0 机器输出面：convText 教用户回「验收通过」（渲染进新项目 conventions 的口径）');

  // ---- v2.56.3 lint 检查 #10：description 版本串 ↔ version 字段（用户 2026-10-11 拍板技能简介可见版本号——红绿三路真跑，硬规则 17）----
  const mkDescVer = (name, desc) => {
    const fr = path.join(tmp, name);
    for (const d of ['references', 'templates', 'scripts']) fs.mkdirSync(path.join(fr, d), { recursive: true });
    fs.writeFileSync(path.join(fr, 'scripts', 'tf.mjs'), '// INVARIANTS\n');
    fs.writeFileSync(path.join(fr, 'SKILL.md'), `---\nname: x\nversion: 9.9.9\ndescription: "${desc}"\n---\n\nx\n\n不审查，不合并；需求变更门\n`);
    fs.writeFileSync(path.join(fr, 'README.md'), '');
    fs.writeFileSync(path.join(fr, 'references', 'resume.md'), 'GOODTOKEN\n\n需求锚定\n');
    fs.writeFileSync(path.join(fr, 'references', 'data.md'), ['# data', '', '## 机制登记表', '', ...hdr7, '| GOODTOKEN | x | `resume.md`, references/resume.md | —（无产物，理由写足长度） | —（无脚本，理由写足长度） | t | 一句解释 |', ''].join('\n') + '\n状态机（唯一事实源\n');
    return run(['lint', '--root', fr], repo);
  };
  const dvMiss = mkDescVer('fake-descver-miss', '管理长任务。');
  ok(dvMiss.status === 1 && dvMiss.stdout.includes('description 未携带版本串'), 'lint #10 红：简介缺版本串被点名（边界值：完全缺失——升版忘改简介的真实漂移形态）');
  const dvDiff = mkDescVer('fake-descver-diff', '管理长任务。版本 9.9.8。');
  ok(dvDiff.status === 1 && dvDiff.stdout.includes('description 版本串 9.9.8 ≠ version 9.9.9'), 'lint #10 红：简介版本串与 version 字段不一致被点名（等价类：有串但旧版本）');
  const dvOk = mkDescVer('fake-descver-ok', '管理长任务。版本 9.9.9。');
  ok(dvOk.status === 0, 'lint #10 绿：简介版本串与 version 字段一致 → 全绿');

  // ---- v2.22.0 排队锁：merge 端局串行化（活锁防治）----
  const lk1 = run(['lock', 'merge', '--session', 'ses_A'], repo);
  ok(lk1.status === 0 && lk1.stdout.includes('已获取'), 'lock：无锁时获取成功');
  const lk2 = run(['lock', 'merge', '--session', 'ses_B'], repo);
  ok(lk2.status === 1 && lk2.stdout.includes('排队'), 'lock：他人新鲜锁 → 拒绝排队（活锁变串行）');
  fs.writeFileSync(path.join(tasksDir, '.locks', 'merge', 'ts'), String(Date.now() - 300000));
  const lk3 = run(['lock', 'merge', '--session', 'ses_C'], repo);
  ok(lk3.status === 0 && lk3.stdout.includes('强占'), 'lock：陈旧锁（300s > ttl 120s）→ 强占并报告');
  ok(run(['lock', 'merge', '--release', '--session', 'ses_C'], repo).status === 0, 'lock：释放成功（同 session）');
  ok(run(['lock', 'merge', '--release', '--session', 'ses_C'], repo).stdout.includes('幂等'), 'lock：重复释放幂等');
  // ---- v2.54.0 锁体系三防线（对抗审查：原子性/持有者校验/TTL 落盘）----
  run(['lock', 'merge', '--session', 'ses_C'], repo); // 重新拿锁供拒释放用例（前面的释放断言已消费）
  const lk4 = run(['lock', 'merge', '--release', '--session', 'ses_X'], repo);
  ok(lk4.status === 1 && lk4.stdout.includes('拒绝释放他人锁'), 'lock：他人 session 释放 → 拒（旧版任一会话可 rmSync 他人锁）');
  run(['lock', 'merge', '--release', '--force'], repo);
  const lk5 = run(['lock', 'merge', '--session', 'ses_A', '--ttl', '1800'], repo);
  ok(lk5.status === 0, 'lock：重新获取（ttl 1800 落盘）');
  const lk6 = run(['lock', 'merge', '--session', 'ses_B'], repo);
  ok(lk6.status === 1 && lk6.stdout.includes('ttl 1800'), 'lock TTL 落盘：竞争者默认 120 不再误判他人 1800 锁陈旧（旧版按竞争者参数判）');
  fs.rmSync(path.join(tasksDir, '.locks', 'merge'), { recursive: true, force: true });
  fs.mkdirSync(path.join(tasksDir, '.locks', 'merge'), { recursive: true }); // 空目录=并发竞争窗口形态
  const lk7 = run(['lock', 'merge', '--session', 'ses_A'], repo);
  ok(lk7.status === 1 && lk7.stdout.includes('原子竞争失败'), 'lock 原子获取：目录已被抢先占位 → 拒（旧版 existsSync→mkdir 两步，并发双抢均成功）');
  fs.rmSync(path.join(tasksDir, '.locks', 'merge'), { recursive: true, force: true });
  ok(run(['lock'], repo).status === 1, 'lock：缺 name → 退出码 1（边界值：空输入）');
  ok(run(['lock', 'a/b', '--session', 's'], repo).status === 1, 'lock：name 含路径分隔 → 拒绝（防越目录写）');

  // ---- v2.22.1 archive 自动清 managed worktree（I5 执行半边接线；归档后残留两次实证的棘轮）----
  const t12wt = path.join(tmp, 't12-wt');
  sh(`git worktree add -q -b task/t12-done-20260101 ${t12wt}`, repo);
  fs.writeFileSync(path.join(t12wt, 'x.txt'), 'x\n');
  sh('git add -A && git commit -qm "c1: 待归档产出"', t12wt);
  const t12dir = path.join(tasksDir, 't12-done-20260101');
  fs.mkdirSync(t12dir, { recursive: true });
  fs.writeFileSync(path.join(t12dir, 'task.json'), J({ id: 't12-done-20260101', title: '归档清理样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'merged', branch: 'task/t12-done-20260101', worktree: t12wt, createdAt: now, lastActiveAt: now, sessionID: '', mergedAt: now, checkpoints: [], subtasks: [] }));
  const arch12 = run(['archive', 't12-done-20260101'], repo);
  ok(arch12.status === 0 && arch12.stdout.includes('worktree 已清理'), 'archive：managed worktree 自动清理（不再靠编排层手动）');
  ok(!fs.existsSync(t12wt), 'archive：worktree 目录已消失');
  ok(!/I5[^\n]*t12-done/.test(run(['doctor', '--all'], repo).stdout), 'archive 后 doctor I5 对 t12 无差异（清理到位）');

  // ---- v2.23.0 需求防漂：goalHash 锚定 / req-confirm / I11 / I12 / I13 ----
  const t13id = 't13-req-20260101';
  const t13wt = path.join(tmp, 't13-wt');
  sh(`git worktree add -q -b task/t13-req-20260101 ${t13wt}`, repo);
  fs.writeFileSync(path.join(t13wt, 'feat.txt'), '1\n');
  sh('git add -A && git commit -qm "c1: 初版产出"', t13wt);
  const t13dir = path.join(tasksDir, t13id);
  fs.mkdirSync(t13dir, { recursive: true });
  const t13spec = [
    '# Spec — 需求样例', '',
    '## 目标', '', '做 X', '',
    '## 需求基线', '', '- docs/prd/x/domain.md#口径（管 X 的口径）', '',
    '## 验收标准', '', '- [ ] AC1 可验（验证：npm test）', '',
  ].join('\n');
  fs.writeFileSync(path.join(t13dir, 'spec.md'), t13spec);
  fs.writeFileSync(path.join(t13dir, 'task.json'), J({
    id: t13id, title: '需求样例', goal: '做 X', tier: 'small', anchor: 'managed', status: 'active',
    branch: 'task/t13-req-20260101', worktree: t13wt, createdAt: now, lastActiveAt: now, sessionID: 'ses_g', checkpoints: [], subtasks: [],
  }));
  const idxT13 = JSON.parse(fs.readFileSync(path.join(tasksDir, 'index.json'), 'utf8'));
  idxT13.tasks.push({ id: t13id, title: '需求样例', status: 'active', tier: 'small', branch: 'task/t13-req-20260101', worktree: t13wt, sessionID: 'ses_g', createdAt: now, lastActiveAt: now });
  fs.writeFileSync(path.join(tasksDir, 'index.json'), J(idxT13));
  fs.mkdirSync(path.join(repo, 'docs', 'prd', 'x'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'prd', 'x', 'domain.md'), '# X 域\n\n## 口径\n\n- 口径 A：以 X 为准\n');
  sh('git add -A && git commit -qm "docs: X 域 PRD"', repo);

  const d13pre = run(['doctor', t13id], repo);
  ok(d13pre.status === 0 && d13pre.stdout.includes('ℹ I11') && !d13pre.stdout.includes('⚠ I11'), 'I11：未锚定 → ℹ 提示不红（新任务等 commit 自动锚）');
  ok(d13pre.stdout.includes('✓ I12'), 'I12：基线链接可达（文件+锚点都在）→ 绿');

  fs.writeFileSync(path.join(t13wt, 'feat.txt'), '2\n');   // d13pre 之后才有未提交改动，避免「未提交改动」咬红污染 I11/I12 断言
  const c13 = run(['commit', '-m', 'c2: 触发锚定', '--files', 'feat.txt'], t13wt);  ok(c13.status === 0 && c13.stdout.includes('锚定'), 'commit：首个提交自动锚定 goalHash（零新仪式）');
  const t13j1 = JSON.parse(fs.readFileSync(path.join(t13dir, 'task.json'), 'utf8'));
  ok(!!t13j1.goalHash && t13j1.goalHash.length >= 8, 'goalHash 已落档 task.json（syncIndexRow 由 reconcile 复核）');
  const d13ok = run(['doctor', t13id], repo);
  ok(d13ok.status === 0 && d13ok.stdout.includes('✓ I11'), '锚定后 doctor I11 绿');

  fs.writeFileSync(path.join(t13dir, 'spec.md'), t13spec.replace('做 X', '做 X（口径修订）'));
  const d13bad = run(['doctor', t13id], repo);
  ok(d13bad.status === 1 && d13bad.stdout.includes('⚠ I11') && d13bad.stdout.includes('req-confirm'), 'I11 红：承重节被改未经变更门 → 咬住并指路 req-confirm');
  ok(fs.readFileSync(path.join(t13dir, 'task.json'), 'utf8').includes(t13j1.goalHash) && !JSON.parse(fs.readFileSync(path.join(t13dir, 'task.json'), 'utf8')).reqChanges, 'I11 红灯只报告不改档（修复归编排层，脚本不越权）');

  const rcNoNote = run(['req-confirm', t13id], repo);
  ok(rcNoNote.status === 1 && rcNoNote.stdout.includes('--note'), 'req-confirm 缺 --note → 拒绝（变更门必须留拍板说明，禁无记名刷新）');
  const rc = run(['req-confirm', t13id, '--note', '口径修订经用户拍板'], repo);
  ok(rc.status === 0 && rc.stdout.includes('留痕'), 'req-confirm：hash 刷新 + reqChanges 落痕');
  const t13j2 = JSON.parse(fs.readFileSync(path.join(t13dir, 'task.json'), 'utf8'));
  ok(t13j2.reqChanges?.length === 1 && t13j2.reqChanges[0].note.includes('拍板') && t13j2.goalHash !== t13j1.goalHash, 'reqChanges 条目完整（ts/hash/note）且 goalHash 已刷新');
  ok(run(['doctor', t13id], repo).stdout.includes('✓ I11'), 'req-confirm 后 I11 转绿（同一 spec，合法留痕）');

  const cur13 = fs.readFileSync(path.join(t13dir, 'spec.md'), 'utf8'); // 已确认版（口径修订），I11 绿基线
  fs.writeFileSync(path.join(t13dir, 'spec.md'), cur13.replace('- [ ] AC1', '- [x] AC1'));
  const d13chk = run(['doctor', t13id], repo);
  ok(!d13chk.stdout.includes('⚠ I11') && d13chk.stdout.includes('✓ I11'), 'I11 边界值：验收勾选 [ ]→[x] 不触发误报（规范化归一）');
  fs.writeFileSync(path.join(t13dir, 'spec.md'), cur13);

  const rcMiss = run(['req-confirm', 'no-such', '--note', 'x'], repo);
  ok(rcMiss.status === 1 && rcMiss.stdout.includes('未找到'), 'req-confirm：任务不存在 → 退出码 1');

  // I12 三态：断链红 / 锚点失效红 / 无 PRD 注记合法（从已确认版出发——I11 保持绿，红灯只来自 I12）
  fs.writeFileSync(path.join(t13dir, 'spec.md'), cur13.replace('docs/prd/x/domain.md', 'docs/prd/x/gone.md'));
  const d12a = run(['doctor', t13id], repo);
  ok(d12a.status === 1 && d12a.stdout.includes('⚠ I12') && d12a.stdout.includes('gone.md'), 'I12 红：基线链接断链被咬住');
  fs.writeFileSync(path.join(t13dir, 'spec.md'), cur13.replace('#口径', '#不存在的锚'));
  const d12b = run(['doctor', t13id], repo);
  ok(d12b.status === 1 && d12b.stdout.includes('锚点失效'), 'I12 红：锚点文本在目标文件中找不到');
  fs.writeFileSync(path.join(t13dir, 'spec.md'), cur13);
  const t14id = 't14-noprd-20260101';
  const t14dir = path.join(tasksDir, t14id);
  fs.mkdirSync(t14dir, { recursive: true });
  const t14specOk = '# Spec\n\n## 目标\n\n做 Y\n\n## 需求基线\n\n- 无 PRD——口径以本 spec 为准（用户拍板豁免 2026-01-01：探索性任务，无既有域文档）\n\n## 验收标准\n\n- [ ] ACY\n';
  fs.writeFileSync(path.join(t14dir, 'spec.md'), t14specOk);
  fs.writeFileSync(path.join(t14dir, 'task.json'), J({ id: t14id, title: '无PRD样例', goal: '做 Y', tier: 'small', anchor: 'attached', status: 'active', branch: null, worktree: null, createdAt: now, lastActiveAt: now, sessionID: 'ses_h', checkpoints: [], subtasks: [] }));
  const d14 = run(['doctor', t14id], repo);
  ok(!d14.stdout.includes('⚠ I12') && d14.stdout.includes('豁免在案'), 'I12：无 PRD + 用户拍板豁免留痕 = 合法跳过');
  // 新需求户口门（v2.23.1）：裸注记（无拍板留痕）→ 红——模型禁自选降级，无文档时呈用户决定
  fs.writeFileSync(path.join(t14dir, 'spec.md'), '# Spec\n\n## 目标\n\n做 Y\n\n## 需求基线\n\n- 无 PRD——口径以本 spec 为准（没有现成文档）\n\n## 验收标准\n\n- [ ] ACY\n');
  const d14bare = run(['doctor', t14id], repo);
  ok(d14bare.status === 1 && d14bare.stdout.includes('⚠ I12') && d14bare.stdout.includes('拍板'), 'I12 红：无 PRD 注记缺拍板留痕——新增需求禁自选降级');
  // bugfix 任务自动豁免：bug 的原始需求=既有行为，不需拍板留痕（t6 已被归档进 archive/——顺带验证归档路径回退）
  fs.writeFileSync(path.join(tasksDir, 'archive', 't6-bugfix-20260101', 'spec.md'), '# Spec\n\n## 目标\n\n修 bug\n\n## 需求基线\n\n- 无 PRD——口径以本 spec 为准（缺陷修复，恢复既有行为）\n\n## 验收标准\n\n- [ ] 回归锁\n');
  const d6i12 = run(['doctor', 't6-bugfix-20260101'], repo);
  ok(!d6i12.stdout.includes('⚠ I12') && d6i12.stdout.includes('bugfix'), 'I12：kind=bugfix 任务无 PRD 自动豁免（bug 修复不强制建文档）');
  fs.writeFileSync(path.join(t14dir, 'spec.md'), t14specOk);

  // I13 提示级：merged 后 reqChanges 晚于 PRD 最后提交 → 疑未回写
  const t13j3 = JSON.parse(fs.readFileSync(path.join(t13dir, 'task.json'), 'utf8'));
  t13j3.status = 'merged';
  t13j3.mergedAt = now;
  t13j3.reqChanges = [{ ts: '2099-01-01T00:00:00Z', hash: t13j3.goalHash, note: '迟到的口径确认' }];
  fs.writeFileSync(path.join(t13dir, 'task.json'), J(t13j3));
  const d13m = run(['doctor', t13id], repo);
  ok(d13m.stdout.includes('ℹ I13') && d13m.stdout.includes('回写'), 'I13：reqChanges 晚于 PRD 最后提交 → ℹ 疑未回写（提示级不咬退出码语义由 bad 控制）');
  t13j3.reqChanges = [{ ts: '2000-01-01T00:00:00Z', hash: t13j3.goalHash, note: '早于 PRD 提交的确认' }];
  fs.writeFileSync(path.join(t13dir, 'task.json'), J(t13j3));
  ok(!run(['doctor', t13id], repo).stdout.includes('I13'), 'I13 边界值：确认早于 PRD 提交 → 不提示');

  // 归档回归：spec 随归档搬进 archive/ 后，I11/I12 不得假红（目录回退与 loadTasks 双层扫描同构）
  const idx13b = JSON.parse(fs.readFileSync(path.join(tasksDir, 'index.json'), 'utf8'));
  idx13b.tasks.find((x) => x.id === t13id).status = 'merged';
  fs.writeFileSync(path.join(tasksDir, 'index.json'), J(idx13b));
  const arch13 = run(['archive', t13id], repo);
  ok(arch13.status === 0, `archive：t13 归层（merged + managed worktree 自动清）——实际 ${arch13.status}`);
  const d13arch = run(['doctor', t13id], repo);
  ok(d13arch.status === 0 && d13arch.stdout.includes('✓ I11') && !d13arch.stdout.includes('⚠ I11'), '归档任务（spec 住 archive/）I11 保持绿——假红死锁回归被咬住');

  // ---- svc 服务端口租约（claim 让位/回收/补登 + release + doctor I14 对账）----
  // 端口全部从 freePort 派生，防与宿主机真实监听撞车；occupiedPort 挂真实监听模拟「其他任务在测服务」
  const readSvc = () => JSON.parse(fs.readFileSync(path.join(tasksDir, 'services.json'), 'utf8'));
  const d0svc = run(['svc', 'ls'], repo);
  ok(d0svc.status === 0 && d0svc.stdout.includes('无租约登记'), 'svc ls：无 services.json → 空清单不炸');
  const freePort = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  let serverOcc;
  const occupiedPort = await new Promise((res) => { serverOcc = net.createServer(); serverOcc.listen(0, '127.0.0.1', () => res(serverOcc.address().port)); });
  const svcFile = path.join(tasksDir, 'services.json');
  fs.writeFileSync(svcFile, J({ services: [
    { port: freePort, service: 'web', task: 't1-ok-20260101', session: 'ses_a', pid: process.pid, startedAt: now, note: '在测' },
    { port: freePort + 30, service: 'api', task: 't1-ok-20260101', session: 'ses_a', pid: 999999999, startedAt: now },
    { port: freePort + 40, service: 'gw', task: 'ghost-task-20260101', session: 'ses_a', pid: process.pid, startedAt: now },
  ] }));
  const ls1 = run(['svc', 'ls'], repo);
  ok(ls1.status === 0 && ls1.stdout.includes('live') && ls1.stdout.includes('stale') && ls1.stdout.includes('orphan'), 'svc ls：live/stale/orphan 三态标注');
  const cOcc = run(['svc', 'claim', 'web', '--port', String(occupiedPort), '--task', 't1-ok-20260101'], repo);
  ok(cOcc.status === 1 && /监听|占用/.test(cOcc.stdout) && cOcc.stdout.includes('建议'), 'claim：端口被活进程监听 → 拒绝 + 报告占用者 + 建议让位');
  ok(!readSvc().services.some((s) => s.port === occupiedPort), 'claim 被拒后 services.json 未写该端口（探测让位，绝不抢占）');
  serverOcc.close();
  const altPort = freePort + 20;
  const cFree = run(['svc', 'claim', 'web', '--port', String(altPort), '--task', 't1-ok-20260101', '--session', 'ses_z'], repo);
  ok(cFree.status === 0 && readSvc().services.some((s) => s.port === altPort && s.task === 't1-ok-20260101'), 'claim：空闲端口写租约');
  const cPid = run(['svc', 'claim', 'web', '--port', String(altPort), '--task', 't1-ok-20260101', '--pid', String(process.pid)], repo);
  ok(cPid.status === 0 && readSvc().services.filter((s) => s.port === altPort).length === 1 && readSvc().services.find((s) => s.port === altPort)?.pid === process.pid, 'claim 同 task 同端口 → 补登 pid（幂等更新，非重复行）');
  const stalePort = freePort + 30;
  const cRe = run(['svc', 'claim', 'api', '--port', String(stalePort), '--task', 't1-ok-20260101'], repo);
  ok(cRe.status === 0 && cRe.stdout.includes('回收') && readSvc().services.filter((s) => s.port === stalePort).length === 1, 'claim：死 pid 租约 + 端口实测空闲 → 回收重登记');
  const rOk = run(['svc', 'release', String(altPort)], repo);
  ok(rOk.status === 0 && !readSvc().services.some((s) => s.port === altPort), 'release：在册租约删除');
  const rMiss = run(['svc', 'release', String(altPort)], repo);
  ok(rMiss.status === 1 && rMiss.stdout.includes('不在册'), 'release：不在册 → 退出码 1');
  // 他人租约拒绝（宁可让位不可误抢）：活 pid 租约 / 未补登 pid 的预留，都不许被别的 task 抢写
  const cOtherLive = run(['svc', 'claim', 'other', '--port', String(freePort), '--task', 't2-drift-20260101'], repo);
  ok(cOtherLive.status === 1 && cOtherLive.stdout.includes('已被在册租约占用'), 'claim：他人活租约 → 拒绝（宁可让位不可误抢）');
  fs.writeFileSync(svcFile, J({ services: [
    { port: freePort + 21, service: 'web', task: 't1-ok-20260101', session: 'ses_a', pid: null, startedAt: now },
  ] }));
  const cOtherResv = run(['svc', 'claim', 'other', '--port', String(freePort + 21), '--task', 't2-drift-20260101'], repo);
  ok(cOtherResv.status === 1 && cOtherResv.stdout.includes('已被在册租约占用'), 'claim：他人未补登 pid 的预留 → 同样拒绝（预留也是占用）');
  fs.writeFileSync(svcFile, J({ services: [
    { port: freePort + 11, service: 'web', task: 't1-ok-20260101', session: 'ses_a', pid: process.pid, startedAt: now },
    { port: stalePort, service: 'api', task: 't1-ok-20260101', session: 'ses_a', pid: 999999999, startedAt: now },
    { port: freePort + 40, service: 'gw', task: 'ghost-task-20260101', session: 'ses_a', pid: process.pid, startedAt: now },
    { port: freePort + 40, service: 'dup', task: 't1-ok-20260101', session: 'ses_a', pid: process.pid, startedAt: now },
  ] }));
  const d14bad = run(['doctor', 't1-ok-20260101'], repo);
  ok(d14bad.stdout.includes('⚠ I14') && d14bad.stdout.includes('重复'), 'I14 红：端口重复登记');
  ok(d14bad.stdout.includes('ℹ I14') && d14bad.stdout.includes('stale') && d14bad.stdout.includes('orphan'), 'I14 提示级：pid 死=stale / task 不在 index=orphan');
  fs.writeFileSync(svcFile, J({ services: [{ port: freePort + 11, service: 'web', task: 't1-ok-20260101', session: 'ses_a', pid: process.pid, startedAt: now }] }));
  ok(run(['doctor', 't1-ok-20260101'], repo).stdout.includes('✓ I14'), 'I14 绿：租约在册且全活');
  fs.writeFileSync(svcFile, '{ "services": "oops" }');
  const d14schema = run(['doctor', 't1-ok-20260101'], repo);
  ok(d14schema.stdout.includes('⚠ I14') && run(['svc', 'ls'], repo).status === 1, 'I14：schema 非法 → doctor 红 + svc ls 拒绝');
  fs.rmSync(svcFile);

  // ---- 2.29.0 加固：doctor 分层 / I15 幽灵目录 / svc 正交标注 / accept 状态门 / ownerAlive 双判据 / mech 生成安装 ----
  // repo2：独立沙箱（空项目 → 项目级检查必须仍执行）
  const repo2 = path.join(tmp, 'repo2');
  fs.mkdirSync(repo2, { recursive: true });
  sh('git init -q -b main && git config user.email t@t.local && git config user.name t && echo ".taskflow/" >> .git/info/exclude', repo2);
  sh('echo x > f.txt && git add -A && git commit -qm init', repo2);
  const td2 = path.join(repo2, '.taskflow');
  fs.mkdirSync(td2, { recursive: true });
  fs.writeFileSync(path.join(td2, 'project.json'), J({ key: 'sandbox/repo2', name: 'repo2', repoRoot: repo2, remote: null, git: true, createdAt: now, lastActiveAt: now }));
  fs.writeFileSync(path.join(td2, 'index.json'), J({ tasks: [] }));
  fs.writeFileSync(path.join(td2, 'services.json'), J({ services: [{ port: 45999, service: 'web', task: 'ghost-task-20260101', session: 'ses_x', pid: null, startedAt: now }] }));
  const d2empty = run(['doctor'], repo2);
  ok(d2empty.stdout.includes('I14') && d2empty.stdout.includes('orphan'), 'doctor 分层：空项目 + 遗留租约 → I14 仍体检（不再被提前退出吞掉）');
  ok(d2empty.stdout.includes('无任何任务档案'), 'doctor 分层：空档案文案保留');

  // I15：根层幽灵目录（有内容、无 task.json、不在 index）
  fs.mkdirSync(path.join(td2, 'ab-ghostshots-20260101'), { recursive: true });
  fs.writeFileSync(path.join(td2, 'ab-ghostshots-20260101', 'shot.png'), 'x');
  const d2i15 = run(['doctor'], repo2);
  ok(d2i15.stdout.includes('I15') && d2i15.stdout.includes('ab-ghostshots-20260101'), 'I15：幽灵目录点名（有内容无登记）');
  fs.mkdirSync(path.join(td2, 'decisions'), { recursive: true });
  ok(!run(['doctor'], repo2).stdout.includes('I15 幽灵目录 decisions'), 'I15：decisions/ 目录不误报（幽灵目录仍点名）');

  // svc ls 正交标注：pid 维度 × orphan 维度并列（复合态不再互斥）
  fs.writeFileSync(path.join(td2, 'services.json'), J({ services: [
    { port: 45998, service: 'a', task: 'ghost-task-20260101', session: 's', pid: null, startedAt: now },
    { port: 45997, service: 'b', task: 'ghost-task-20260101', session: 's', pid: 999999999, startedAt: now },
    { port: 45996, service: 'c', task: 'ghost-task-20260101', session: 's', pid: process.pid, startedAt: now },
  ] }));
  const svcOrtho = run(['svc', 'ls'], repo2);
  ok(svcOrtho.stdout.includes('[pid未登记·orphan'), 'svc ls 正交：无 pid 孤儿 = pid未登记·orphan');
  ok(svcOrtho.stdout.includes('[stale(pid死)·orphan'), 'svc ls 正交：死 pid 孤儿 = stale(pid死)·orphan');
  ok(svcOrtho.stdout.includes('[live·orphan'), 'svc ls 正交：活 pid 孤儿 = live·orphan');

  // ownerAlive 双判据：pid 活但 started_at 不符 → 复用嫌疑（不再假阳性「属主存活」）
  const wt6 = path.join(tmp, 'wt6');
  fs.mkdirSync(path.join(td2, 't6-verify-20260101'), { recursive: true });
  fs.writeFileSync(path.join(td2, 't6-verify-20260101', 'task.json'), J({
    id: 't6-verify-20260101', title: '等验收样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'verifying',
    branch: 'task/t6-verify-20260101', worktree: wt6, baseBranch: 'main', createdAt: now, lastActiveAt: now, sessionID: 'ses_f', checkpoints: [], subtasks: [],
  }));
  fs.writeFileSync(path.join(td2, 't6-verify-20260101', 'spec.md'), '# Spec\n\n## 验收标准\n\n- [ ] AC1 单测全绿\n');
  fs.mkdirSync(wt6, { recursive: true });
  fs.writeFileSync(path.join(wt6, '.owner.json'), J({ sessionID: 'ses_f', pid: process.pid, started_at: '2000-01-01T00:00:00+08:00' }));
  ok(run(['doctor'], repo2).stdout.includes('复用嫌疑'), 'I10 双判据：pid 活 + started_at 不符 → 复用嫌疑');
  fs.writeFileSync(path.join(wt6, '.owner.json'), J({ sessionID: 'ses_f', pid: process.pid }));
  ok(run(['doctor'], repo2).stdout.includes('✓ I10'), 'I10 双判据：无 started_at 凭证 → 降级旧语义（pid 活即活）');

  // accept 状态门：verifying 无警告 / 非 verifying 有状态标注（用 repo2 自建任务——主沙箱 t1 已被更早的 --pass 测试翻状态，禁依赖漂移态）
  const accV = run(['accept', 't6-verify-20260101'], repo2);
  ok(accV.status === 0 && !accV.stdout.includes('状态简报'), 'accept：verifying → 纯验收简报（无警告）');
  fs.mkdirSync(path.join(td2, 't7-active-20260101'), { recursive: true });
  fs.writeFileSync(path.join(td2, 't7-active-20260101', 'task.json'), J({
    id: 't7-active-20260101', title: '活跃样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'active',
    branch: null, worktree: null, baseBranch: 'main', createdAt: now, lastActiveAt: now, sessionID: 'ses_g', checkpoints: [], subtasks: [],
  }));
  fs.writeFileSync(path.join(td2, 't7-active-20260101', 'spec.md'), '# Spec\n\n## 验收标准\n\n- [ ] AC1 单测全绿\n');
  const accA = run(['accept', 't7-active-20260101'], repo2);
  ok(accA.status === 0 && accA.stdout.includes('状态简报，非验收简报'), 'accept：active → 头部状态警告');

  // mech：机制生成安装（技能资产 → 项目产物）+ 采纳对账
  const mechLs0 = run(['mech', 'ls'], repo2);
  ok(mechLs0.status === 0 && mechLs0.stdout.includes('决策组合门') && mechLs0.stdout.includes('可装'), 'mech ls：列出机制与采纳状态');
  const mechInst = run(['mech', 'install', '决策组合门'], repo2);
  const gate2 = path.join(repo2, 'scripts/harness/validate-decision-combo-gate.sh');
  ok(mechInst.status === 0 && fs.existsSync(gate2) && fs.readFileSync(gate2, 'utf8').includes('vue'), 'mech install：门脚本落位 + assetExts 注入');
  ok(fs.existsSync(path.join(repo2, 'docs/CHANGELOG.md')) && fs.readFileSync(path.join(repo2, 'docs/CHANGELOG.md'), 'utf8').includes('决策组合门落地'), 'mech install：CHANGELOG 建档 + 锚点条目');
  const conv2 = fs.readFileSync(path.join(td2, 'conventions.md'), 'utf8');
  ok(conv2.includes('决策组合门') && conv2.includes('validate-changelog'), 'mech install：conventions 补记');
  const pj2 = JSON.parse(fs.readFileSync(path.join(td2, 'project.json'), 'utf8'));
  ok(pj2.mechanisms && pj2.mechanisms['决策组合门'], 'mech install：project.json mechanisms 采纳登记');
  ok(run(['mech', 'ls'], repo2).stdout.includes('已装'), 'mech ls：安装后显示已装');
  const mechAgain = run(['mech', 'install', '决策组合门'], repo2);
  ok(mechAgain.status === 0 && mechAgain.stdout.includes('已安装'), 'mech install：幂等（重装提示不重复写）');
  // 采纳版本对账（2026-09-30 用户拍板「必须对比对账，不符立即提醒升级或安装」）：陈旧快照 doctor 红点名 + mech ls 落后 + 重装刷回（内容一致仅版本落后也不许早退）
  const pjP2v = path.join(td2, 'project.json');
  const pj2v = JSON.parse(fs.readFileSync(pjP2v, 'utf8'));
  pj2v.mechanisms['决策组合门'].version = '0.0.1';
  fs.writeFileSync(pjP2v, JSON.stringify(pj2v, null, 2) + '\n');
  const docStale = run(['doctor'], repo2);
  ok(docStale.status === 1 && /快照版本不符/.test(docStale.stdout) && /mech install 决策组合门/.test(docStale.stdout), 'doctor 采纳对账：登记版本 ≠ 技能版本 → 红 + 提醒 mech install 刷新');
  const lsStale = run(['mech', 'ls'], repo2);
  ok(/落后/.test(lsStale.stdout) && /0\.0\.1/.test(lsStale.stdout), 'mech ls：陈旧快照点名（落后 + 登记版本）');
  const mechRef = run(['mech', 'install', '决策组合门', '--yes'], repo2); // v2.65.0 确认闸：漂移刷新须显式 --yes（无 --yes 拒绝路归 v2.65.0 夹具块）
  const pj2r = JSON.parse(fs.readFileSync(pjP2v, 'utf8'));
  ok(mechRef.status === 0 && pj2r.mechanisms['决策组合门'].version !== '0.0.1' && /版本漂移/.test(mechRef.stdout), 'mech install 版本漂移刷新（--yes）：内容一致仅版本落后 → 不早退，登记刷回当前技能版本');
  const docFresh = run(['doctor'], repo2);
  ok(!/快照版本不符/.test(docFresh.stdout) && /采纳对齐：决策组合门/.test(docFresh.stdout), '刷新后 doctor 采纳对账转绿（版本一致）');
  // N5（2026-09-27 审查 B1 教训）：渲染产物必须真跑 bash——逐行 read 块解析 bug 曾让门恒放行
  fs.writeFileSync(path.join(td2, 'decisions', '2026-01-01-somewidget.md'), '# SomeWidget 决策\n\n- 影响范围：SomeWidget.vue\n');
  const cl2 = path.join(repo2, 'docs', 'CHANGELOG.md');
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 测试违规条目\n\n- 涉及文件：\`src/widgets/SomeWidget.vue\`\n- 做了什么：改动\n- commits：abc1234\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n`);
  const gBad = spawnSync('bash', [gate2], { cwd: repo2, encoding: 'utf8' });
  ok(gBad.status === 1 && /组合评估/.test(gBad.stdout + gBad.stderr), 'combo-gate 真跑：命中决策无「组合评估：」行 → exit 1（块解析可达）');
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 测试违规条目\n\n- 涉及文件：\`src/widgets/SomeWidget.vue\`\n- 做了什么：改动\n- commits：abc1234\n- 组合评估： 2026-01-01-somewidget（语义中性——测试）\n\n## 2026-01-02 — \`OtherWidget.vue\` 标题带反引号\n\n- 做了什么：标题含资产名\n- commits：def5678\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n`);
  const gGood = spawnSync('bash', [gate2], { cwd: repo2, encoding: 'utf8' });
  ok(gGood.status === 0 && gGood.stdout.includes('合规'), 'combo-gate 真跑：补组合评估行 → exit 0；标题行反引号不误报（token 只取正文）');
  // N6（2026-09-27 部署实证）：合规条目为受管区**末块**时，while 体末语句 `[ -n "$MISS" ] && {…}` 返回 1
  // → set -e 下成功路径静默 exit 1（上例末块走 continue 状态 0 掩盖）；模板已 if 化，夹具补三态
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 合规末块\n\n- 涉及文件：\`src/widgets/SomeWidget.vue\`\n- 做了什么：改动\n- commits：abc1234\n- 组合评估： 2026-01-01-somewidget（语义中性——测试）\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n`);
  const gLast = spawnSync('bash', [gate2], { cwd: repo2, encoding: 'utf8' });
  ok(gLast.status === 0 && gLast.stdout.includes('合规'), 'combo-gate 真跑：合规条目为末块 → exit 0（set-e while 末状态坑回归锁）');
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 缺 stem 末块\n\n- 涉及文件：\`src/widgets/SomeWidget.vue\`\n- 做了什么：改动\n- commits：abc1234\n- 组合评估： 别的决策（语义中性——测试）\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n`);
  const gStem = spawnSync('bash', [gate2], { cwd: repo2, encoding: 'utf8' });
  ok(gStem.status === 1 && /列缺命中决策/.test(gStem.stdout + gStem.stderr), 'combo-gate 真跑：组合评估行列缺命中 stem → exit 1');
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 测试违规条目\n\n- 涉及文件：\`src/widgets/SomeWidget.vue\`\n- 做了什么：改动\n- commits：abc1234\n- 组合评估： 2026-01-01-somewidget（语义中性——测试）\n\n## 2026-01-02 — \`OtherWidget.vue\` 标题带反引号\n\n- 做了什么：标题含资产名\n- commits：def5678\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n`);
  const cGood = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cGood.status === 0, 'validate-changelog 真跑：格式/字段/串接门全过');
  // ---- v2.49.0 CLASS_SWEEP_GATE（硬规则 25）：validate-changelog 同类排查检查（条目级，对抗加固后红绿 + 两攻击回归）----
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 修复条目\n\n- 涉及文件：\`src/x.ts\`\n- 做了什么：修复的 bug 演示（出现次数 1）\n- commits：abc1234\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n`);
  const cSweepRed = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cSweepRed.status === 1 && /同类排查/.test(cSweepRed.stdout + cSweepRed.stderr), 'CLASS_SWEEP_GATE 红路：修复条目块内无「同类排查：」行 → exit 1 点名（渲染产物真跑）');
  // 攻击回归①（变体绕过）：「修复的bug」无空格 / 「修复缺陷」原文件级 grep 全漏 → 条目级触发词捕获
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — A\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：修复的bug 演示\n- commits：aaa1111\n\n## 2026-01-02 — B\n\n- 涉及文件：\`src/b.ts\`\n- 做了什么：修复缺陷演示\n- commits：bbb2222\n`);
  const cVar = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cVar.status === 1 && /同类排查/.test(cVar.stdout + cVar.stderr) && /— A/.test(cVar.stdout + cVar.stderr) && /— B/.test(cVar.stdout + cVar.stderr), 'CLASS_SWEEP_GATE 攻击回归①：触发词变体（修复的bug 无空格/修复缺陷）逐条目捕获——原文件级 grep 绕过封死');
  // 攻击回归②（跨条目泄漏）：条目一合规双行不能替条目二背书
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 好\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：改动\n- commits：aaa1111\n- 同类排查：唯一实例\n- 出现次数：1\n\n## 2026-01-02 — 坏\n\n- 涉及文件：\`src/b.ts\`\n- 做了什么：修复的 bug 演示\n- commits：bbb2222\n`);
  const cLeak = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cLeak.status === 1 && /— 坏/.test(cLeak.stdout + cLeak.stderr), 'CLASS_SWEEP_GATE 攻击回归②：跨条目泄漏封死——别条的合规行不再替违规条目背书');
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 修复条目\n\n- 涉及文件：\`src/x.ts\`\n- 做了什么：修复的 bug 演示\n- commits：abc1234\n- 同类排查：唯一实例（grep \`src/x.ts\` 全仓 1 处命中）\n- 出现次数：1\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n`);
  const cSweepGreen = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cSweepGreen.status === 0, 'CLASS_SWEEP_GATE 绿路：块内「同类排查：」+「出现次数」双行 → 门通过（条目级双要求）');
  // ---- v2.55.0 DOC_SYNC_GATE（硬规则 26）：文档同步行检查（延迟激活锚点 + 条目级红绿 + 未激活 WARN）----
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 功能条目\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：新功能\n- commits：aaa1111\n\n## 2026-01-02 — 文档同步门落地\n\n- 锚点\n`);
  const cDocRed = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cDocRed.status === 1 && /文档同步/.test(cDocRed.stdout + cDocRed.stderr), 'DOC_SYNC_GATE 红路：锚点激活后功能代码条目（src/a.ts）无「文档同步：」行 → exit 1 点名条目');
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 功能条目\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：新功能\n- commits：aaa1111\n- 文档同步：docs/prd/share/user-stories.md User-Story-02\n\n## 2026-01-02 — 文档同步门落地\n\n- 锚点\n`);
  const cDocGreen = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cDocGreen.status === 0, 'DOC_SYNC_GATE 绿路：功能条目含「文档同步：」行 → 通过（更新条目或不适用理由皆合法）');
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 功能条目\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：新功能\n- commits：aaa1111\n`);
  const cDocOff = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cDocOff.status === 0 && /文档同步门未激活/.test(cDocOff.stdout + cDocOff.stderr), 'DOC_SYNC_GATE 未激活：无锚点 → WARN 提示不阻断（存量项目升级零破坏，延迟激活语义）');
  // ---- v2.55.1 攻击回归：标题提及「文档同步」绕过（活体攻击演练实证：块内任意位置含字样可骗过整块匹配）----
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 模拟攻击：功能改动不写文档同步行\n\n- 涉及文件：\`backend/src/ShareService.java\`\n- 做了什么：改了分享行为\n- commits：deadbee\n\n## 2026-01-02 — 文档同步门落地\n\n- 锚点\n`);
  const cDocBypass = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cDocBypass.status === 1 && /文档同步/.test(cDocBypass.stdout + cDocBypass.stderr) && /模拟攻击/.test(cDocBypass.stdout + cDocBypass.stderr), 'DOC_SYNC_GATE 攻击回归：标题含「文档同步」字样不再绕过——须「文档同步：」成行（v2.55.1 行级匹配）');
  // 审查二轮 blocker 回归（对抗审查三个门缺陷）：
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 新条目\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：改动\n- commits：aaa1111\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n\n## 2026-01-01 — 历史条目\n\n- 涉及文件：\`src/old.ts\`\n- 做了什么：修复的 bug 旧账（无合规行）\n- commits：old1234\n`);
  const cGrand = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cGrand.status === 0, 'CLASS_SWEEP_GATE 审查二轮①：锚点之下祖父区历史条目豁免——升级后首跑不误红（与组合门同口径）');
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 1.2.3 — Bug Fixes 修复若干崩溃\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：修了\n- commits：aaa1111\n`);
  const cTitle = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cTitle.status === 1 && /同类排查/.test(cTitle.stdout + cTitle.stderr), 'CLASS_SWEEP_GATE 审查二轮②：触发词写在 ## 标题行（conventional Bug Fixes 风格）不再免检');
  const variants = ['修复 bug', 'bug fix', 'Bugfix', '热修复', 'hotfix', 'HOTFIX'];
  let allCaught = true; let vOut = '';
  for (const w of variants) {
    fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — X\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：${w} 演示\n- commits：aaa1111\n`);
    const r = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
    if (r.status !== 1) { allCaught = false; vOut += w + ' '; }
  }
  ok(allCaught, `CLASS_SWEEP_GATE 审查二轮③：词表七式全覆盖（修复 bug/bug fix/Bugfix/热修复/hotfix/HOTFIX${vOut ? '——漏：' + vOut : ''}，大小写不敏感）`);
  fs.rmSync(gate2);
  ok(run(['doctor'], repo2).stdout.includes('采纳漂移'), 'doctor 采纳对账：声明采纳但产物缺失 → ⚠');
  // v2.29.1 mech install tracked 产物落 cwd：在 worktree 内跑 → 落 worktree，主仓库检出区保持干净（铁律）
  const wt2 = path.join(tmp, 'repo2-wt');
  sh(`git worktree add -q -b task/wt2 "${wt2}" HEAD`, repo2);
  const mechWt = run(['mech', 'install', '决策组合门'], wt2);
  ok(mechWt.status === 0 && fs.existsSync(path.join(wt2, 'scripts', 'harness', 'validate-decision-combo-gate.sh')) && !fs.existsSync(path.join(repo2, 'scripts', 'harness', 'validate-decision-combo-gate.sh')), 'mech install 在 worktree 跑：tracked 产物落 worktree，主仓库零污染');
  ok(fs.existsSync(path.join(td2, 'conventions.md')), 'mech install 在 worktree 跑：.taskflow 类产物仍落主仓库 tasksDir');
  // ---- 2.30.0 DESIGN_SPEC_EXTRACT：原型规格表门（mech install + 真执行夹具，硬规则 17）----
  const dsgInst = run(['mech', 'install', 'DESIGN_SPEC_EXTRACT'], repo2);
  const dsgGate = path.join(repo2, 'scripts/harness/validate-design-spec-gate.sh');
  ok(dsgInst.status === 0 && fs.existsSync(dsgGate) && fs.existsSync(path.join(repo2, 'scripts/design/extract-spec.js')), 'DESIGN_SPEC_EXTRACT install：门脚本 + 提取器 extract-spec.js 落位');
  ok(fs.readFileSync(path.join(repo2, 'docs/CHANGELOG.md'), 'utf8').includes('规格表门落地'), 'DESIGN_SPEC_EXTRACT install：既有 CHANGELOG 补锚点（三 fallback 插入）');
  const pjD = JSON.parse(fs.readFileSync(path.join(td2, 'project.json'), 'utf8'));
  ok(pjD.mechanisms && pjD.mechanisms.DESIGN_SPEC_EXTRACT, 'DESIGN_SPEC_EXTRACT install：mechanisms 采纳登记');
  // 门真执行（生成≠可用）：降级 → 红/绿/红/绿矩阵 + 模式二
  const clD = path.join(repo2, 'docs/CHANGELOG.md');
  let dsg = spawnSync('bash', [dsgGate], { cwd: repo2, encoding: 'utf8' });
  ok(dsg.status === 0 && /无原型/.test(dsg.stdout + dsg.stderr), 'spec-gate 真跑：项目无原型 HTML → 降级通过');
  const protoDir = path.join(td2, 'dsx-20260101', 'design');
  fs.mkdirSync(protoDir, { recursive: true });
  fs.writeFileSync(path.join(protoDir, 'proto.html'), '<html></html>');
  fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-03 — 前端视觉改动\n\n- 涉及文件：`app/src/main/res/layout/item_card.xml`、`src/views/Card.vue`\n- 做了什么：改样式\n- commits：abc1234\n\n## 2026-01-02 — 规格表门落地\n\n- 锚点\n');
  dsg = spawnSync('bash', [dsgGate], { cwd: repo2, encoding: 'utf8' });
  ok(dsg.status === 1 && /规格表/.test(dsg.stdout + dsg.stderr), 'spec-gate 真跑：前端资产条目缺「规格表：」行 → exit 1（res/ 与 .vue 双触发）');
  fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-03 — 前端视觉改动\n\n- 涉及文件：`src/views/Card.vue`\n- 做了什么：改样式\n- commits：abc1234\n- 规格表：不适用——纯逻辑重构无视觉变更\n\n## 2026-01-02 — 规格表门落地\n\n- 锚点\n');
  dsg = spawnSync('bash', [dsgGate], { cwd: repo2, encoding: 'utf8' });
  ok(dsg.status === 0, 'spec-gate 真跑：「规格表：不适用——理由」廉价通道 → exit 0');
  fs.writeFileSync(path.join(protoDir, 'spec-extract.json'), '{"schema":"design-spec-extract/1"}');
  fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-03 — 前端视觉改动\n\n- 涉及文件：`src/views/Card.vue`\n- 做了什么：改样式\n- commits：abc1234\n- 规格表：`.taskflow/dsx-20260101/design/spec-extract.json`\n\n## 2026-01-02 — 规格表门落地\n\n- 锚点\n');
  dsg = spawnSync('bash', [dsgGate], { cwd: repo2, encoding: 'utf8' });
  ok(dsg.status === 0, 'spec-gate 真跑：有效 JSON（schema 头）挂链 → exit 0');
  fs.writeFileSync(path.join(protoDir, 'spec-extract.json'), '{"foo":1}');
  dsg = spawnSync('bash', [dsgGate], { cwd: repo2, encoding: 'utf8' });
  ok(dsg.status === 1 && /schema/.test(dsg.stdout + dsg.stderr), 'spec-gate 真跑：挂链 JSON 缺 schema 头 → exit 1');
  fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-03 — 后端逻辑\n\n- 涉及文件：`backend/Svc.kt`\n- 做了什么：逻辑\n- commits：abc1234\n\n## 2026-01-02 — 规格表门落地\n\n- 锚点\n');
  dsg = spawnSync('bash', [dsgGate], { cwd: repo2, encoding: 'utf8' });
  ok(dsg.status === 0, 'spec-gate 真跑：后端条目不触发');
  const specD = path.join(td2, 'dsx-20260101', 'spec.md');
  fs.writeFileSync(specD, '# Spec\n\n## 产物链\n\n| 产物 | 状态 | 住址 |\n| --- | --- | --- |\n| 原型 | 已拍板 | .taskflow/dsx-20260101/design/proto.html |\n');
  dsg = spawnSync('bash', [dsgGate, '--spec', specD], { cwd: repo2, encoding: 'utf8' });
  ok(dsg.status === 1, 'spec-gate 模式二：已拍板原型无规格表挂链 → exit 1');
  fs.writeFileSync(path.join(protoDir, 'spec-extract.json'), '{"schema":"design-spec-extract/1"}');
  fs.appendFileSync(specD, '| 原型规格表 | 已拍板 | .taskflow/dsx-20260101/design/spec-extract.json |\n');
  dsg = spawnSync('bash', [dsgGate, '--spec', specD], { cwd: repo2, encoding: 'utf8' });
  ok(dsg.status === 0, 'spec-gate 模式二：挂链有效 → exit 0');
  fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-03 — 前端视觉改动\n\n- 涉及文件：`src/views/Card.vue`\n- 做了什么：改样式\n- commits：abc1234\n- 规格表：`.taskflow/dsx-20260101/design/spec-extract.json`\n\n## 2026-01-02 — 规格表门落地\n\n- 锚点\n');
  const cDsg = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cDsg.status === 0 && cDsg.stdout.includes('原型规格表门'), 'validate-changelog 串接：spec-gate 收尾链通过');


  // ── STYLE_SOURCE_GATE 执行夹具（硬规则 17：渲染产物必须真实执行——违规非零/合法通过/未初始化降级）──
  {
    const ssgGate = path.join(repo2, 'scripts/harness/validate-style-source-gate.sh');
    fs.mkdirSync(path.join(repo2, 'docs/ui/style-source/prototype'), { recursive: true });
    fs.writeFileSync(path.join(repo2, 'docs/ui/style-source/STYLE_DECISIONS.md'), '# 样式拍板日志\n');
    fs.writeFileSync(path.join(repo2, 'docs/ui/style-source/prototype/design-v2.html'), '<html></html>');
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-03 — 违规条目\n\n- 涉及文件：`docs/ui/style-source/prototype/design-v2.html`\n\n## 2026-01-02 — 样式真源门落地\n\n- 锚点\n');
    let r = spawnSync('bash', [ssgGate], { cwd: repo2, encoding: 'utf8' });
    ok(r.status === 1, 'style-gate 真跑：改真源无「样式拍板」行 → exit 1');
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-03 — 合法条目\n\n- 涉及文件：`docs/ui/style-source/prototype/design-v2.html`\n- 样式拍板: 2026-01-03 白底蓝边→蓝实底（用户拍板，见 STYLE_DECISIONS.md）\n\n## 2026-01-02 — 样式真源门落地\n\n- 锚点\n');
    r = spawnSync('bash', [ssgGate], { cwd: repo2, encoding: 'utf8' });
    ok(r.status === 0, 'style-gate 真跑：带样式拍板行 → exit 0');
    fs.rmSync(path.join(repo2, 'docs/ui/style-source'), { recursive: true, force: true });
    r = spawnSync('bash', [ssgGate], { cwd: repo2, encoding: 'utf8' });
    ok(r.status === 0, 'style-gate 真跑：真源未初始化 → 延迟加载降级 exit 0');
  }
  // ---- 2.32.0 APP_PAGE_BASELINE：现状基线门（mech install + 真执行夹具 + 提取器 static 解析，硬规则 17/21）----
  {
    const abInst = run(['mech', 'install', 'APP_PAGE_BASELINE'], repo2);
    const abGate = path.join(repo2, 'scripts/harness/validate-app-baseline-gate.sh');
    ok(abInst.status === 0 && fs.existsSync(abGate) && fs.existsSync(path.join(repo2, 'scripts/design/extract-app-baseline.js')), 'APP_PAGE_BASELINE install：门脚本 + 提取器 extract-app-baseline.js 落位');
    ok(fs.readFileSync(clD, 'utf8').includes('现状基线门落地'), 'APP_PAGE_BASELINE install：既有 CHANGELOG 补锚点');
    const pjA = JSON.parse(fs.readFileSync(path.join(td2, 'project.json'), 'utf8'));
    ok(pjA.mechanisms && pjA.mechanisms.APP_PAGE_BASELINE, 'APP_PAGE_BASELINE install：mechanisms 采纳登记');
    // 门真执行矩阵（硬规则 17：生成≠可用）
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-04 — 前端视觉改动\n\n- 涉及文件：`app/src/main/res/layout/item_card.xml`\n- 做了什么：改样式\n- commits：abc1234\n\n## 2026-01-03 — 现状基线门落地\n\n- 锚点\n');
    let ab = spawnSync('bash', [abGate], { cwd: repo2, encoding: 'utf8' });
    ok(ab.status === 1 && /基线/.test(ab.stdout + ab.stderr), 'baseline-gate 真跑：前端资产条目缺「基线：」行 → exit 1');
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-04 — 前端视觉改动\n\n- 涉及文件：`app/src/main/res/layout/item_card.xml`\n- 做了什么：改样式\n- commits：abc1234\n- 基线：不适用——新增页面无现状可提\n\n## 2026-01-03 — 现状基线门落地\n\n- 锚点\n');
    ab = spawnSync('bash', [abGate], { cwd: repo2, encoding: 'utf8' });
    ok(ab.status === 0, 'baseline-gate 真跑：「基线：不适用——理由」廉价通道 → exit 0');
    const ablDir = path.join(td2, 'abl-20260101', 'design', 'baseline');
    fs.mkdirSync(ablDir, { recursive: true });
    fs.writeFileSync(path.join(ablDir, 'baseline-home.json'), '{"schema":"app-baseline/1"}');
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-04 — 前端视觉改动\n\n- 涉及文件：`app/src/main/res/layout/item_card.xml`\n- 做了什么：改样式\n- commits：abc1234\n- 基线：`.taskflow/abl-20260101/design/baseline/baseline-home.json`\n\n## 2026-01-03 — 现状基线门落地\n\n- 锚点\n');
    ab = spawnSync('bash', [abGate], { cwd: repo2, encoding: 'utf8' });
    ok(ab.status === 0, 'baseline-gate 真跑：有效 baseline JSON（schema 头）挂链 → exit 0');
    fs.writeFileSync(path.join(ablDir, 'baseline-home.json'), '{"foo":1}');
    ab = spawnSync('bash', [abGate], { cwd: repo2, encoding: 'utf8' });
    ok(ab.status === 1 && /schema/.test(ab.stdout + ab.stderr), 'baseline-gate 真跑：挂链 JSON 缺 schema 头 → exit 1');
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-04 — 后端逻辑\n\n- 涉及文件：`backend/Svc.kt`\n- 做了什么：逻辑\n- commits：abc1234\n\n## 2026-01-03 — 现状基线门落地\n\n- 锚点\n');
    ab = spawnSync('bash', [abGate], { cwd: repo2, encoding: 'utf8' });
    ok(ab.status === 0, 'baseline-gate 真跑：后端条目不触发');
    // --spec 模式：产物链完备性（原型已拍板 → 基线行必须在链且有效）
    const specA = path.join(td2, 'abl-20260101', 'spec.md');
    fs.writeFileSync(specA, '# Spec\n\n## 产物链\n\n| 产物 | 状态 | 住址 |\n| --- | --- | --- |\n| 原型 | 已拍板 | .taskflow/abl-20260101/design/proto.html |\n');
    ab = spawnSync('bash', [abGate, '--spec', specA], { cwd: repo2, encoding: 'utf8' });
    ok(ab.status === 1, 'baseline-gate 模式二：已拍板原型无「现状基线」产物链行 → exit 1');
    fs.writeFileSync(path.join(ablDir, 'baseline-home.json'), '{"schema":"app-baseline/1"}');
    fs.appendFileSync(specA, '| 现状基线 | 已提取 | .taskflow/abl-20260101/design/baseline/baseline-home.json |\n');
    ab = spawnSync('bash', [abGate, '--spec', specA], { cwd: repo2, encoding: 'utf8' });
    ok(ab.status === 0, 'baseline-gate 模式二：基线行已提取 + 有效 JSON → exit 0');
    fs.writeFileSync(specA, '# Spec\n\n## 产物链\n\n| 产物 | 状态 | 住址 |\n| --- | --- | --- |\n| 原型 | 已拍板 | .taskflow/abl-20260101/design/proto.html |\n| 现状基线 | 不适用 | |\n');
    ab = spawnSync('bash', [abGate, '--spec', specA], { cwd: repo2, encoding: 'utf8' });
    ok(ab.status === 1 && /不适用/.test(ab.stdout + ab.stderr), 'baseline-gate 模式二：基线行「不适用」缺理由 → exit 1');
    // 提取器 static 真跑：布局 XML + values 双主题解析
    const abRes = path.join(tmp, 'abres');
    fs.mkdirSync(path.join(abRes, 'layout'), { recursive: true });
    fs.mkdirSync(path.join(abRes, 'values'), { recursive: true });
    fs.mkdirSync(path.join(abRes, 'values-night'), { recursive: true });
    fs.writeFileSync(path.join(abRes, 'layout', 'activity_home.xml'),
      '<?xml version="1.0"?>\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n  android:layout_width="match_parent" android:layout_height="wrap_content"\n  android:orientation="vertical" android:background="@color/surface" android:padding="16dp">\n  <TextView android:id="@+id/title" android:layout_width="wrap_content" android:layout_height="wrap_content"\n    android:text="@string/app_title" android:textSize="@dimen/title_size" android:textColor="@color/primary_text" />\n  <Button android:id="@+id/reuse" android:layout_width="wrap_content" android:layout_height="48dp"\n    android:background="@drawable/bg_card" android:textColor="@color/on_ink" />\n</LinearLayout>\n');
    fs.writeFileSync(path.join(abRes, 'values', 'colors.xml'), '<?xml version="1.0"?>\n<resources>\n  <color name="primary_text">#FF111111</color>\n  <color name="surface">#FFF4F6FA</color>\n  <color name="on_ink">#FFFFFFFF</color>\n</resources>\n');
    fs.writeFileSync(path.join(abRes, 'values-night', 'colors.xml'), '<?xml version="1.0"?>\n<resources>\n  <color name="primary_text">#FFE6EAF2</color>\n  <color name="surface">#FF0F1420</color>\n  <color name="on_ink">#FF10151F</color>\n</resources>\n');
    fs.writeFileSync(path.join(abRes, 'values', 'dimens.xml'), '<?xml version="1.0"?>\n<resources>\n  <dimen name="title_size">15.5sp</dimen>\n</resources>\n');
    fs.writeFileSync(path.join(abRes, 'values', 'strings.xml'), '<?xml version="1.0"?>\n<resources>\n  <string name="app_title">测试应用</string>\n</resources>\n');
    const abOut = path.join(tmp, 'ab-baseline.json');
    const ex = spawnSync('node', [path.join(repo2, 'scripts/design/extract-app-baseline.js'),
      '--mode', 'static', '--layouts', path.join(abRes, 'layout', 'activity_home.xml'),
      '--values', [path.join(abRes, 'values'), path.join(abRes, 'values-night')].join(','),
      '--out', abOut], { encoding: 'utf8' });
    ok(ex.status === 0, 'extract-app-baseline static：真跑 exit 0（' + (ex.stderr || '').slice(0, 200) + '）');
    const bl = JSON.parse(fs.readFileSync(abOut, 'utf8'));
    const rootN = bl.roots && bl.roots[0] && bl.roots[0].tree;
    const titleN = rootN && rootN.children && rootN.children[0];
    const btnN = rootN && rootN.children && rootN.children[1];
    ok(bl.schema === 'app-baseline/1', 'extract-app-baseline static：schema 头');
    ok(rootN && rootN.tag === 'LinearLayout' && Array.isArray(rootN.children) && rootN.children.length === 2, 'extract-app-baseline static：DOM 结构树（父子/顺序）');
    ok(titleN && titleN.id === 'title' && titleN.styles && titleN.styles.text === '测试应用', 'extract-app-baseline static：@string 解析');
    ok(titleN && titleN.styles && titleN.styles.textSize && titleN.styles.textSize.day === '15.5sp', 'extract-app-baseline static：@dimen 解析');
    ok(titleN && titleN.styles && titleN.styles.textColor && titleN.styles.textColor.day === '#FF111111' && titleN.styles.textColor.night === '#FFE6EAF2', 'extract-app-baseline static：@color 双主题解析（day/night）');
    ok(rootN && rootN.styles && rootN.styles.background && rootN.styles.background.day === '#FFF4F6FA' && rootN.styles.background.night === '#FF0F1420', 'extract-app-baseline static：根节点背景双主题解析');
    ok(btnN && btnN.styles && btnN.styles.background && btnN.styles.background.ref === '@drawable/bg_card', 'extract-app-baseline static：@drawable 引用保留（不可解析为值时保 ref）');
    // validate-changelog 串接（本机制门入收尾链）
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-04 — 前端视觉改动\n\n- 涉及文件：`src/views/Card.vue`\n- 做了什么：改样式\n- commits：abc1234\n- 规格表：`.taskflow/dsx-20260101/design/spec-extract.json`\n- 基线：`.taskflow/abl-20260101/design/baseline/baseline-home.json`\n\n## 2026-01-03 — 现状基线门落地\n\n- 锚点\n\n## 2026-01-02 — 规格表门落地\n\n- 锚点\n');
    const cAb = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
    // 审查修复回归（2026-09-27 对抗审查 P1/P2/P5/P6）：无 --values 不崩、CDATA/styled string、属性值合法 >、web schema 过门
    const abOut2 = path.join(tmp, 'ab-baseline-novalues.json');
    const ex2 = spawnSync('node', [path.join(repo2, 'scripts/design/extract-app-baseline.js'),
      '--mode', 'static', '--layouts', path.join(abRes, 'layout', 'activity_home.xml'),
      '--out', abOut2], { encoding: 'utf8' });
    ok(ex2.status === 0, 'extract-app-baseline static：无 --values 遇 @ref 不崩（保引用，审查 P1）');
    const bl2 = JSON.parse(fs.readFileSync(abOut2, 'utf8'));
    const r2 = bl2.roots[0].tree;
    ok(r2.styles.background && r2.styles.background.ref === '@color/surface', 'extract-app-baseline static：无 --values 时 @color 保引用');
    fs.writeFileSync(path.join(abRes, 'values', 'strings.xml'), '<?xml version="1.0"?>\n<resources>\n  <string name="app_title">测试应用</string>\n  <string name="cdata_title"><![CDATA[含<尖括号>标题]]></string>\n  <string name="styled_title">前缀 <b>加粗</b> 后缀</string>\n</resources>\n');
    fs.writeFileSync(path.join(abRes, 'layout', 'edge.xml'),
      '<?xml version="1.0"?>\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="wrap_content">\n  <TextView android:id="@+id/cdata" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="@string/cdata_title" />\n  <TextView android:id="@+id/styled" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="@string/styled_title" />\n  <TextView android:id="@+id/gt" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="prev -> next" />\n</LinearLayout>\n');
    const abOut3 = path.join(tmp, 'ab-baseline-edge.json');
    const ex3 = spawnSync('node', [path.join(repo2, 'scripts/design/extract-app-baseline.js'),
      '--mode', 'static', '--layouts', path.join(abRes, 'layout', 'edge.xml'),
      '--values', path.join(abRes, 'values'), '--out', abOut3], { encoding: 'utf8' });
    ok(ex3.status === 0, 'extract-app-baseline static：CDATA/styled/含> 属性布局真跑 exit 0');
    const bl3 = JSON.parse(fs.readFileSync(abOut3, 'utf8'));
    const e3 = bl3.roots[0].tree.children;
    ok(e3[0].styles.text === '含<尖括号>标题', 'extract-app-baseline static：CDATA 字符串完整解析（审查 P5）');
    ok(e3[1].styles.text === '前缀 加粗 后缀', 'extract-app-baseline static：styled string 子 run 拼全（审查 P5）');
    ok(e3[2].styles.text && e3[2].styles.text.day === 'prev -> next', 'extract-app-baseline static：属性值合法未转义 > 不截断（审查 P6；字面量在 values 上下文 = {day}）');
    fs.writeFileSync(path.join(ablDir, 'baseline-web.json'), '{"schema":"design-spec-extract/1"}');
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-05 — web 页改动\n\n- 涉及文件：`src/views/Card.vue`\n- 做了什么：改样式\n- commits：abc1234\n- 基线：`.taskflow/abl-20260101/design/baseline/baseline-web.json`\n\n## 2026-01-03 — 现状基线门落地\n\n- 锚点\n');
    ab = spawnSync('bash', [abGate], { cwd: repo2, encoding: 'utf8' });
    ok(ab.status === 0, 'baseline-gate 真跑：web 腿基线（design-spec-extract/1 schema）过门（审查 P2）');
    ok(cAb.status === 0 && cAb.stdout.includes('现状基线门'), 'validate-changelog 串接：baseline-gate 收尾链通过');
    // mechCmd 锚点插入 hotfix 回归（pl5android2 实证）：无 `# CHANGELOG` 头、`##` 条目开头的 CHANGELOG——锚点顶置，不得插进首条目内部
    fs.writeFileSync(clD, '## 2026-01-06 — 既有条目\n\n- 做了什么：x\n- commits：abc1234\n');
    const pjP2 = path.join(td2, 'project.json');
    const pj2b = JSON.parse(fs.readFileSync(pjP2, 'utf8'));
    delete pj2b.mechanisms.APP_PAGE_BASELINE; // 注销采纳——绕开幂等早退，走锚点插入路径
    fs.writeFileSync(pjP2, JSON.stringify(pj2b, null, 2) + '\n');
    const abRe = run(['mech', 'install', 'APP_PAGE_BASELINE'], repo2);
    const clTxt = fs.readFileSync(clD, 'utf8');
    ok(abRe.status === 0 && /^## [^\n]*现状基线门落地\n\n- 门锚点[^\n]*\n\n?## 2026-01-06 — 既有条目\n\n- 做了什么/.test(clTxt), 'mechCmd 锚点插入 hotfix：## 开头无 h1 的 CHANGELOG → 锚点顶置在首条目之前（旧正则把锚点插进首条目内部）');
  }

  // ---- DEPLOY_GATE：preflight 真跑（--state-file 本地基线，不依赖 ssh）----
  const dpScript = new URL('../assets/harness/deploy-preflight.mjs', import.meta.url).pathname;
  const dpRun = (dpArgs) => spawnSync('node', [dpScript, ...dpArgs], { cwd: repo, encoding: 'utf8' });
  const mainSha = execFileSync('git', ['-C', repo, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  const stateOk = path.join(tmp, 'live-ok.json');
  fs.writeFileSync(stateOk, JSON.stringify({ schema: 'live-deploy-state/1', jar: { commit: mainSha, version: '0.0.0', branch: 'main' } }));
  const dpPass = dpRun(['--branch', 'main', '--state-file', stateOk]);
  ok(dpPass.status === 0 && /血统门/.test(dpPass.stdout), 'deploy-preflight 真跑：线上基线 ⊆ 部署分支 → 0（血统门过）');
  const stateBad = path.join(tmp, 'live-bad.json');
  fs.writeFileSync(stateBad, JSON.stringify({ schema: 'live-deploy-state/1', jar: { commit: 'f'.repeat(40), version: '0.0.0', branch: 'elsewhere' } }));
  const dpFail = dpRun(['--branch', 'main', '--state-file', stateBad]);
  ok(dpFail.status === 1 && /血统门/.test(dpFail.stdout + dpFail.stderr), 'deploy-preflight 真跑：基线不在分支血统 → 1（并集优先拦截）');
  // ---- DEPLOY_ENTRY（v2.42.0）：deploy 唯一入口真跑（fixture 模拟已装项目）----
  const depNoCfg = run(['deploy', '--branch', 'main'], repo);
  ok(depNoCfg.status === 1 && /缺 deploy 配置/.test(depNoCfg.stdout), 'deploy：无 project.json deploy 配置 → 拒绝 + 配置模板（不装即拒）');
  fs.mkdirSync(path.join(repo, 'scripts', 'harness'), { recursive: true });
  fs.copyFileSync(new URL('../assets/harness/deploy-preflight.mjs', import.meta.url).pathname, path.join(repo, 'scripts', 'harness', 'deploy-preflight.mjs'));
  const pjPath = path.join(tasksDir, 'project.json');
  const pjDeploy = fs.existsSync(pjPath) ? JSON.parse(fs.readFileSync(pjPath, 'utf8')) : {};
  pjDeploy.deploy = { server: '127.0.0.1', statePath: '/tmp/live.json', jarPath: path.join(tmp, 'fake.jar'), commands: [`echo deployed-ok > ${tmp}/deployed.txt`] };
  fs.writeFileSync(path.join(tasksDir, 'project.json'), JSON.stringify(pjDeploy, null, 2) + '\n');
  const stateOk2 = path.join(tmp, 'live-ok2.json');
  fs.writeFileSync(stateOk2, JSON.stringify({ schema: 'live-deploy-state/1', jar: { commit: mainSha, version: '0.0.0', branch: 'main' } }));
  const depDry = run(['deploy', '--branch', 'main', '--dry-run', '--state-file', stateOk2], repo);
  ok(depDry.status === 0 && /dry-run：门禁绿/.test(depDry.stdout) && !fs.existsSync(path.join(tmp, 'deployed.txt')), 'deploy dry-run：门禁绿打印命令清单，不执行（双包事故形态防回归）');
  const depBad = run(['deploy', '--branch', 'task/t9-none', '--state-file', stateBad], repo);
  ok(depBad.status === 1 && /拒绝部署/.test(depBad.stdout), 'deploy：预检红 → 拒绝执行（门禁内嵌，物理跳不过）');
  const depGo = run(['deploy', '--branch', 'main', '--state-file', stateOk2], repo);
  ok(depGo.status === 0 && fs.readFileSync(path.join(tmp, 'deployed.txt'), 'utf8').includes('deployed-ok'), 'deploy 实跑：门禁绿 → 按配置执行命令（产物落地）');
  ok(/人工补跑 deploy-preflight --record/.test(depGo.stdout), 'deploy 登记：ssh 不可达（fixture 无服务器）→ 降级人工补跑提示（不登记=I17 必红不留暗道）');

  // ---- I16 敞口 + ls 标记 + accept 收口提醒（v2.42.0，双包事故当考题）----
  const t9wt = path.join(tmp, 't9-wt');
  sh(`git worktree add -q -b task/t9-exp-20260101 ${t9wt}`, repo);
  fs.writeFileSync(path.join(t9wt, 'f9.txt'), 'x\n');
  sh('git add -A && git commit -qm "c9: 挂账"', t9wt);
  fs.mkdirSync(path.join(tasksDir, 't9-exp-20260101'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 't9-exp-20260101', 'task.json'), J({
    id: 't9-exp-20260101', title: '敞口样例', goal: 'g', tier: 'small', anchor: 'managed', status: 'verifying',
    branch: 'task/t9-exp-20260101', worktree: t9wt, baseBranch: 'main', createdAt: now, lastActiveAt: now, sessionID: 'ses_g',
    deploy: { status: 'verifying', deployedAt: '2026-01-01T00:00:00+08:00', version: '0.9.9' },
    checkpoints: [{ ts: now, commit: execFileSync('git', ['-C', t9wt, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim(), summary: 'c9', files: ['f9.txt'] }],
    subtasks: [],
  }));
  fs.writeFileSync(path.join(tasksDir, 'index.json'), J({ tasks: [...(JSON.parse(fs.readFileSync(path.join(tasksDir, 'index.json'), 'utf8')).tasks), { id: 't9-exp-20260101', title: '敞口样例', status: 'verifying', tier: 'small', branch: 'task/t9-exp-20260101', worktree: t9wt, sessionID: 'ses_g', createdAt: now, lastActiveAt: now }] }));
  const doc16 = run(['doctor'], repo);
  ok(/⚠ I16 敞口：t9-exp-20260101 已部署\(0\.9\.9\)未合并 main/.test(doc16.stdout), 'doctor I16 红路：verifying 已部署未合并 main 超 24h → 敞口点名（静默敞口显式化）');
  ok(/I17 (ssh 不可达|无 project\.json deploy)/.test(doc16.stdout) || /ℹ I17/.test(doc16.stdout), 'doctor I17：ssh 不可达（fixture）→ 信息级跳过不误红（通用项目零误报）');
  const ls16 = run(['ls'], repo);
  ok(/t9-exp-20260101 .*⚠敞口[0-9]+天\(main一部署即滚回\)/.test(ls16.stdout), 'ls 待验收块：敞口任务带 ⚠敞口N天(main一部署即滚回) 标记');
  sh('git merge --no-ff -q task/t9-exp-20260101 -m "merge t9"', repo);
  const doc16b = run(['doctor', 't9-exp-20260101'], repo);
  ok(/✓ I16 已部署内容已进 main（敞口关闭）/.test(doc16b.stdout), 'doctor I16 绿路：分支并入 main → 敞口关闭（收口链终点判定）');
  const acc9 = run(['accept', 't9-exp-20260101', '--pass'], repo);
  ok(acc9.status === 0 && /立即三件事收敞口/.test(acc9.stdout) && /deploy --branch main/.test(acc9.stdout), 'accept --pass：deploy 在档 → 翻转成功即打印收口三件事（merge/重建替换包/登记）');
  const stateRec = path.join(tmp, 'live-rec.json');
  const dpRec = dpRun(['--record', '--state-file', stateRec, '--branch', 'main', '--commit', mainSha, '--jar-md5', 'a'.repeat(32), '--version', '0.0.1']);
  const dpRe = dpRun(['--branch', 'main', '--state-file', stateRec]);
  ok(dpRec.status === 0 && /live-state 已登记/.test(dpRec.stdout) && dpRe.status === 0, 'deploy-preflight --record：登记后复检闭环（基线登记=部署收尾硬门）');
  // ---- DEPLOY_GATE 加固（2.40.0）：实况核验 / record 对称 / 让位机械化 / git-common-dir 定位 ----
  const md5Of = (p) => createHash('md5').update(fs.readFileSync(p)).digest('hex');
  // 实况核验绿路：record 带 --jar-path（state-file 模式=本地文件）→ 复检 0 且核验语在案
  const jarF = path.join(tmp, 'live-app.jar');
  fs.writeFileSync(jarF, 'jar-bytes-v1');
  const stateV = path.join(tmp, 'live-verify.json');
  const v1md5 = md5Of(jarF);
  const dpRecV = dpRun(['--record', '--state-file', stateV, '--branch', 'main', '--commit', mainSha, '--jar-md5', v1md5, '--version', '0.0.2', '--jar-path', jarF]);
  const dpVerOk = dpRun(['--branch', 'main', '--state-file', stateV]);
  ok(dpRecV.status === 0 && dpVerOk.status === 0 && /实况核验/.test(dpVerOk.stdout) && /一致/.test(dpVerOk.stdout), '实况核验绿路：md5 实测一致 → 0（--jar-path 登记启用核验）');
  // 实况核验红路：未登记部署改了实际 jar → md5 不符必红（治「B 不登记、C 含旧基线照常绿、B 被静默滚回」）
  fs.writeFileSync(jarF, 'jar-bytes-v2-tampered');
  const dpVerBad = dpRun(['--branch', 'main', '--state-file', stateV]);
  ok(dpVerBad.status === 1 && /实况核验/.test(dpVerBad.stdout + dpVerBad.stderr) && /≠/.test(dpVerBad.stdout + dpVerBad.stderr), '实况核验红路：实测 md5 ≠ 基线 → 1（未登记部署必红，假部署探测面）');
  // 向后兼容：基线无 jar.path/md5 → 信息级跳过不误红
  const dpNoPath = dpRun(['--branch', 'main', '--state-file', stateOk]);
  ok(dpNoPath.status === 0 && /实况核验/.test(dpNoPath.stdout) && /跳过/.test(dpNoPath.stdout), '实况核验未启用（基线无 jar.path）→ 信息级跳过不误红（向后兼容）');
  // --record --web-only：jar 沿用基线（登记对称，消手抄污染面）；无基线 → 拒
  const dpW = dpRun(['--record', '--state-file', stateV, '--web-only', '--web-version', 'web-9', '--web-fp', 'fp-9']);
  const wState = JSON.parse(fs.readFileSync(stateV, 'utf8'));
  ok(dpW.status === 0 && wState.jar.commit === mainSha && wState.jar.md5 === v1md5 && wState.jar.version === '0.0.2' && wState.web.version === 'web-9' && /web-only/.test(wState.web.note), '--record --web-only：jar 沿用基线原值、web 更新、note 标注（登记对称）');
  const dpW0 = dpRun(['--record', '--state-file', path.join(tmp, 'live-none.json'), '--web-only', '--web-version', 'w']);
  ok(dpW0.status === 1, '--record --web-only 无基线可沿用 → 1（首次登记须全量四件套）');
  // record 缺参 → 1 报缺参名
  const dpMiss = dpRun(['--record', '--state-file', stateV, '--branch', 'main']);
  ok(dpMiss.status === 1 && /缺参数/.test(dpMiss.stderr + dpMiss.stdout), '--record 缺参 → 1 报缺参名（边界值）');

  // verifying 让位机械化（独立 vrepo，不污染主 fixture；「撞号覆盖验收窗口」事故回归）
  const vrepo = path.join(tmp, 'vrepo');
  fs.mkdirSync(vrepo, { recursive: true });
  sh('git init -q -b main && git config user.email t@t && git config user.name t', vrepo);
  fs.writeFileSync(path.join(vrepo, 'v.txt'), 'v\n');
  sh('git add -A && git commit -qm init', vrepo);
  sh('git checkout -qb task/ver-old-20260101 && echo x > x.txt && git add -A && git commit -qm "verifying task work"', vrepo);
  sh('git checkout -q main', vrepo);
  const vMain = execFileSync('git', ['-C', vrepo, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  fs.mkdirSync(path.join(vrepo, '.taskflow', 'ver-task-20260101'), { recursive: true });
  const verTj = (b) => J({ id: 'ver-task-20260101', title: '验收中任务', goal: 'g', tier: 'small', anchor: 'managed', status: 'verifying', branch: b, createdAt: now, lastActiveAt: now, sessionID: 'ses_v' });
  fs.writeFileSync(path.join(vrepo, '.taskflow', 'ver-task-20260101', 'task.json'), verTj('task/ver-old-20260101'));
  fs.writeFileSync(path.join(vrepo, '.taskflow', 'index.json'), J({ tasks: [{ id: 'ver-task-20260101', title: '验收中任务', status: 'verifying', tier: 'small', branch: 'task/ver-old-20260101' }] }));
  const vState = path.join(tmp, 'live-v.json'); // jar.path 指向不存在文件：state-file 模式=信息级跳过，隔离实况核验变量
  fs.writeFileSync(vState, JSON.stringify({ schema: 'live-deploy-state/1', jar: { commit: vMain, version: '0.0.0', branch: 'main', md5: '0'.repeat(32), path: path.join(tmp, 'no-such.jar') } }));
  const dpRunV = (a) => spawnSync('node', [dpScript, ...a], { cwd: vrepo, encoding: 'utf8' });
  const dpYield = dpRunV(['--branch', 'main', '--state-file', vState]);
  ok(dpYield.status === 1 && /验收窗口/.test(dpYield.stdout + dpYield.stderr), 'verifying 让位机械化：验收中任务分支 ⊄ 部署分支 → 1（撞号场景回归）');
  sh('git merge -q --no-ff task/ver-old-20260101 -m union', vrepo); // 并集：部署分支并入验收中任务分支
  const dpUnion = dpRunV(['--branch', 'main', '--state-file', vState]);
  ok(dpUnion.status === 0 && /验收窗口任务/.test(dpUnion.stdout), 'verifying 并集绿路：分支 ⊆ 部署分支 → 0（本体/并集豁免）');
  // git-common-dir 定位：任务 worktree 内跑也能取到主仓库 .taskflow（旧 --show-toplevel 会静默跳过）
  const vwt = path.join(tmp, 'v-wt');
  sh(`git worktree add -q -b task/wt-run-20260101 ${vwt}`, vrepo);
  const dpWt = spawnSync('node', [dpScript, '--branch', 'main', '--state-file', vState], { cwd: vwt, encoding: 'utf8' });
  ok(dpWt.status === 0 && /验收窗口任务/.test(dpWt.stdout), 'worktree 内跑预检：git-common-dir 定位主仓库 .taskflow（verifying 清单可得，非静默跳过）');
  // 分支引用缺失 → 信息级不拦（已合并删除不误拦）
  fs.writeFileSync(path.join(vrepo, '.taskflow', 'ver-task-20260101', 'task.json'), verTj('task/gone-20260101'));
  const dpGone = dpRunV(['--branch', 'main', '--state-file', vState]);
  ok(dpGone.status === 0 && /引用不可得/.test(dpGone.stdout), 'verifying 分支引用缺失 → 信息级不拦（已合并删除不误拦）');

  // ---- v2.62.0 凭证门上游化：preflight ④构建源凭证在位 + ③进程清点 opt-in 化 + credential-probe 探针资产（夹具真跑，硬规则 17）----
  const credRepo = path.join(tmp, 'credrepo');
  fs.mkdirSync(credRepo, { recursive: true });
  sh('git init -q -b main && git config user.email t@t && git config user.name t', credRepo);
  fs.writeFileSync(path.join(credRepo, 'c.txt'), 'c\n');
  sh('git add -A && git commit -qm init', credRepo);
  const credMain = execFileSync('git', ['-C', credRepo, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  fs.mkdirSync(path.join(credRepo, 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(credRepo, 'deploy', 'frontend-credentials.json'), JSON.stringify({ keys: [{ name: 'VITE_FIXTURE_A', chunkHint: 'LoginView' }, { name: 'VITE_FIXTURE_B' }] }) + '\n');
  fs.mkdirSync(path.join(credRepo, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(credRepo, 'frontend', '.env'), 'VITE_FIXTURE_A=fixture-a-value\nVITE_FIXTURE_B="fixture-b-value"\n');
  const credState = path.join(tmp, 'live-cred.json');
  fs.writeFileSync(credState, JSON.stringify({ schema: 'live-deploy-state/1', jar: { commit: credMain, version: '0.0.0', branch: 'main' } }));
  const dpRunC = (a) => spawnSync('node', [dpScript, ...a], { cwd: credRepo, encoding: 'utf8' });
  // ④ 绿路：清单在+env 全键 → 0（只报键数与 envPath，值零落输出）
  const dpCredOk = dpRunC(['--branch', 'main', '--state-file', credState]);
  ok(dpCredOk.status === 0 && /✓ 凭证门: 2 键在位（frontend\/\.env）/.test(dpCredOk.stdout), '凭证门④绿路：清单在+env 全键 → 0（v2.62.0 空包事故上游化）');
  ok(!/fixture-a-value/.test(dpCredOk.stdout + dpCredOk.stderr), '凭证门④铁律：凭证值零落输出（只报键名/键数）');
  // ④ 红路：env 缺键 → 1 且只点名键名
  fs.writeFileSync(path.join(credRepo, 'frontend', '.env'), 'VITE_FIXTURE_A=fixture-a-value\n');
  const dpCredBad = dpRunC(['--branch', 'main', '--state-file', credState]);
  ok(dpCredBad.status === 1 && /凭证门/.test(dpCredBad.stdout + dpCredBad.stderr) && /VITE_FIXTURE_B/.test(dpCredBad.stdout + dpCredBad.stderr) && !/fixture-a-value/.test(dpCredBad.stdout + dpCredBad.stderr), '凭证门④红路：缺键 → 1 只报键名（构建将内联空串=2026-10-14 事故同型）');
  // ④ 跳过路：清单不在 → 0 且 ℓ 显式可见（禁静默降级；非前端项目零负担）
  fs.rmSync(path.join(credRepo, 'deploy'), { recursive: true, force: true });
  const dpCredSkip = dpRunC(['--branch', 'main', '--state-file', credState]);
  ok(dpCredSkip.status === 0 && /ℓ 凭证门: 未配置清单/.test(dpCredSkip.stdout), '凭证门④跳过路：无清单 → 0+ℓ 显式可见（禁静默降级）');
  fs.mkdirSync(path.join(credRepo, 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(credRepo, 'deploy', 'frontend-credentials.json'), JSON.stringify({ keys: [{ name: 'VITE_FIXTURE_A', chunkHint: 'LoginView' }, { name: 'VITE_FIXTURE_B' }] }) + '\n');
  fs.writeFileSync(path.join(credRepo, 'frontend', '.env'), 'VITE_FIXTURE_A=fixture-a-value\nVITE_FIXTURE_B="fixture-b-value"\n');
  // ③ opt-in：无 --proc-probe → 信息级跳过（其他项目零误伤）；注入探针 → 行协议判定红/绿
  const dpNoProc = dpRunC(['--branch', 'main', '--state-file', credState]);
  ok(dpNoProc.status === 0 && /ℓ 进程清点: 未配置 --proc-probe/.test(dpNoProc.stdout), '进程清点③opt-in：无 --proc-probe → ℓ 跳过（v2.62.0 自项目侧定制上游化，其他项目零误伤）');
  const dpProcRed = dpRunC(['--branch', 'main', '--state-file', credState, '--proc-probe', 'echo "CONT web-1 old-sha 100"; echo "IMGLATEST new-sha"']);
  ok(dpProcRed.status === 1 && /进程清点/.test(dpProcRed.stdout + dpProcRed.stderr) && /旧镜像/.test(dpProcRed.stdout + dpProcRed.stderr), '进程清点③红路：容器镜像 ≠ latest 指针 → 1（--proc-probe 注入真跑行协议）');
  const dpProcGreen = dpRunC(['--branch', 'main', '--state-file', credState, '--proc-probe', 'echo "CONT app-1 new-sha 100"; echo "IMGLATEST new-sha"']);
  ok(dpProcGreen.status === 0 && /✓ 进程清点: 容器形态/.test(dpProcGreen.stdout), '进程清点③绿路：主服务容器在跑且镜像与 latest 指针一致 → 0');
  // deploy 入口 procProbe 透传：project.json deploy.procProbe → preflight --proc-probe（进程清点红=透传真实到达）
  pjDeploy.deploy.procProbe = 'echo "CONT web-1 old-sha 100"; echo "IMGLATEST new-sha"';
  fs.writeFileSync(path.join(tasksDir, 'project.json'), JSON.stringify(pjDeploy, null, 2) + '\n');
  const depProcBad = run(['deploy', '--branch', 'main', '--state-file', stateOk2, '--dry-run'], repo);
  ok(depProcBad.status === 1 && /拒绝部署/.test(depProcBad.stdout) && /进程清点/.test(depProcBad.stdout + depProcBad.stderr), 'deploy 入口 procProbe 透传：deploy.procProbe → --proc-probe（进程清点红=透传到达，G3 防呆回归）');
  delete pjDeploy.deploy.procProbe;
  fs.writeFileSync(path.join(tasksDir, 'project.json'), JSON.stringify(pjDeploy, null, 2) + '\n');
  // 探针三路（credential-probe 资产真跑：本地 http 静态服务夹具，curl 全链）
  const probeRoot = path.join(tmp, 'probe-site');
  fs.mkdirSync(path.join(probeRoot, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(probeRoot, 'index.html'), '<html><script src="/assets/index-abc.js"></script></html>\n');
  fs.writeFileSync(path.join(probeRoot, 'assets', 'index-abc.js'), 'import("./assets/login-def.js")\n');
  fs.writeFileSync(path.join(probeRoot, 'assets', 'login-def.js'), 'window.K="fixture-probe-value";\n');
  const srvPort = 45987;
  const servePath = path.join(tmp, 'credserve.mjs');
  fs.writeFileSync(servePath, [
    'import { createServer } from "node:http";',
    'import fs from "node:fs";',
    'import path from "node:path";',
    'const root = process.argv[2];',
    'createServer((req, res) => {',
    '  const p = path.join(root, req.url === "/" ? "index.html" : req.url.split("?")[0]);',
    '  fs.readFile(p, (err, data) => { if (err) { res.statusCode = 404; res.end("nf"); return; } res.end(data); });',
    `}).listen(${srvPort}, "127.0.0.1");`,
  ].join('\n'));
  const srvProc = spawn('node', [servePath, probeRoot], { stdio: 'ignore' });
  let srvUp = false;
  for (let i = 0; i < 50 && !srvUp; i++) { spawnSync('sleep', ['0.1']); srvUp = spawnSync('curl', ['-s', '-o', '/dev/null', `http://127.0.0.1:${srvPort}/`]).status === 0; }
  ok(srvUp, '凭证探针夹具：本地 http 静态服务就绪（探针走真 curl 全链）');
  fs.mkdirSync(path.join(repo2, 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(repo2, 'deploy', 'frontend-credentials.json'), JSON.stringify({ keys: [{ name: 'VITE_FIXTURE_P', chunkHint: 'login' }] }) + '\n');
  fs.mkdirSync(path.join(repo2, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(repo2, 'frontend', '.env'), 'VITE_FIXTURE_P=fixture-probe-value\n');
  const probeScript = path.join(repo2, 'scripts', 'harness', 'credential-probe.mjs');
  ok(fs.existsSync(probeScript), '凭证探针资产化：DEPLOY_GATE 双产物经 mech 渲染落位（credential-probe.mjs 在册自动渲染）');
  const probeRun = () => spawnSync('node', [probeScript, '--base-url', `http://127.0.0.1:${srvPort}`], { cwd: repo2, encoding: 'utf8' });
  const probeNoBase = spawnSync('node', [probeScript], { cwd: repo2, encoding: 'utf8' });
  ok(probeNoBase.status === 1 && /--base-url/.test(probeNoBase.stdout + probeNoBase.stderr), '凭证探针：--base-url 缺失 → 1 用法提示（线上入口属项目侧事实，模板零缺省）');
  const probeOk = probeRun();
  ok(probeOk.status === 0 && /✓ 线上凭证探针:1 键在位/.test(probeOk.stdout), '凭证探针绿路：chunk 命中值字面量 → 0（本地 http 夹具真跑）');
  fs.writeFileSync(path.join(repo2, 'frontend', '.env'), 'VITE_FIXTURE_P=fixture-red-value\n');
  const probeBad = probeRun();
  ok(probeBad.status === 1 && /凭证值缺失/.test(probeBad.stdout + probeBad.stderr) && /VITE_FIXTURE_P/.test(probeBad.stdout + probeBad.stderr) && !/fixture-probe-value/.test(probeBad.stdout + probeBad.stderr), '凭证探针红路：值不在任何 chunk → 1 只报键名（值零落输出）');
  fs.rmSync(path.join(repo2, 'deploy'), { recursive: true, force: true });
  const probeSkip = probeRun();
  ok(probeSkip.status === 0 && /ℓ 凭证探针: 项目未配置凭证清单/.test(probeSkip.stdout), '凭证探针跳过路：无清单 → 0+ℓ 显式可见（非前端项目零负担）');
  fs.rmSync(path.join(repo2, 'frontend'), { recursive: true, force: true });
  srvProc.kill();

  // lint 第 9 项版本一致性（夹具真跑红/绿两路——机制产物执行夹具，硬规则 17）
  const skillRoot = path.resolve(path.dirname(script), '..');
  const lintRoot = path.join(tmp, 'lint-copy');
  fs.cpSync(skillRoot, lintRoot, { recursive: true, filter: (s) => !/\/\.git(\/|$)/.test(s) });
  // 自含夹具：CHANGELOG.md 属 gitignore 本地文件，fresh clone 检出不带——缺则按 SKILL frontmatter 版本生成最小顶条目，保 lint 第 9 项红/绿两路在任何检出形态可达（硬规则 17）
  const lintCl = path.join(lintRoot, 'CHANGELOG.md');
  if (!fs.existsSync(lintCl)) {
    const fixtureVer = fs.readFileSync(path.join(lintRoot, 'SKILL.md'), 'utf8').match(/^version:\s*(\S+)/m)[1];
    fs.writeFileSync(lintCl, `# CHANGELOG\n\n## ${fixtureVer} — 夹具顶条目\n\n- 本条由 tf.test.mjs 生成（lint 版本一致性检查依赖顶条目）\n`);
  }
  const lintRun = () => spawnSync('node', [path.join(lintRoot, 'scripts', 'tf.mjs'), 'lint', '--root', lintRoot], { encoding: 'utf8' });
  ok(lintRun().status === 0, 'lint 版本一致性绿路：副本版本对齐 → 0');
  const skillP2 = path.join(lintRoot, 'SKILL.md');
  fs.writeFileSync(skillP2, fs.readFileSync(skillP2, 'utf8').replace(/^version: .*/m, 'version: 9.9.9'));
  const lpBad = lintRun();
  ok(lpBad.status === 1 && /版本不一致/.test(lpBad.stdout + lpBad.stderr), 'lint 版本一致性红路：SKILL version ≠ CHANGELOG 顶条 → 1（v2.39.0 缺条目事故棘轮）');

  // ---- v2.43.0 PLAIN_SPEECH_GATE：门脚本执行夹具（硬规则 17——红/绿两路真跑）+ glossary 活性 ----
  const psScript = path.join(skillRoot, 'assets', 'harness', 'validate-plain-speech.mjs');
  const badBrief = path.join(tmp, 'briefing-bad.md');
  fs.writeFileSync(badBrief, [
    '# 部署安排',
    '',
    '本次走并集部署，血统门绿灯后执行。DEPLOY_GATE 内嵌于入口。',
    '另外这个句子是一个特别长的句子用来触发超长句检测器它没有任何标点符号来断句所以会超过六十个字的阈值从而被机器打回要求拆成带主谓的因果短句让人能读懂',
  ].join('\n'));
  const psBad = spawnSync('node', [psScript, badBrief], { encoding: 'utf8' });
  ok(psBad.status === 1 && /行话裸奔/.test(psBad.stderr) && /代号裸奔/.test(psBad.stderr) && /超长句/.test(psBad.stderr), 'PLAIN_SPEECH_GATE 红路：行话/代号裸奔+超长句 → 退出 1 且三类信号逐条点名');
  const goodBrief = path.join(tmp, 'briefing-good.md');
  fs.writeFileSync(goodBrief, [
    '# 部署安排：一次带上两个任务的改动',
    '',
    '本次走并集部署（把两个任务的改动合成一个包、一次部署全带上）。部署前先过 DEPLOY_GATE（部署协调门：防止两个任务互相覆盖部署）的检查，绿了才执行。',
  ].join('\n'));
  const psGood = spawnSync('node', [psScript, goodBrief], { encoding: 'utf8' });
  ok(psGood.status === 0 && /✓/.test(psGood.stdout), 'PLAIN_SPEECH_GATE 绿路：行话带锚词白话、代号带括号、短句 → 退出 0');
  const glPath = path.join(skillRoot, 'references', 'glossary.md');
  const glRows = fs.readFileSync(glPath, 'utf8').split('\n').filter((l) => l.trim().startsWith('|') && l.split('|').length >= 5 && !/^\|\s*[-:]/.test(l) && !/行话/.test(l.split('|')[1] ?? 'x'));
  ok(glRows.length >= 10, `PLAIN_SPEECH_GATE 词表活性：glossary.md 可解析 ${glRows.length} 行（≥10，三列非空）`);
  ok(fs.readFileSync(path.join(skillRoot, 'references', 'data.md'), 'utf8').includes('大白话（解释人工抄写源'), 'PLAIN_SPEECH_GATE 登记表接线：data.md 机制登记表带「大白话」列（v2.53.0 列头对齐实现：抄写源非自动词表源）');
  const frameBrief = path.join(tmp, 'briefing-frame.md');
  fs.writeFileSync(frameBrief, [
    '# 状态汇报',
    '',
    '┌──────────┬──────────┐',
    '│ 项       │ 结果                                                                                                              │',
    '│ 自动化   │ 941/941 绿 + tsc 0                                                                                                │',
    '├──────────┼──────────┤',
    '│ 部署     │ 已完成   │',
    '└──────────┴──────────┘',
  ].join('\n'));
  const psFrame = spawnSync('node', [psScript, frameBrief], { encoding: 'utf8' });
  ok(psFrame.status === 0, 'PLAIN_SPEECH_GATE 框线表格豁免：终端框线行/全角竖线/对齐空格不当句子（2026-10-09 评分实测两轮误报回归锁）');
  // 项目词表（v2.43.1 可选层）：.taskflow/glossary.md 从被检稿向上自动发现，项目词覆盖同名技能词
  const psProj = path.join(tmp, 'ps-proj');
  fs.mkdirSync(path.join(psProj, '.taskflow', 'ps-t1-20260101'), { recursive: true });
  fs.writeFileSync(path.join(psProj, '.taskflow', 'glossary.md'), '# 项目词表\n\n| 行话 | 大白话 | 锚词 |\n| --- | --- | --- |\n| 签名册 | 部署记录表，每次上线记一行 | 部署记录表 |\n');
  const pjBrief = path.join(psProj, '.taskflow', 'ps-t1-20260101', 'briefing-x.md');
  fs.writeFileSync(pjBrief, '部署完成：签名册已登记。\n');
  const pjBad = spawnSync('node', [psScript, pjBrief], { encoding: 'utf8' });
  ok(pjBad.status === 1 && /签名册/.test(pjBad.stderr), 'PLAIN_SPEECH_GATE 项目词表红路：.taskflow/glossary.md 自动发现，项目行话（签名册）裸奔被抓');
  fs.writeFileSync(pjBrief, '部署完成：签名册（部署记录表，每次上线记一行）已登记。\n');
  const pjOk = spawnSync('node', [psScript, pjBrief], { encoding: 'utf8' });
  ok(pjOk.status === 0 && /项目词表已合并/.test(pjOk.stdout), 'PLAIN_SPEECH_GATE 项目词表绿路：锚词命中即绿 + 输出注明合并层数');

  // ---- v2.45.0 TASKFLOW_GUARD：mech 渲染 + mock pi 真执行夹具（硬规则 17）----
  const gproj = path.join(tmp, 'guard-proj');
  fs.mkdirSync(path.join(gproj, '.taskflow'), { recursive: true });
  sh('git init -q -b main && git config user.email t@t && git config user.name t', gproj);
  fs.writeFileSync(path.join(gproj, '.taskflow', 'project.json'), J({ key: 'guardproj', git: true, mechanisms: {}, assetExts: 'java|ts|js|vue', deploy: { webCommands: ['echo web'] } }));
  fs.writeFileSync(path.join(gproj, '.taskflow', 'index.json'), J({ tasks: [
    { id: 'g-live-20260101', title: '活任务', status: 'active', tier: 'small', branch: 'task/g-live-20260101' },
    { id: 'g-ver-20260101', title: '验收中', status: 'verifying', tier: 'small', branch: 'task/g-ver-20260101' },
  ] }));
  fs.mkdirSync(path.join(gproj, '.taskflow', 'g-ver-20260101'), { recursive: true });
  fs.writeFileSync(path.join(gproj, '.taskflow', 'g-ver-20260101', 'task.json'), J({ id: 'g-ver-20260101', title: '验收中', status: 'verifying', deploy: { deployedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() } }));
  const gproj2 = path.join(tmp, 'mech-phantom');
  fs.mkdirSync(path.join(gproj2, '.taskflow'), { recursive: true });
  fs.writeFileSync(path.join(gproj2, '.taskflow', 'project.json'), J({ key: 'mechphantom', git: false, mechanisms: {} }));
  const ph = run(['mech', 'install', '可行性门'], gproj2);
  ok(ph.status === 0 && ph.stdout.includes('纯编排层机制，无需 install') && !fs.existsSync(path.join(gproj2, 'scripts')), 'mech 幻影产物（v2.54.0）：—（说明）形式产物过滤 → 纯编排层短路，零渲染零假漂移（旧版整串当产物名=永久漂移标签）');
  const instG = run(['mech', 'install', 'TASKFLOW_GUARD'], gproj);
  const guardPath = path.join(gproj, '.omp', 'hooks', 'pre', 'taskflow-guard.js');
  ok(instG.status === 0 && fs.existsSync(guardPath), 'TASKFLOW_GUARD mech install：extension 渲染到 .omp/hooks/pre/taskflow-guard.js');
  const guardMod = await import('file://' + guardPath);
  const handlers = {};
  const statusCalls = [];
  const mockPi = { setLabel() {}, on: (ev, fn) => { (handlers[ev] ??= []).push(fn); } };
  const mkCtx = () => ({ cwd: gproj, ui: { setStatus: (k, t) => statusCalls.push([k, t]) } });
  guardMod.default(mockPi);
  const call = async (ev, event) => handlers[ev]?.[0]?.(event, mkCtx());
  await call('session_start', {});
  ok(statusCalls.some(([k, t]) => k === 'tf' && t.includes('进行中1') && t.includes('等你验收1') && t.includes('1个已上线超24小时未合并')), 'TASKFLOW_GUARD D：状态栏常显进行中+等你验收+已上线超24小时未合并（超 24h 判定，v2.56.0 人话化）');
  const comp = await call('session.compacting', {});
  ok(Array.isArray(comp?.context) && comp.context.some((s) => s.includes('g-live-20260101')) && comp.context.some((s) => s.includes('接力')), 'TASKFLOW_GUARD C：压缩摘要注入活任务接力线索');
  const b1 = await call('tool_call', { toolName: 'bash', input: { command: 'node tf.mjs commit -m x --files a.md b.md' } });
  ok(b1?.block === true && /逗号/.test(b1.reason), 'TASKFLOW_GUARD B1：--files 空格分隔多文件 → 调用即红（block+提示逗号）');
  const b2 = await call('tool_call', { toolName: 'bash', input: { command: 'node tf.mjs deploy --branch main' } });
  ok(b2?.additionalContext && /web-only/.test(b2.additionalContext), 'TASKFLOW_GUARD B2：deploy 缺 --web-only 且项目有 webCommands → 提醒注入');
  const aWarn = await call('tool_call', { toolName: 'bash', input: { command: 'rsync -a dist/ test-host:/opt/app/web/' } });
  ok(aWarn?.additionalContext && /部署墙/.test(aWarn.additionalContext) && !aWarn.block, 'TASKFLOW_GUARD A：部署特征命令默认警告（additionalContext 不 block）');
  process.env.TF_WALL = 'enforce';
  const aBlock = await call('tool_call', { toolName: 'bash', input: { command: "ssh test-host 'systemctl restart myapp'" } });
  delete process.env.TF_WALL;
  ok(aBlock?.block === true, 'TASKFLOW_GUARD A enforce：TF_WALL=enforce 时部署特征命令硬拦');
  process.env.TF_WALL = 'off';
  const aOff = await call('tool_call', { toolName: 'bash', input: { command: 'scp app.jar test-host:/opt/app/app.jar' } });
  delete process.env.TF_WALL;
  const pass = await call('tool_call', { toolName: 'bash', input: { command: 'git status --short' } });
  ok(aOff === undefined && pass === undefined, 'TASKFLOW_GUARD 边界：TF_WALL=off 放行 + 普通命令零干扰');
  // ---- v2.52.0 guard 收紧回归（对抗审查：A 组合命令绕过 / B2 只读提及误触——本会话活体两次误触实证）----
  const aCombo = await call('tool_call', { toolName: 'bash', input: { command: 'node tf.mjs deploy --dry-run && rsync -a dist/ test-host:/opt/app/web/' } });
  ok(aCombo?.additionalContext && /部署墙/.test(aCombo.additionalContext), 'TASKFLOW_GUARD A 分段判定：组合命令后段 rsync 夹带 → 仍警告（旧版全串含 tf.mjs+deploy 整体放行）');
  const b2ro = await call('tool_call', { toolName: 'bash', input: { command: "grep -n 'deploy' scripts/tf.mjs | head -5" } });
  ok(b2ro === undefined, 'TASKFLOW_GUARD B2 收紧：只读 grep 提及 deploy → 不再误触（旧版全串子串级判定）');
  fs.writeFileSync(path.join(gproj, '.taskflow', 'glossary.md'), '# 项目词表\n\n| 行话 | 大白话 | 锚词 |\n| --- | --- | --- |\n| 签名册 | 部署记录表，每次上线记一行 | 部署记录表 |\n');
  const inj = await call('before_provider_request', { payload: { system: 'BASE-PROMPT', messages: [] } });
  ok(typeof inj?.system === 'string' && inj.system.startsWith('[面向用户输出规范') && inj.system.includes('BASE-PROMPT') && inj.system.includes('签名册=部署记录表') && inj.system.includes('括号大白话'), 'TASKFLOW_GUARD E：输出规范+项目词表注入 system（原文保留、词表活读、v2.56.1 规范含括号大白话口径）');
  const injArr = await call('before_provider_request', { payload: { system: [{ type: 'text', text: 'BASE2' }], messages: [] } });
  ok(Array.isArray(injArr?.system) && injArr.system[0].text.startsWith('[面向用户输出规范') && injArr.system.some((b) => b.text === 'BASE2'), 'TASKFLOW_GUARD E：system 数组形态——注入块前插、原块保留');
  const injNone = await handlers['before_provider_request']?.[0]?.({ payload: { system: 'X' } }, { cwd: tmp, ui: {} });
  ok(injNone === undefined, 'TASKFLOW_GUARD E 零干扰：非 taskflow 项目不注入');
  // ---- v2.54.0 采纳面自检（对抗审查：任意 token install 渲染 guard，未采纳项目被误伤）----
  const gprojPj = JSON.parse(fs.readFileSync(path.join(gproj, '.taskflow', 'project.json'), 'utf8'));
  delete gprojPj.mechanisms.TASKFLOW_GUARD;
  fs.writeFileSync(path.join(gproj, '.taskflow', 'project.json'), JSON.stringify(gprojPj));
  const gateOff = await call('tool_call', { toolName: 'bash', input: { command: 'node tf.mjs commit -m x --files a.md b.md' } });
  ok(gateOff === undefined, 'TASKFLOW_GUARD 采纳闸：登记被清 → 八功能整体静默（B1 不再硬拦；卸载=删文件或清登记皆可）');
  gprojPj.mechanisms.TASKFLOW_GUARD = { adoptedAt: now, version: 'test' };
  fs.writeFileSync(path.join(gproj, '.taskflow', 'project.json'), JSON.stringify(gprojPj));

  // ---- v2.48.0 F 派发门 + G 编辑边界门：mock pi 真执行（硬规则 17——校验/注入/边界三路径）----
  const fcall = async (event) => handlers['tool_call']?.[1]?.(event, mkCtx());
  const gcall = async (event) => handlers['tool_call']?.[2]?.(event, mkCtx());
  fs.mkdirSync(path.join(gproj, '.taskflow', 'g-live-20260101', 'subtasks', '1-impl'), { recursive: true });
  fs.writeFileSync(path.join(gproj, '.taskflow', 'g-live-20260101', 'task.json'), J({ id: 'g-live-20260101', title: '活任务', status: 'active', worktree: gproj }));
  fs.writeFileSync(path.join(gproj, '.taskflow', 'g-live-20260101', 'spec.md'), [
    '# Spec — 活任务', '',
    '## 目标', '', '改一个文件。', '',
    '## 验收标准', '', '- [ ] 好（验证：x）', '',
    '## 边界与影响面', '', '- `src/in-scope.ts`（主清单）', '',
  ].join('\n'));
  fs.writeFileSync(path.join(gproj, '.taskflow', 'g-live-20260101', 'subtasks', '1-impl', 'spec.md'), [
    '# Subtask 1 — impl', '',
    '## 背景（一句话）', '', '整体里的位置。', '',
    '## 目标', '', '实现 X。', '',
    '## 验收', '', '- [ ] 通过（验证：node x）', '',
    '## 涉及文件', '', '- `src/in-scope.ts`（实现）', '',
    '## 约束与禁止', '', '- 禁止改动：其他文件', '',
  ].join('\n'));
  const f1 = await fcall({ toolName: 'task', input: { context: 'ctx', tasks: [{ name: 'Impl', task: '实现票 1，spec 见 .taskflow/g-live-20260101/subtasks/1-impl/spec.md' }] } });
  ok(f1?.input?.tasks?.[0]?.task.includes('F 派发门') && f1.input.tasks[0].task.includes('## 约束与禁止') && f1.input.tasks[0].task.includes('工作目录（worktree）') && f1.input.tasks[0].task.includes('实现票 1'), 'TASKFLOW_GUARD F1：引用合法 subtask spec → {input} 机械注入 spec 全文+worktree+原派发词保留');
  ok(f1.input.context === 'ctx' && f1.input.tasks[0].name === 'Impl', 'TASKFLOW_GUARD F1：input 其余字段原样保留（增量替换不删减）');
  const f2a = await fcall({ toolName: 'task', input: { tasks: [{ task: '见 .taskflow/g-live-20260101/subtasks/9-x/spec.md' }] } });
  ok(f2a?.block === true && /不存在/.test(f2a.reason), 'TASKFLOW_GUARD F2：引用不存在的 spec → block 点名路径');
  fs.mkdirSync(path.join(gproj, '.taskflow', 'g-live-20260101', 'subtasks', '2-bad'), { recursive: true });
  fs.writeFileSync(path.join(gproj, '.taskflow', 'g-live-20260101', 'subtasks', '2-bad', 'spec.md'), '# Subtask 2 — bad\n\n## 背景\n\nx。\n\n## 目标\n\ny。\n\n## 验收\n\n- [ ] z（验证：q）\n\n## 涉及文件\n\n- `src/bad.ts`（占位）\n');
  const f2b = await fcall({ toolName: 'task', input: { tasks: [{ task: '见 .taskflow/g-live-20260101/subtasks/2-bad/spec.md' }] } });
  ok(f2b?.block === true && /约束与禁止/.test(f2b.reason), 'TASKFLOW_GUARD F2：必填节缺失（约束与禁止）→ block 点名缺失节');
  const f3 = await fcall({ toolName: 'task', input: { tasks: [{ task: '调研一下目录结构并汇报' }] } });
  ok(f3?.additionalContext && /spec\.md/.test(f3.additionalContext) && !f3.block, 'TASKFLOW_GUARD F3：未引用 spec 的派发 → 提醒注入不拦（调研/审查类合法）');
  const f3none = await handlers['tool_call']?.[1]?.({ toolName: 'task', input: { tasks: [{ task: 'research' }] } }, { cwd: tmp, ui: {} });
  ok(f3none === undefined, 'TASKFLOW_GUARD F3 零干扰：非 taskflow 项目的 task 派发放行');
  const g1 = await gcall({ toolName: 'edit', input: { path: 'src/outside.ts' } });
  ok(g1?.additionalContext && /编辑边界门/.test(g1.additionalContext) && /g-live-20260101/.test(g1.additionalContext) && !g1.block && !String(g1.additionalContext).includes('⚠ ⚠'), 'TASKFLOW_GUARD G1：越界 edit 默认警告（点名任务与文件；v2.56.2 单 ⚠ 锚——warn 档不得双警告符）');
  process.env.TF_BOUND = 'enforce';
  const g1e = await gcall({ toolName: 'write', input: { path: 'src/outside.ts' } });
  delete process.env.TF_BOUND;
  ok(g1e?.block === true, 'TASKFLOW_GUARD G1 enforce：TF_BOUND=enforce 越界写硬拦');
  process.env.TF_BOUND = 'off';
  const g1o = await gcall({ toolName: 'edit', input: { path: 'src/outside.ts' } });
  delete process.env.TF_BOUND;
  const g2 = await gcall({ toolName: 'edit', input: { path: 'src/in-scope.ts' } });
  const g2b = await gcall({ toolName: 'write', input: { path: '.taskflow/g-live-20260101/progress.md' } });
  const g2none = await handlers['tool_call']?.[2]?.({ toolName: 'edit', input: { path: 'src/x.ts' } }, { cwd: tmp, ui: {} });
  ok(g1o === undefined && g2 === undefined && g2b === undefined && g2none === undefined, 'TASKFLOW_GUARD G2：TF_BOUND=off 放行 + 清单内/簿记白名单/非 taskflow 全放行');
  // 审查修复回归（merge 第 3 步两个 blocker）：
  const f0 = await handlers['tool_call']?.[1]?.({ toolName: 'task', input: { tasks: [{ task: '见 .taskflow/g-x/spec.md' }] } }, { cwd: tmp, ui: {} });
  ok(f0 === undefined, 'TASKFLOW_GUARD F 零干扰：非 taskflow 项目派发词引用 spec 路径 → 放行（不校验不注入不 block）');
  const sibOut = await gcall({ toolName: 'edit', input: { path: path.join(gproj + '-1-impl', 'src', 'outside.ts') } });
  const sibIn = await gcall({ toolName: 'edit', input: { path: path.join(gproj + '-1-impl', 'src', 'in-scope.ts') } });
  ok(sibOut?.additionalContext && /编辑边界门/.test(sibOut.additionalContext) && sibIn === undefined, 'TASKFLOW_GUARD G 兄弟 worktree：base 取子 worktree 根——越界警告/清单内放行（原实现 rel 恒以 .. 开头=死路）');
  // ---- v2.52.0 G 负面清单排除回归（文档与注释早已宣称、代码缺失——入清单=放行禁改文件）----
  fs.writeFileSync(path.join(gproj, '.taskflow', 'g-live-20260101', 'spec.md'), [
    '# Spec — 活任务', '',
    '## 目标', '', '改一个文件。', '',
    '## 验收标准', '', '- [ ] 好（验证：x）', '',
    '## 边界与影响面', '', '- `src/in-scope.ts`（主清单）', '- 涉及文件不含 `src/forbidden.ts`，明确禁止改动', '',
  ].join('\n'));
  const gNeg = await gcall({ toolName: 'edit', input: { path: 'src/forbidden.ts' } });
  ok(gNeg?.additionalContext && /编辑边界门/.test(gNeg.additionalContext), 'TASKFLOW_GUARD G 负面清单：明确禁止行中的路径不入清单 → 编辑它仍越界警告（旧版收入清单=放行禁改文件）');
  const gTilde = await gcall({ toolName: 'edit', input: { path: '~/.config/openedge/some-file.ts' } });
  ok(gTilde === undefined, 'TASKFLOW_GUARD G 波浪号（v2.54.1）：~/ 路径按主目录展开后无归属 → 零干扰放行（旧版 resolve 不展开 ~ 拼成 <cwd>/~/x 误报越界——另一 agent 会话 4 次误报实证）');
  // ---- v2.49.1 TASKFLOW_GUARD H（事件面重设计：context——活体实证 tool_result(task) 只有 spawn 回执）----
  const hcall = async (msgs, cwd = gproj) => handlers['context']?.[0]?.({ messages: msgs }, { cwd, ui: {} });
  const mkMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
  const h1 = await hcall([mkMsg('user', '继续'), mkMsg('assistant', '<task-result id="a1" agent="scout" status="completed">…{"blockers":["G 死路"]}…</task-result>')]);
  ok(Array.isArray(h1?.messages) && h1.messages.length === 3 && h1.messages[2].role === 'user' && /同类排查/.test(String(h1.messages[2].content)) && /可能猜错/.test(String(h1.messages[2].content)) && String(h1.messages[2].content).includes('按关键词在代码里搜索') && !/报了阻塞项/.test(String(h1.messages[2].content)), 'TASKFLOW_GUARD H：子代理报告进 context 链（chunk 数组，带属性 task-result 形态——2026-10-13 探针实证信封）→ 追加三问提醒消息（含「同类排查」「可能猜错」，grep 带括号白话，无旧措辞「报了阻塞项」），原消息保留');
  const h1b = await hcall([mkMsg('user', '继续'), mkMsg('assistant', '报告 blockers:2'), { role: 'user', content: '⚠ TASKFLOW_GUARD H：已提醒过' }]);
  ok(h1b === undefined, 'TASKFLOW_GUARD H 幂等+来源限定：无标签消息不武装，尾部已有提醒标记亦不追加');
  const h2 = await hcall([mkMsg('user', '正常完成')]);
  const h4 = await hcall([mkMsg('assistant', 'blocker')], tmp);
  const h6 = await hcall(null);
  ok(h2 === undefined && h4 === undefined && h6 === undefined, 'TASKFLOW_GUARD H 边界：无特征 / 非 taskflow / 空 messages 全静默');
  const h5 = await hcall([{ role: 'assistant', content: '<task-result>报告 blocking issues 2 个</task-result>' }]);
  ok(Array.isArray(h5?.messages) && h5.messages.length === 2, 'TASKFLOW_GUARD H 变体：task-result 无属性形态 + string content + blocking 一词在标签内命中 → 注入');
  // ---- v2.61.0 触发源收紧（来源限定）：非 task-result 来源一律静默——旧全文扫描曾自我喂养连续 8~10 轮（两会话实证）----
  const h8 = await hcall([mkMsg('user', '继续'), mkMsg('assistant', '任务无 blockers，一切正常')]);
  ok(h8 === undefined, 'TASKFLOW_GUARD H v2.61.0 翻转旧 h7：assistant 否定语境（无 blockers）→ 静默（旧版注入且被钉成已知良性噪音，现改判负例）');
  const h9 = await hcall([mkMsg('user', '继续'), mkMsg('assistant', '我在排查并修复阻塞问题，进展顺利')]);
  ok(h9 === undefined, 'TASKFLOW_GUARD H v2.61.0：编排模型自述含「阻塞」→ 静默（无 task-result 标签，不再武装——旧版自我喂养主源）');
  const h10 = await hcall([mkMsg('user', '这个任务卡住了，先停一下')]);
  ok(h10 === undefined, 'TASKFLOW_GUARD H v2.61.0：user 消息含「卡住」→ 静默（用户陈述不触发）');
  const h11 = await hcall([mkMsg('user', '⛔ 需你决策 3 项 ⚠ 敞口 2')]);
  ok(h11 === undefined, 'TASKFLOW_GUARD H v2.61.0：工具图例符号（⛔/⚠）无特征词 → 静默');
  const h12 = await hcall([mkMsg('user', '继续'), mkMsg('assistant', '<task-result>{"blockers":[1]}</task-result>'), { role: 'user', content: '⚠ TASKFLOW_GUARD H：提醒文本本身含阻塞/blocker 字样' }]);
  ok(h12 === undefined, 'TASKFLOW_GUARD H v2.61.0 自我喂养切断：真实报告触发一轮后，自家提醒（无 task-result 标签）不再重新武装');
  const h13 = await hcall([mkMsg('user', '⚠ TASKFLOW_GUARD H：旧提醒'), mkMsg('assistant', '继续讨论阻塞话题'), mkMsg('user', '图例行 ⛔')]);
  ok(h13 === undefined, 'TASKFLOW_GUARD H v2.61.0：提醒老化出尾部后，普通对话含「阻塞」也不复活');

  // ---- v2.57.0 TASKFLOW_GUARD I：词表反馈沉淀（用户拍板「逐轮催+压缩兜底」——正/负/消账/压缩/渲染源锚真跑）----
  const icall = async (msgs, cwd) => handlers['context']?.[1]?.({ messages: msgs }, cwd ? { cwd, ui: {} } : mkCtx());
  const sedcall = async (tn, p) => handlers['tool_call']?.[3]?.({ toolName: tn, input: { path: p } }, mkCtx());
  await icall([mkMsg('user', '这段术语太多，我看不懂')]);
  const i1 = await call('before_provider_request', { payload: { system: 'BASE', messages: [] } });
  ok(typeof i1?.system === 'string' && i1.system.includes('词表反馈沉淀') && i1.system.includes('1 条') && i1.system.includes('BASE'), 'TASKFLOW_GUARD I1 正路：user「看不懂」反馈 → E 通道追加沉淀指令（含计数，原 system 与规范块保留）');
  await icall([mkMsg('user', '这段术语太多，我看不懂')]);
  const i1b = await call('before_provider_request', { payload: { system: 'BASE', messages: [] } });
  ok(i1b.system.includes('1 条'), 'TASKFLOW_GUARD I1 去重：context 重放同消息不重复计数');
  await icall([mkMsg('user', '还是没看懂第二步'), mkMsg('user', '什么意思啊这个')]);
  const i1c = await call('before_provider_request', { payload: { system: 'BASE', messages: [] } });
  ok(i1c.system.includes('3 条'), 'TASKFLOW_GUARD I1 累计：不同反馈各计一次（3 条）');
  await sedcall('edit', path.join(gproj, '.taskflow', 'glossary.md'));
  const i2 = await call('before_provider_request', { payload: { system: 'BASE', messages: [] } });
  ok(!i2.system.includes('词表反馈沉淀'), 'TASKFLOW_GUARD I2 消账：write/edit 命中 .taskflow/glossary.md → 注入消失');
  await icall([mkMsg('assistant', '用户说看不懂时我会改写词表')]);
  const i3a = await call('before_provider_request', { payload: { system: 'BASE', messages: [] } });
  await icall([mkMsg('user', '帮我看一下进度')]);
  const i3b = await call('before_provider_request', { payload: { system: 'BASE', messages: [] } });
  ok(!i3a.system.includes('词表反馈沉淀') && !i3b.system.includes('词表反馈沉淀'), 'TASKFLOW_GUARD I3 负路：assistant 信号词不计数 / user 无信号词不注入');
  const i5 = await icall([mkMsg('user', '看不懂')], tmp);
  ok(i5 === undefined, 'TASKFLOW_GUARD I5 零干扰：非 taskflow 项目不检测');
  await icall([mkMsg('user', '没看懂这步')]);
  const i4a = await call('session.compacting', {});
  ok(Array.isArray(i4a?.context) && i4a.context.some((l) => String(l).includes('词表反馈沉淀')), 'TASKFLOW_GUARD I4 压缩兜底：pending>0 → 压缩摘要含沉淀行');
  await sedcall('write', '.taskflow/glossary.md');
  const i4b = await call('session.compacting', {});
  ok(Array.isArray(i4b?.context) && !i4b.context.some((l) => String(l).includes('词表反馈沉淀')), 'TASKFLOW_GUARD I4 消账后：压缩行消失（任务接力行保留）');
  const guardSrcI = fs.readFileSync(guardPath, 'utf8');
  const tgDocI = fs.readFileSync(path.join(path.dirname(script), '..', 'references', 'taskflow-guard.md'), 'utf8');
  ok(guardSrcI.includes('I 词表反馈沉淀') && tgDocI.includes('词表反馈沉淀') && tfmjsSrc.includes('词表反馈沉淀'), 'TASKFLOW_GUARD I 渲染源锚×3：guard 头注释 / taskflow-guard.md / MECH_PROSE 均含 I 条目（v2.56.2 渲染源漂移防复发）');
  // ---- v2.49.1 G 活体热修回归：多活并集归属 + 解析加固 ----
  const glP = path.join(gproj, '.taskflow', 'g-live-20260101', 'task.json');
  const glBak = fs.readFileSync(glP, 'utf8');
  const glJ = JSON.parse(glBak); delete glJ.worktree; fs.writeFileSync(glP, JSON.stringify(glJ)); // 摘 worktree → 走主仓库归属分支
  const gU = await gcall({ toolName: 'edit', input: { path: 'src/outside.ts' } });
  ok(gU?.additionalContext && /g-live-20260101/.test(gU.additionalContext) && /g-ver-20260101/.test(gU.additionalContext) && /任何进行中任务/.test(gU.additionalContext) && /任务说明书/.test(gU.additionalContext), 'TASKFLOW_GUARD G 活体热修①：多活任务×主仓库编辑 → 并集比对，全不命中警告点名全部活任务（v2.56.2 措辞锚：任何进行中任务+任务说明书 spec 白话）');
  fs.writeFileSync(glP, glBak);
  const specP2 = path.join(gproj, '.taskflow', 'g-live-20260101', 'spec.md');
  fs.appendFileSync(specP2, '\n- **改动文件集合声明**：`src/real-a.swift`、`src/real-b.swift`\n- **明确不做**：`src/never.swift`\n');
  const gPA = await gcall({ toolName: 'edit', input: { path: 'src/real-a.swift' } });
  const gPN = await gcall({ toolName: 'edit', input: { path: 'src/never.swift' } });
  ok(gPA === undefined && gPN?.additionalContext && /编辑边界门/.test(gPN.additionalContext), 'TASKFLOW_GUARD G 活体热修②：冒号后反引号路径入清单（real-a 放行）；「明确不做」行路径不入（never 越界警告）；bold 标签垃圾不再当路径');
  // ---- v2.63.0 pi 宿主适配器（.pi/extensions/taskflow.ts）：映射注入 + guard 子集 mock 真执行（硬规则 17）----
  const piAdapterPath = path.join(path.dirname(script), '..', '.pi', 'extensions', 'taskflow.ts');
  ok(fs.existsSync(piAdapterPath), 'pi 适配器在仓：.pi/extensions/taskflow.ts（单文件宿主适配层，架构同 superpowers 的 .pi/extensions/）');
  const piMod = await import('file://' + piAdapterPath);
  const piHandlers = {}; const piStatus = [];
  piMod.default({ on: (ev, fn) => { (piHandlers[ev] ??= []).push(fn); } });
  const piCtx = () => ({ cwd: gproj, ui: { setStatus: (k, t) => piStatus.push([k, t]) } });
  const pifire = async (ev, event) => piHandlers[ev]?.[0]?.(event, piCtx());
  await pifire('session_start', {});
  ok(piStatus.some(([k, t]) => k === 'tf' && String(t).includes('进行中')), 'PI 适配器 D：session_start 状态栏常显（ctx.ui.setStatus 同名挂点）');
  const pInj = await pifire('before_provider_request', { payload: { messages: [{ role: 'system', content: 'BASE' }, { role: 'user', content: 'u' }] } });
  ok(typeof pInj?.messages?.[0]?.content === 'string' && pInj.messages[0].content.startsWith('[taskflow 宿主映射表') && pInj.messages[0].content.includes('taskflow:pi-host-mapping') && pInj.messages[0].content.includes('BASE'), 'PI 适配器 映射注入：provider 层 messages[0] system 前缀（print 模式 context 变更不生效 + payload 无 system 字段——2026-10-15 e2e 日志实证，通道实测后改定）');
  ok(!pInj.messages[0].content.includes('接力线索'), 'PI 适配器 C 待命：未压缩不附接力线索（省 token，缓存友好）');
  const pZeroInj = await pifire('before_provider_request', { payload: { messages: [{ role: 'system', content: 'BASE2' }] } });
  ok(pZeroInj?.messages?.[0]?.content.startsWith('[taskflow 宿主映射表') && pZeroInj.messages[0].content.includes('BASE2'), 'PI 适配器 映射每请求：静态前缀 byte-identical（prompt cache 保持）');
  await pifire('session_compact', {});
  const pHandoff = await pifire('before_provider_request', { payload: { messages: [{ role: 'system', content: 'BASE3' }] } });
  ok(pHandoff.messages[0].content.includes('接力线索') && pHandoff.messages[0].content.includes('g-live-20260101'), 'PI 适配器 C 接力：压缩后下一请求附活任务线索（一次性）');
  const pHandoff2 = await pifire('before_provider_request', { payload: { messages: [{ role: 'system', content: 'BASE4' }] } });
  ok(!pHandoff2.messages[0].content.includes('接力线索') && pHandoff2.messages[0].content.includes('BASE4'), 'PI 适配器 C 一次性：接力线索消费后不再附（允许破缓存一次）');
  const pNonTf = await piHandlers['before_provider_request']?.[0]?.({ payload: { messages: [{ role: 'system', content: 'X' }] } }, { cwd: tmp, ui: {} });
  ok(pNonTf === undefined, 'PI 适配器 零干扰：非 taskflow 项目不注入');
  const pB1 = await pifire('tool_call', { toolName: 'bash', input: { command: 'node tf.mjs commit -m x --files a.md b.md' } });
  ok(pB1?.block === true && /逗号/.test(pB1.reason), 'PI 适配器 B1：--files 空格分隔多文件 → block（判定与 omp 双宿主一致）');
  const pA = await pifire('tool_call', { toolName: 'bash', input: { command: 'rsync -a dist/ test-host:/opt/app/web/' } });
  ok(pA?.block === true && /部署墙/.test(pA.reason) && /TF_WALL=off/.test(pA.reason), 'PI 适配器 A 警告档降级：pi 拦截结果无 additionalContext（types.d.ts ToolCallEventResult）→ block+绕行指引，语义比 omp 警告档更保守');
  process.env.TF_WALL = 'off';
  const pAoff = await pifire('tool_call', { toolName: 'bash', input: { command: 'scp app.jar test-host:/opt/x.jar' } });
  delete process.env.TF_WALL;
  ok(pAoff === undefined, 'PI 适配器 A off：TF_WALL=off 放行（与 omp 一致）');
  const pGin = await pifire('tool_call', { toolName: 'edit', input: { path: 'src/in-scope.ts' } });
  const pGout = await pifire('tool_call', { toolName: 'edit', input: { path: 'src/random-out.ts' } });
  ok(pGin === undefined && pGout?.block === true && /编辑边界门/.test(pGout.reason) && /TF_BOUND=off/.test(pGout.reason), 'PI 适配器 G：清单内放行 / 越界 block+绕行指引（警告档降级同 A；簿记白名单含 .pi/）');
  const pZero = await pifire('tool_call', { toolName: 'bash', input: { command: 'echo hi' } });
  ok(pZero === undefined, 'PI 适配器 零干扰：无特征命令不拦');

  const paraBad = path.join(tmp, 'briefing-para.md');
  fs.writeFileSync(paraBad, [
    '# 状态',
    '',
    '────────────────────────────────',
    '',
    '这个功能已经完成了开发，测试也都全部通过了。部署按照流程走完了预检和上传，服务重启正常。验证的时候我们检查了页面表现和接口返回，数据都对得上。日志里没有报错，监控指标平稳。后续还需要你确认验收然后收尾。整个过程比较顺利没有遇到阻塞。另外文档也同步更新了。相关方的通知也发出去了。',
  ].join('\n'));
  const psPara = spawnSync('node', [psScript, paraBad], { encoding: 'utf8' });
  ok(psPara.status === 1 && /装饰横幅/.test(psPara.stderr) && /段落堆叠/.test(psPara.stderr), 'PLAIN_SPEECH_GATE v2.46.0：装饰横幅线+段落堆叠（7 句/一坨）双检测红路');
  const paraOk = path.join(tmp, 'briefing-para-ok.md');
  fs.writeFileSync(paraOk, [
    '# 状态：功能完成，待验收',
    '',
    '开发与测试全部完成，部署走完了预检、上传和重启，一切正常。',
    '',
    '验证结果：',
    '- 页面表现与接口返回一致，数据对得上',
    '- 日志零报错，监控指标平稳',
    '',
    '待你确认验收，随后进入收尾（移到历史区）。',
  ].join('\n'));
  const psParaOk = spawnSync('node', [psScript, paraOk], { encoding: 'utf8' });
  ok(psParaOk.status === 0, 'PLAIN_SPEECH_GATE v2.46.0：同内容拆段+列表化后绿路（分段手段本身不触发检测）');
  const coarseBad = path.join(tmp, 'briefing-coarse.md');
  fs.writeFileSync(coarseBad, '# 盘点\n\n一个要留意的风险标记：四条都挂着敞口——代码在线上但还没合入主线，这个窗口期里任何人从主线构建部署都会把这四个修复悄悄覆盖掉（双包事故的同款形态），所以建议尽快真机验收，通过后再走收口（把尾巴全部处理完）。\n');
  const psCoarse = spawnSync('node', [psScript, coarseBad], { encoding: 'utf8' });
  ok(psCoarse.status === 1 && /超长句（句号级）/.test(psCoarse.stderr), 'PLAIN_SPEECH_GATE v2.46.1：冒号/破折号/括号串联的一「句」>80 字（细切拆成合格碎片的漏检盲区）→ 句号级检测红路（真样本实证）');
  const quoteOk = path.join(tmp, 'briefing-quote.md');
  fs.writeFileSync(quoteOk, '# 讨论\n\n原句是「走收口（合入主线）」，词条「收口」「敞口」在引号内=引述/列举场景，不判裸奔。\n');
  const psQuote = spawnSync('node', [psScript, quoteOk], { encoding: 'utf8' });
  ok(psQuote.status === 0, 'PLAIN_SPEECH_GATE v2.46.2 引号豁免：讨论行话本身的引述/列举（「」内词条）不判裸奔——自审实证的引述盲区');
  // ---- v2.47.0 对抗性审查回归锁（攻击矩阵实证）----
  const auditList = path.join(tmp, 'atk-listitem.md');
  fs.writeFileSync(auditList, '# 汇报\n\n- 这个功能完成了开发，测试全部通过。部署走完了预检和上传，服务重启正常。验证检查了页面表现和接口返回，数据都对得上。日志没有报错，指标平稳。\n');
  const atkList = spawnSync('node', [psScript, auditList], { encoding: 'utf8' });
  ok(atkList.status === 1 && /列表项堆叠/.test(atkList.stderr), '对抗审查：列表项塞 4 句（规范每项 1–3 句）→ 红（列表行绕过段落检测的盲区）');
  const auditFrame = path.join(tmp, 'atk-noframe.md');
  const longP1 = '我们这轮迭代覆盖了登录、上报、分享三个主链路，回归测试全部通过。遗留的两个小问题已经登记在案，安排到下个迭代处理不影响本次发布。';
  const longP2 = '性能方面对核心接口做了基准对比，响应时间都在预期范围之内。相比上一版本没有出现退化，个别接口还有小幅的改善。';
  const longP3 = '安全扫描按计划完成，高危问题为零。中低危问题已经全部记录并排期，依赖升级会在维护窗口统一处理。';
  const longP4 = '可用性方面邀请了两名真实用户做快速走查，反馈整体正向。操作路径比旧版本更清晰，唯一的建议是增加批量操作入口。';
  const longP5 = '综合以上四个维度的结论，本次迭代满足发布标准。建议按计划推进上线流程，上线后持续观察一周核心指标。';
  const longP6 = '数据库方面完成了一次索引优化，核心查询的执行计划有明显改善。慢查询数量下降了一个量级，变更已全部入库并留下回滚脚本。';
  const longP7 = '文档与培训材料同步更新完毕，相关方都已通知到位。发布评审会议的纪要已经存档留底，后续行动项指派到人。';
  fs.writeFileSync(auditFrame, `# 结论\n\n${longP1}\n\n${longP2}\n\n${longP3}\n\n${longP4}\n\n${longP5}\n\n${longP6}\n\n${longP7}\n`);
  const atkFrame = spawnSync('node', [psScript, auditFrame], { encoding: 'utf8' });
  ok(atkFrame.status === 1 && /无骨架/.test(atkFrame.stderr), '对抗审查：400+ 字纯段落流（每段独立合格、整体零结构）→ 无骨架红');
  const auditHalfQ = path.join(tmp, 'atk-halfquote.md');
  fs.writeFileSync(auditHalfQ, '# 汇报\n\n随后走"收口"流程，其余事项均已办结。\n');
  const atkHalfQ = spawnSync('node', [psScript, auditHalfQ], { encoding: 'utf8' });
  ok(atkHalfQ.status === 0, '对抗审查：半角双引号内的词条=引用场景 → 豁免不误拦（假红修复）');
  const auditEmoji = path.join(tmp, 'atk-emoji.md');
  fs.writeFileSync(auditEmoji, '# 📌 进度\n\n- 完成开发\n\n## ⚠️ 风险\n\n- 无\n');
  const atkEmoji = spawnSync('node', [psScript, auditEmoji], { encoding: 'utf8' });
  ok(atkEmoji.status === 1 && /emoji 标题滥用/.test(atkEmoji.stderr), '对抗审查：emoji 标题 2 个（规范 ≤1）→ 红');

  // ---- v2.58.0 MERGE_GATE：snapshot/mergegate 双门真跑（快照绿/红/刷新复绿 + 越界红/点名 + 兼容两路）----
  const mgRepo = path.join(tmp, 'mg-repo');
  fs.mkdirSync(path.join(mgRepo, '.taskflow'), { recursive: true });
  sh('git init -q -b main && git config user.email t@t && git config user.name t', mgRepo);
  fs.writeFileSync(path.join(mgRepo, 'base.txt'), 'x\n');
  sh("echo '.taskflow/' >> .git/info/exclude && git add -A && git commit -qm init", mgRepo);
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'project.json'), J({ key: 'mgproj', git: true }));
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'index.json'), J({ tasks: [] }));
  fs.mkdirSync(path.join(mgRepo, '.taskflow', 'mg-t1-20260101'), { recursive: true });
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'mg-t1-20260101', 'task.json'), J({ id: 'mg-t1-20260101', title: '门任务', status: 'active', tier: 'small', branch: 'task/mg-t1-20260101' }));
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'mg-t1-20260101', 'spec.md'), [
    '# Spec — 门任务', '',
    '## 目标', '', '改一个文件。', '',
    '## 验收标准', '', '- [ ] 好（验证：x）', '',
    '## 边界与影响面', '', '- **改动文件集合声明**：`src/a.ts`', '',
  ].join('\n'));
  sh('git checkout -q -b task/mg-t1-20260101 && mkdir -p src && echo a > src/a.ts && git add -A && git commit -qm t1 && git checkout -q main', mgRepo);
  const mgSnap1 = run(['snapshot', 'mg-t1-20260101'], mgRepo);
  ok(mgSnap1.status === 0 && /快照已拍/.test(mgSnap1.stdout), 'MERGE_GATE snapshot：main HEAD 落档 task.json.mergeSnapshot（MVCC 事务 ID——审查时的读版本）');
  const mgGate1 = run(['mergegate', 'mg-t1-20260101'], mgRepo);
  ok(mgGate1.status === 0 && /快照门绿/.test(mgGate1.stdout) && /越界门绿/.test(mgGate1.stdout), 'MERGE_GATE 双绿：快照一致 + diff 全在声明集（exit 0 放行合并）');
  sh('mkdir -p src && echo a2 > src/a.ts && git add -A && git commit -qm other-task', mgRepo); // v2.59.0：main 前移须触写集才走红路（无关文件=黄路，见 v2.59.0 块）——setup 随门一分类语义更新
  const mgGate2 = run(['mergegate', 'mg-t1-20260101'], mgRepo);
  ok(mgGate2.status === 1 && /快照门红/.test(mgGate2.stdout) && /命中读写集/.test(mgGate2.stdout) && /src\/a\.ts/.test(mgGate2.stdout) && /回 merge\.md 第 1 步/.test(mgGate2.stdout), 'MERGE_GATE 快照门红（v2.59.0 文件级分类）：main 前移且命中写集 → 拒合并 + 点名文件 + 指引同步重审（对着旧基线审的 diff 不能直接合）');
  ok(run(['snapshot', 'mg-t1-20260101'], mgRepo).status === 0 && run(['mergegate', 'mg-t1-20260101'], mgRepo).status === 0, 'MERGE_GATE 刷新快照后复绿（同步重审完成路径——snapshot 重拍即新事务 ID）');
  const mgTj = J({ id: 'mg-t1-20260101', title: '门任务', status: 'active', tier: 'small', branch: 'task/mg-t1-20260101' });
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'mg-t1-20260101', 'task.json'), mgTj);
  const mgGate4 = run(['mergegate', 'mg-t1-20260101'], mgRepo);
  ok(mgGate4.status === 0 && /无快照在档.*放行/.test(mgGate4.stdout), 'MERGE_GATE 兼容：无快照 info 放行（存量任务不硬拦缺档）');
  ok(run(['snapshot', 'mg-t1-20260101'], mgRepo).status === 0, 'MERGE_GATE 复拍快照（后续越界路用）');
  sh('git checkout -q task/mg-t1-20260101 && echo b > src/b.ts && git add -A && git commit -qm touch-b && git checkout -q main', mgRepo);
  const mgGate5 = run(['mergegate', 'mg-t1-20260101'], mgRepo);
  ok(mgGate5.status === 1 && /越界门红/.test(mgGate5.stdout) && /src\/b\.ts/.test(mgGate5.stdout), 'MERGE_GATE 越界门红：diff 含声明集外文件被点名（防改 A 没回归带坏 B）');
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'mg-t1-20260101', 'spec.md'), '# Spec — 门任务\n\n## 目标\n\n改一个文件。\n\n## 验收标准\n\n- [ ] 好（验证：x）\n\n## 边界与影响面\n\n（无声明行形态）\n');
  const mgGate6 = run(['mergegate', 'mg-t1-20260101'], mgRepo);
  ok(mgGate6.status === 1 && /改动文件集合声明/.test(mgGate6.stdout) && /补节/.test(mgGate6.stdout), 'MERGE_GATE 边界：spec 无「改动文件集合声明」行 → 红指补节（禁静默放行）');
  // mainRef 本地优先（dogfood 实证：origin 滞后于本地已合时，快照取 origin 会瞎——已合未推窗口）
  sh('git clone -q --bare . ../mg-remote.git && git remote add origin ../mg-remote.git && git fetch -q origin', mgRepo);
  sh('git commit -q --allow-empty -m advance-local', mgRepo);
  const mgSnapLocal = run(['snapshot', 'mg-t1-20260101'], mgRepo);
  ok(mgSnapLocal.status === 0 && /快照已拍：main @/.test(mgSnapLocal.stdout) && !/origin\/main @/.test(mgSnapLocal.stdout), 'MERGE_GATE mainRef 本地优先：origin 在册且滞后时快照仍取本地 main（旧序 origin 优先在「已合未推」窗口把门拍瞎——dogfood 自证）');
  // ---- v2.59.0 任务级 MVCC 补全：baseCommit 锚定 + 门一黄/红文件级分类 + STALE_CHECK + DISPATCH_OVERLAP + 门二目录前缀 ----
  const mvWt = path.join(tmp, 'mv-wt');
  sh(`git worktree add -q -b task/mv-t1-20260101 ${mvWt} main`, mgRepo);
  fs.mkdirSync(path.join(mgRepo, '.taskflow', 'mv-t1-20260101'), { recursive: true });
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'mv-t1-20260101', 'task.json'), J({ id: 'mv-t1-20260101', title: 'MVCC 任务', status: 'active', tier: 'small', branch: 'task/mv-t1-20260101' }));
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'mv-t1-20260101', 'spec.md'), [
    '# Spec — MVCC 任务', '',
    '## 目标', '', '锚定与漂移。', '',
    '## 验收标准', '', '- [ ] 好（验证：x）', '',
    '## 边界与影响面', '', '- **改动文件集合声明**：`src/mv.ts`', '',
    '**影响面地图（夹具）**：', '',
    '| 方向 | 资产 | 证据 |', '| --- | --- | --- |',
    '| 上游依赖 | `src/dep.ts` | grep |',
    '| 下游消费方 | `src/api.ts` | grep |',
    '| 同类资产 | `scripts/x.ts` | grep |', '',
  ].join('\n'));
  const forkSha = execFileSync('git', ['-C', mgRepo, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  const mvTj = () => JSON.parse(fs.readFileSync(path.join(mgRepo, '.taskflow', 'mv-t1-20260101', 'task.json'), 'utf8'));
  fs.writeFileSync(path.join(mvWt, 'src', 'mv.ts'), 'mv\n');
  const cmv1 = run(['commit', '-m', 'mv1', '--files', 'src/mv.ts'], mvWt);
  ok(cmv1.status === 0 && mvTj().baseCommit === forkSha, 'v2.59.0 baseCommit：首个 tf.mjs commit 锚 merge-base 全哈希（MVCC 开局 Read View=fork 点）');
  fs.appendFileSync(path.join(mvWt, 'src', 'mv.ts'), 'mv2\n');
  ok(run(['commit', '-m', 'mv2', '--files', 'src/mv.ts'], mvWt).status === 0 && mvTj().baseCommit === forkSha, 'v2.59.0 baseCommit 已锚定不覆盖（二次 commit 不改锚点，与 goalHash 首锚同款）');
  const st1 = run(['stale', 'mv-t1-20260101'], mgRepo);
  ok(st1.status === 0 && /影响面新鲜/.test(st1.stdout), 'v2.59.0 STALE_CHECK：main 自基线未触碰读写集 → ✓ 新鲜 exit 0');
  ok(run(['snapshot', 'mv-t1-20260101'], mgRepo).status === 0, 'v2.59.0 前置：mv-t1 拍快照');
  sh('git checkout -q main && echo u > docs-unrelated.txt && git add -A && git commit -qm unrel', mgRepo);
  const mgY = run(['mergegate', 'mv-t1-20260101'], mgRepo);
  ok(mgY.status === 1 && /快照门黄/.test(mgY.stdout) && /免 merge\.md 第 3 步重审/.test(mgY.stdout) && /docs-unrelated\.txt/.test(mgY.stdout), 'v2.59.0 门一黄：main 前移但未触碰读写集 → 变更清单强制过目 + 免重审指引（exit 1 保「双绿才进 lock」，同步+刷新快照后过门）');
  ok(run(['snapshot', 'mv-t1-20260101'], mgRepo).status === 0 && run(['mergegate', 'mv-t1-20260101'], mgRepo).status === 0, 'v2.59.0 黄路收口：同步+刷新快照后双绿（幂等秒过）');
  sh('git checkout -q main && echo d > src/dep.ts && git add -A && git commit -qm touch-dep', mgRepo);
  const mgR = run(['mergegate', 'mv-t1-20260101'], mgRepo);
  ok(mgR.status === 1 && /快照门红/.test(mgR.stdout) && /命中读写集/.test(mgR.stdout) && /src\/dep\.ts/.test(mgR.stdout), 'v2.59.0 门一红（读集参与）：main 改影响面地图资产列文件 dep.ts（不在写集）→ 红点名——读集声明生效证据');
  const st2 = run(['stale', 'mv-t1-20260101'], mgRepo);
  ok(st2.status === 1 && /影响面漂移/.test(st2.stdout) && /src\/dep\.ts/.test(st2.stdout), 'v2.59.0 STALE_CHECK：main 改读集内文件 → ⚠ 影响面漂移 exit 1 点名（在途失效传播）');
  const stLegacy = run(['stale', 'mg-t1-20260101'], mgRepo);
  ok(stLegacy.status === 0 && /无基线锚/.test(stLegacy.stdout), 'v2.59.0 STALE_CHECK：无 baseCommit（存量任务）→ ℹ 跳过不硬拦（与门二未登记跳过同款降级）');
  ok(run(['snapshot', 'mv-t1-20260101'], mgRepo).status === 0, 'v2.59.0 收尾重拍快照（mv-t1 复绿备用）');
  const mv2Wt = path.join(tmp, 'mv2-wt');
  sh(`git worktree add -q -b task/mv-t2-20260101 ${mv2Wt} main`, mgRepo);
  fs.mkdirSync(path.join(mgRepo, '.taskflow', 'mv-t2-20260101'), { recursive: true });
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'mv-t2-20260101', 'task.json'), J({ id: 'mv-t2-20260101', title: '目录前缀', status: 'active', tier: 'small', branch: 'task/mv-t2-20260101' }));
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'mv-t2-20260101', 'spec.md'), '# Spec — 目录前缀\n\n## 目标\n\n前缀。\n\n## 验收标准\n\n- [ ] 好（验证：x）\n\n## 边界与影响面\n\n- **改动文件集合声明**：`src/auth/`\n');
  fs.mkdirSync(path.join(mv2Wt, 'src', 'auth'), { recursive: true });
  fs.writeFileSync(path.join(mv2Wt, 'src', 'auth', 'login.ts'), 'l\n');
  ok(run(['commit', '-m', 'auth', '--files', 'src/auth/login.ts'], mv2Wt).status === 0, 'v2.59.0 前置：mv-t2 提交目录内文件');
  const mgP1 = run(['mergegate', 'mv-t2-20260101'], mgRepo);
  ok(mgP1.status === 0 && /越界门绿/.test(mgP1.stdout), 'v2.59.0 门二目录前缀：声明 src/auth/ 覆盖子孙 src/auth/login.ts → 绿（旧精确匹配必误红——修复断言）');
  fs.writeFileSync(path.join(mv2Wt, 'src', 'a.ts.bak'), 'bak\n');
  ok(run(['commit', '-m', 'bak', '--files', 'src/a.ts.bak'], mv2Wt).status === 0, 'v2.59.0 前置：mv-t2 提交边界负例文件');
  const mgP2 = run(['mergegate', 'mv-t2-20260101'], mgRepo);
  ok(mgP2.status === 1 && /越界门红/.test(mgP2.stdout) && /src\/a\.ts\.bak/.test(mgP2.stdout), 'v2.59.0 门二负例：文件声明不当前缀——src/auth/ 不匹配 src/a.ts.bak → 红点名（matchPath 语义边界）');
  const ovDir = path.join(mgRepo, '.taskflow', 'mv-t1-20260101', 'subtasks');
  fs.mkdirSync(path.join(ovDir, '1-alpha'), { recursive: true });
  fs.mkdirSync(path.join(ovDir, '2-beta'), { recursive: true });
  fs.mkdirSync(path.join(ovDir, '3-gamma'), { recursive: true });
  fs.writeFileSync(path.join(ovDir, '1-alpha', 'spec.md'), '# Subtask 1\n\n## 涉及文件\n\n- `src/mv.ts`（改）\n');
  fs.writeFileSync(path.join(ovDir, '2-beta', 'spec.md'), '# Subtask 2\n\n## 涉及文件\n\n- `src/mv.ts`（也改）\n');
  fs.writeFileSync(path.join(ovDir, '3-gamma', 'spec.md'), '# Subtask 3\n\n## 涉及文件\n\n- src/plain.ts（无反引号）\n');
  const ov1 = run(['overlap', 'mv-t1-20260101'], mgRepo);
  ok(ov1.status === 1 && /重叠对/.test(ov1.stdout) && /1-alpha × 2-beta/.test(ov1.stdout) && /src\/mv\.ts/.test(ov1.stdout), 'v2.59.0 DISPATCH_OVERLAP：两子任务共享反引号文件 → exit 1 点名重叠对+文件（场景① 写集两两不相交前提）');
  ok(/3-gamma.*未用反引号/.test(ov1.stdout), 'v2.59.0 DISPATCH_OVERLAP：涉及文件未用反引号 → ℹ 不参与机读');
  fs.writeFileSync(path.join(ovDir, '2-beta', 'spec.md'), '# Subtask 2\n\n## 涉及文件\n\n- `src/beta.ts`（改）\n');
  fs.writeFileSync(path.join(ovDir, '3-gamma', 'spec.md'), '# Subtask 3\n\n## 涉及文件\n\n- `src/gamma.ts`（改）\n');
  const ov2 = run(['overlap', 'mv-t1-20260101'], mgRepo);
  ok(ov2.status === 0 && /两两不相交/.test(ov2.stdout), 'v2.59.0 DISPATCH_OVERLAP：写集不相交 → ✓ 可按场景① 并行（exit 0）');
  const ov3 = run(['overlap', 'mv-t2-20260101'], mgRepo);
  ok(ov3.status === 0 && /无子任务可查/.test(ov3.stdout), 'v2.59.0 DISPATCH_OVERLAP：无子任务 → ℹ 幂等路径 exit 0');
  // ---- v2.59.0 审查自证回归：stale 对已并入 main 的任务 ℹ 跳过（必修①）+ 无机读声明 ℹ 防假绿（加固③）----
  sh('git merge -q --no-ff task/mv-t1-20260101 -m merge-mv-t1', mgRepo);
  const stAnc = run(['stale', 'mv-t1-20260101'], mgRepo);
  ok(stAnc.status === 0 && /分支已并入/.test(stAnc.stdout) && !/影响面漂移/.test(stAnc.stdout), 'v2.59.0 STALE_CHECK 已并入跳过（审查必修①）：分支进 main 后全量扫不再对自身 diff 报漂移（假阳性淹没真信号）');
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'mv-t2-20260101', 'spec.md'), '# Spec — 无机读\n\n## 目标\n\n空声明。\n\n## 验收标准\n\n- [ ] 好（验证：x）\n\n## 边界与影响面\n\n- **改动文件集合声明**：src/auth/（无反引号）\n');
  const stEmpty = run(['stale', 'mv-t2-20260101'], mgRepo);
  ok(stEmpty.status === 0 && /无机读声明/.test(stEmpty.stdout) && !/影响面新鲜/.test(stEmpty.stdout), 'v2.59.0 STALE_CHECK 无机读声明（审查加固③）：声明行无反引号 → ℹ 未参与体检，不打 ✓ 假绿');
  // ---- v2.59.0 对抗加固回归（攻击轮 44 样例 6 根因：rename 双名 / quotePath 中文 / 双声明行 / 围栏与假标记 / 空参与绿灯 / ../ 净化）----
  const atkWt = path.join(tmp, 'atk-wt');
  sh(`git worktree add -q -b task/atk-t3-20260101 ${atkWt} main`, mgRepo);
  fs.mkdirSync(path.join(mgRepo, '.taskflow', 'atk-t3-20260101'), { recursive: true });
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'atk-t3-20260101', 'task.json'), J({ id: 'atk-t3-20260101', title: '对抗样例', status: 'active', tier: 'small', branch: 'task/atk-t3-20260101' }));
  fs.writeFileSync(path.join(mgRepo, '.taskflow', 'atk-t3-20260101', 'spec.md'), [
    '# Spec — 对抗样例', '',
    '## 目标', '', '抗攻击。', '',
    '## 验收标准', '', '- [ ] 好（验证：x）', '',
    '## 边界与影响面', '',
    '- **改动文件集合声明**：`src/中文模块/`',
    '- **改动文件集合声明**：`src/extra.ts`', '',
    '**影响面地图（夹具）**：', '',
    '| 方向 | 资产 | 证据 |', '| --- | --- | --- |',
    '| 上游依赖 | `docs/up.md` | grep |', '',
    '**影响面地图**的更新见里程碑：', '',
    '| 事项 | 文件 |', '| --- | --- |',
    '| 计划 | `docs/plan-fake.md` |', '',
    '```', '| 方向 | 资产 | 证据 |', '| --- | --- | --- |', '| 示例 | `docs/fence-example.md` | fence |', '```', '',
  ].join('\n'));
  fs.mkdirSync(path.join(atkWt, 'src', '中文模块'), { recursive: true });
  fs.writeFileSync(path.join(atkWt, 'src', '中文模块', '说明.md'), 'c\n');
  fs.writeFileSync(path.join(atkWt, 'src', 'extra.ts'), 'e\n');
  ok(run(['commit', '-m', 'atk', '--files', 'src/中文模块/说明.md,src/extra.ts'], atkWt).status === 0, '对抗前置：atk-t3 提交（中文目录+双声明行第二行文件）');
  const atkG1 = run(['mergegate', 'atk-t3-20260101'], mgRepo);
  ok(atkG1.status === 0 && /越界门绿/.test(atkG1.stdout), '对抗加固 RC2+RC3：中文文件名不转义匹配目录声明 + 第二条声明行文件可见（全部声明行都收）→ 越界门绿');
  sh('git checkout -q main && mkdir -p src/中文模块 docs && echo n > src/中文模块/新文件.md && echo u > docs/up.md && git add -A && git commit -qm cn', mgRepo);
  const atkSt = run(['stale', 'atk-t3-20260101'], mgRepo);
  ok(atkSt.status === 1 && /影响面漂移/.test(atkSt.stdout) && /中文模块\/新文件\.md/.test(atkSt.stdout), '对抗加固 RC2（stale 侧）：中文新文件进漂移清单且输出不转义');
  ok(run(['snapshot', 'atk-t3-20260101'], mgRepo).status === 0, '对抗前置：atk-t3 拍快照');
  sh('git checkout -q main && git mv docs/up.md docs/renamed.md && git commit -qm mv', mgRepo);
  const atkG2 = run(['mergegate', 'atk-t3-20260101'], mgRepo);
  ok(atkG2.status === 1 && /快照门红/.test(atkG2.stdout) && /命中读写集/.test(atkG2.stdout) && /docs\/up\.md/.test(atkG2.stdout), '对抗加固 RC1：git mv 重命名双名入清单——旧名 docs/up.md 命中读集 → 红（默认 rename 检测只报新名 = 绕过面）');
  ok(run(['snapshot', 'atk-t3-20260101'], mgRepo).status === 0, '对抗前置：刷新快照');
  sh('git checkout -q main && echo f > docs/fence-example.md && echo p > docs/plan-fake.md && git add -A && git commit -qm fake', mgRepo);
  const atkG3 = run(['mergegate', 'atk-t3-20260101'], mgRepo);
  ok(atkG3.status === 1 && /快照门黄/.test(atkG3.stdout) && /docs\/fence-example\.md/.test(atkG3.stdout) && /docs\/plan-fake\.md/.test(atkG3.stdout) && !/命中读写集/.test(atkG3.stdout), '对抗加固 RC4：代码围栏内示例表与段首加粗提及的假表不入读集——触碰两者只黄不红（旧解析吞入 = 假红）');
  fs.mkdirSync(path.join(ovDir, '4-delta'), { recursive: true });
  fs.writeFileSync(path.join(ovDir, '4-delta', 'spec.md'), '# Subtask 4\n\n## 涉及文件\n\n- `../src/mv.ts`（相对写法）\n');
  const ovA = run(['overlap', 'mv-t1-20260101'], mgRepo);
  ok(ovA.status === 1 && /1-alpha × 4-delta/.test(ovA.stdout) && /src\/mv\.ts/.test(ovA.stdout), '对抗加固 RC6（../净化）：../src/mv.ts 归一后与 src/mv.ts 相遇——同文件不同写法不漏检（半截净化 = 绕过面）');
  fs.writeFileSync(path.join(ovDir, '4-delta', 'spec.md'), '# Subtask 4\n\n## 涉及文件\n\n- `src/delta.ts`（改）\n');
  fs.writeFileSync(path.join(ovDir, '3-gamma', 'spec.md'), '# Subtask 3\n\n## 涉及文件\n\n- src/plain.ts（无反引号）\n');
  const ovC = run(['overlap', 'mv-t1-20260101'], mgRepo);
  ok(ovC.status === 0 && /未参与机读/.test(ovC.stdout) && !/两两不相交，可按场景① 并行/.test(ovC.stdout), '对抗加固 RC5：空参与子任务在场 → ℹ 两两不相交未被证明，不发 ✓ 绿灯');
  fs.mkdirSync(path.join(ovDir, '5-eps'), { recursive: true });
  fs.writeFileSync(path.join(ovDir, '5-eps', 'spec.md'), '# Subtask 5\n\n## 涉及文件\n\n示例：\n```\n- `src/eps-fake.ts`\n```\n- `src/mv.ts`（真改）\n');
  const ovD = run(['overlap', 'mv-t1-20260101'], mgRepo);
  ok(ovD.status === 1 && /1-alpha × 5-eps/.test(ovD.stdout) && !/eps-fake/.test(ovD.stdout), '对抗加固 RC6（围栏）：涉及文件节内围栏示例不入集（eps-fake 不出现）+ 围栏后真实声明不丢（src/mv.ts 命中 1-alpha）');

  // ---- v2.57.1 mech install prose 生成节幂等替换（I7 缺陷→测试门：先红——存量旧生成节 + 重装 → 必须自愈到当前口径）----
  fs.writeFileSync(path.join(gproj, 'AGENTS.md'), [
    '# AGENTS — 用户红线区', '',
    '用户内容：不许动我。', '',
    '## 宿主防护层（taskflow mech install 生成）', '',
    '- .omp/hooks/pre/taskflow-guard.js 为 omp extension（文案 v2.56.1 人话化）：状态栏常显（进行中N/等你验收M/已上线超24小时未合并K）、commit --files 空格分隔硬拦、「阻塞」字样返回人话三问提醒（声明可能猜错、不拦操作）；卸载=删文件+清 project.json.mechanisms.TASKFLOW_GUARD（TASKFLOW_GUARD）', '',
    '## 用户后置节', '',
    '后置内容不许动。', '',
  ].join('\n'));
  fs.writeFileSync(path.join(gproj, '.taskflow', 'conventions.md'), [
    '# 项目约定', '',
    '## 用户节', '',
    '用户约定不许动。', '',
    '## 机制：宿主防护层（mech install 生成 2026-10-09；TASKFLOW_GUARD，omp extension 住 .omp/hooks/pre/taskflow-guard.js）', '',
    '- **D 状态栏常显**：进行中N/等你验收M/已上线超24小时未合并K常驻 omp 底栏', '',
  ].join('\n'));
  const rHeal = run(['mech', 'install', 'TASKFLOW_GUARD', '--yes'], gproj); // 登记 version='test'=漂移刷新 → v2.65.0 确认闸须 --yes（拒绝路归 v2.65.0 夹具块）
  const agHealed = fs.readFileSync(path.join(gproj, 'AGENTS.md'), 'utf8');
  ok(rHeal.status === 0 && agHealed.includes('词表反馈沉淀'), 'mech prose 自愈①（v2.57.1 红路）：存量旧口径 AGENTS 生成节 + 重装 → 整节刷新为当前渲染——旧版 marker 判重「跳过补记」永不自愈（v2.56.2 半治实证）');
  ok(agHealed.includes('用户内容：不许动我。') && agHealed.includes('后置内容不许动。') && !agHealed.includes('不拦操作）；卸载'), 'mech prose 自愈②：节外用户内容原样保留（前置红线区 + 后置节不被吃；旧口径独有串「不拦操作）；卸载」消失——新渲染中间插有词表反馈沉淀条目）');
  const convHealed = fs.readFileSync(path.join(gproj, '.taskflow', 'conventions.md'), 'utf8');
  ok(convHealed.includes('词表反馈沉淀') && convHealed.includes('用户约定不许动。') && convHealed.includes('## 用户节'), 'mech prose 自愈③：conventions 生成节刷新为当前渲染 + 用户节保留');
  const rHeal2 = run(['mech', 'install', 'TASKFLOW_GUARD'], gproj);
  ok(rHeal2.status === 0 && fs.readFileSync(path.join(gproj, 'AGENTS.md'), 'utf8') === agHealed && fs.readFileSync(path.join(gproj, '.taskflow', 'conventions.md'), 'utf8') === convHealed, 'mech prose 幂等：同日重复 install 两文件 byte 稳定（幂等替换不重复追加）');

  // ---- v2.60.0：PARK 搁置状态（park/unpark）+ doctor I18 账实对账 ----
  const pkRepo = path.join(tmp, 'pk-repo');
  fs.mkdirSync(path.join(pkRepo, '.taskflow'), { recursive: true });
  sh('git init -q -b main && git config user.email t@t && git config user.name t', pkRepo);
  fs.writeFileSync(path.join(pkRepo, 'base.txt'), 'x\n');
  sh("echo '.taskflow/' >> .git/info/exclude && git add -A && git commit -qm init", pkRepo);
  const pkBase = execFileSync('git', ['-C', pkRepo, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  const pkNow = new Date().toISOString();
  const pkDir = (id) => path.join(pkRepo, '.taskflow', id);
  const pkTj = (id) => JSON.parse(fs.readFileSync(path.join(pkDir(id), 'task.json'), 'utf8'));
  const pkIdxRow = (id) => JSON.parse(fs.readFileSync(path.join(pkRepo, '.taskflow', 'index.json'), 'utf8')).tasks.find((e) => e.id === id);
  fs.writeFileSync(path.join(pkRepo, '.taskflow', 'project.json'), J({ key: 'pkproj', git: true }));
  // pk-a：park/stale 主角（分支不并入 main；baseCommit 手锚 + 写集声明）
  sh('git checkout -q -b task/pk-a-20260101 && echo a > src-a.txt && git add -A && git commit -qm a && git checkout -q main', pkRepo);
  const pkATip = execFileSync('git', ['-C', pkRepo, 'rev-parse', '--short=7', 'task/pk-a-20260101'], { encoding: 'utf8' }).trim();
  fs.mkdirSync(pkDir('pk-a-20260101'), { recursive: true });
  fs.writeFileSync(path.join(pkDir('pk-a-20260101'), 'task.json'), J({ id: 'pk-a-20260101', title: '搁置主角', goal: 'g', tier: 'small', anchor: 'attached', status: 'active', branch: 'task/pk-a-20260101', baseCommit: pkBase, createdAt: pkNow, lastActiveAt: pkNow, sessionID: 'ses_p', subtasks: [], checkpoints: [{ ts: pkNow, commit: pkATip, summary: 'a', files: ['src-a.txt'] }] }));
  fs.writeFileSync(path.join(pkDir('pk-a-20260101'), 'spec.md'), '# Spec — 搁置主角\n\n## 目标\n\n搁置。\n\n## 验收标准\n\n- [ ] 好（验证：x）\n\n## 边界与影响面\n\n- **改动文件集合声明**：`src/shared.txt`\n');
  // pk-b：分支已并入 main 但保持 active —— I18① 夹具（漏收口形态）
  sh('git checkout -q -b task/pk-b-20260101 && echo b > src-b.txt && git add -A && git commit -qm b && git checkout -q main', pkRepo);
  const pkBTip = execFileSync('git', ['-C', pkRepo, 'rev-parse', '--short=7', 'task/pk-b-20260101'], { encoding: 'utf8' }).trim();
  fs.mkdirSync(pkDir('pk-b-20260101'), { recursive: true });
  fs.writeFileSync(path.join(pkDir('pk-b-20260101'), 'task.json'), J({ id: 'pk-b-20260101', title: '漏收口样例', goal: 'g', tier: 'small', anchor: 'attached', status: 'active', branch: 'task/pk-b-20260101', createdAt: pkNow, lastActiveAt: pkNow, sessionID: 'ses_p', subtasks: [], checkpoints: [{ ts: pkNow, commit: pkBTip, summary: 'b', files: ['src-b.txt'] }] }));
  sh('git merge -q --no-ff task/pk-b-20260101 -m merge-pk-b', pkRepo);
  // pk-v：verifying（park 拒绝负路）；pk-m：merged（park 拒绝负路，根层只触发 ℹ I8）
  fs.mkdirSync(pkDir('pk-v-20260101'), { recursive: true });
  fs.writeFileSync(path.join(pkDir('pk-v-20260101'), 'task.json'), J({ id: 'pk-v-20260101', title: '验收中样例', goal: 'g', tier: 'small', anchor: 'attached', status: 'verifying', createdAt: pkNow, lastActiveAt: pkNow, sessionID: 'ses_p', subtasks: [] }));
  fs.mkdirSync(pkDir('pk-m-20260101'), { recursive: true });
  fs.writeFileSync(path.join(pkDir('pk-m-20260101'), 'task.json'), J({ id: 'pk-m-20260101', title: '已合并样例', goal: 'g', tier: 'small', anchor: 'attached', status: 'merged', createdAt: pkNow, lastActiveAt: pkNow, sessionID: 'ses_p', subtasks: [], mergedAt: pkNow }));
  fs.writeFileSync(path.join(pkRepo, '.taskflow', 'index.json'), J({ tasks: [
    { id: 'pk-a-20260101', title: '搁置主角', status: 'active', tier: 'small', branch: 'task/pk-a-20260101', worktree: null, sessionID: 'ses_p', createdAt: pkNow, lastActiveAt: pkNow },
    { id: 'pk-b-20260101', title: '漏收口样例', status: 'active', tier: 'small', branch: 'task/pk-b-20260101', worktree: null, sessionID: 'ses_p', createdAt: pkNow, lastActiveAt: pkNow },
    { id: 'pk-v-20260101', title: '验收中样例', status: 'verifying', tier: 'small', branch: null, worktree: null, sessionID: 'ses_p', createdAt: pkNow, lastActiveAt: pkNow },
    { id: 'pk-m-20260101', title: '已合并样例', status: 'merged', tier: 'small', branch: null, worktree: null, sessionID: 'ses_p', createdAt: pkNow, lastActiveAt: pkNow, mergedAt: pkNow },
  ] }));
  const pkNoReason = run(['park', 'pk-a-20260101'], pkRepo);
  ok(pkNoReason.status === 1 && /留原因/.test(pkNoReason.stdout), 'v2.60.0 park 负路：缺 --reason → exit 1 + 留原因（无原因的搁置=遗忘的温床）');
  const pkVer = run(['park', 'pk-v-20260101', '--reason', '等等'], pkRepo);
  ok(pkVer.status === 1 && /收口/.test(pkVer.stdout), 'v2.60.0 park 负路：verifying 拒 park——线上敞口须先走收口链（防 I16 语义冲突）');
  const pkMerged = run(['park', 'pk-m-20260101', '--reason', '等等'], pkRepo);
  ok(pkMerged.status === 1, 'v2.60.0 park 负路：merged 不可搁置（park 仅 active→parked）');
  const pkGo = run(['park', 'pk-a-20260101', '--reason', '等产品拍板'], pkRepo);
  ok(pkGo.status === 0 && /→ parked/.test(pkGo.stdout) && /unpark pk-a-20260101/.test(pkGo.stdout), 'v2.60.0 park 正路：active→parked exit 0（输出含恢复指引）');
  ok(pkTj('pk-a-20260101').status === 'parked' && pkTj('pk-a-20260101').parkedReason === '等产品拍板' && !!pkTj('pk-a-20260101').parkedAt, 'v2.60.0 park 落档：parkedReason/parkedAt 写入 task.json（有因搁置）');
  ok(pkIdxRow('pk-a-20260101').status === 'parked', 'v2.60.0 park 同步：index 行 status=parked（syncIndexRow 生效，I1 不可能漂移）');
  const pkAgain = run(['park', 'pk-a-20260101', '--reason', '再搁'], pkRepo);
  ok(pkAgain.status === 1, 'v2.60.0 park 负路：已 parked 再 park → exit 1');
  const pkLs = run(['ls'], pkRepo);
  ok(pkLs.status === 0 && pkLs.stdout.includes('已搁置') && pkLs.stdout.includes('等产品拍板') && pkLs.stdout.includes('pk-a-20260101'), 'v2.60.0 ls：parked 任务行状态列「已搁置」+ 行尾原因摘要');
  ok(!pkLs.stdout.includes('需你决策'), 'v2.60.0 ls：parked 不进「需你决策」老化块（搁置=已拍板态，parkedReason 即决定）');
  sh('mkdir -p src && echo drift > src/shared.txt && git add -A && git commit -qm drift', pkRepo);
  const pkStParked = run(['stale'], pkRepo);
  ok(pkStParked.status === 0 && !pkStParked.stdout.includes('pk-a-20260101'), 'v2.60.0 stale 排除面：parked 任务写集已漂移也不点名（status 过滤零改动，行为锁定）');
  const pkDoc = run(['doctor'], pkRepo);
  ok(pkDoc.status === 0 && pkDoc.stdout.includes('I18') && pkDoc.stdout.includes('疑似漏收口') && pkDoc.stdout.includes('pk-b-20260101'), 'v2.60.0 I18①：active 分支已并入 main → ℹ 疑似漏收口点名（accept 前置已满足却未翻账）');
  ok(pkDoc.stdout.includes('全部全绿') && !pkDoc.stdout.includes('pk-a-20260101'), 'v2.60.0 I18 提示级契约：不计 bad——parked 不进缺省体检、干净夹具 doctor 退出码 0');
  const upGo = run(['unpark', 'pk-a-20260101'], pkRepo);
  ok(upGo.status === 0 && /→ active/.test(upGo.stdout), 'v2.60.0 unpark 正路：parked→active exit 0');
  ok(pkTj('pk-a-20260101').status === 'active' && !('parkedReason' in pkTj('pk-a-20260101')) && !('parkedAt' in pkTj('pk-a-20260101')), 'v2.60.0 unpark 落档：parkedReason/parkedAt 删除（不留悬挂半档）');
  ok(pkIdxRow('pk-a-20260101').status === 'active', 'v2.60.0 unpark 同步：index 行回到 active');
  const upNeg = run(['unpark', 'pk-a-20260101'], pkRepo);
  ok(upNeg.status === 1, 'v2.60.0 unpark 负路：对 active 任务 exit 1');
  const pkA2 = pkTj('pk-a-20260101'); pkA2.lastActiveAt = new Date(Date.now() - 20 * 86400000).toISOString();
  fs.writeFileSync(path.join(pkDir('pk-a-20260101'), 'task.json'), J(pkA2));
  const pkDoc2 = run(['doctor'], pkRepo);
  ok(pkDoc2.stdout.includes('疑似搁置') && pkDoc2.stdout.includes('pk-a-20260101'), 'v2.60.0 I18②：lastActiveAt 20 天前且 lease 过期 → ℹ 疑似搁置点名（呈报确认后 park 或刷新续做）');
  const pkA3 = pkTj('pk-a-20260101'); pkA3.lastActiveAt = new Date().toISOString();
  fs.writeFileSync(path.join(pkDir('pk-a-20260101'), 'task.json'), J(pkA3));
  ok(!run(['doctor'], pkRepo).stdout.includes('疑似搁置'), 'v2.60.0 I18② 防误报：lastActiveAt 刷新后该行消失');
  const pkStActive = run(['stale'], pkRepo);
  ok(pkStActive.status === 1 && pkStActive.stdout.includes('影响面漂移') && pkStActive.stdout.includes('pk-a-20260101') && /src\/shared\.txt/.test(pkStActive.stdout), 'v2.60.0 stale 反证：同任务同漂移，active 即点名——排除面确系 status 过滤而非夹具失真');
  const pkSelf = run(['doctor', '--self'], pkRepo);
  ok(pkSelf.status === 0 && pkSelf.stdout.includes('三源一致') && pkSelf.stdout.includes('18 条'), 'v2.60.0 doctor --self：I18 三源一致（18 条）+ 跳号回归');

  // ---- v2.60.1 对抗加固回归（五路攻击轮实锤的绿侧锁定；红侧由变异副本先证——E 路攻击面 ④m1-3/m1d）----
  const pkIdxAdd = (row) => { const pj = path.join(pkRepo, '.taskflow', 'index.json'); const db = JSON.parse(fs.readFileSync(pj, 'utf8')); db.tasks.push(row); fs.writeFileSync(pj, JSON.stringify(db, null, 2) + '\n'); };
  const pkAddT = (id, t) => { fs.mkdirSync(pkDir(id), { recursive: true }); fs.writeFileSync(path.join(pkDir(id), 'task.json'), J({ id, title: id, goal: 'g', tier: 'small', anchor: 'attached', status: 'active', createdAt: pkNow, lastActiveAt: new Date().toISOString(), sessionID: 'ses_p', subtasks: [], ...t })); pkIdxAdd({ id, title: id, status: t.status ?? 'active', tier: 'small', branch: t.branch ?? null, worktree: null, sessionID: 'ses_p', createdAt: pkNow, lastActiveAt: pkNow }); };
  pkAddT('pk-dv-20260101', { deploy: { status: 'verifying', deployedAt: pkNow, note: '双源漂移态' } });
  const atkDv = run(['park', 'pk-dv-20260101', '--reason', '先放放'], pkRepo);
  ok(atkDv.status === 1 && /收口/.test(atkDv.stdout), 'v2.60.1 park 守卫（A1/C1 收敛）：顶层 active + deploy.status=verifying 双源漂移态拒 park——旧守卫只认顶层 status 被整段绕过（v2.18.2 历史任务实证形态）');
  const atkFlag = run(['park', 'pk-a-20260101', '--reason', '--force'], pkRepo);
  ok(atkFlag.status === 1 && /缺值/.test(atkFlag.stdout), 'v2.60.1 park 负路：--reason 后跟 flag = 缺值拒（旧版把 --force 吞成原因落档）');
  const atkBlank = run(['park', 'pk-a-20260101', '--reason', '   '], pkRepo);
  ok(atkBlank.status === 1 && /留原因/.test(atkBlank.stdout), 'v2.60.1 park 负路：纯空格不算原因（对齐 req-confirm trim 范式）');
  const atkDirty = run(['park', 'pk-a-20260101', '--reason', 'a|b\nc'], pkRepo);
  ok(atkDirty.status === 0 && pkTj('pk-a-20260101').parkedReason === 'a b c', 'v2.60.1 park 净化：竖线/换行折叠空格后落档（表格安全——不净化则 ls 表格伪列+断行）');
  const dirtyLs = run(['ls'], pkRepo);
  ok(/已搁置（a b c）/.test(dirtyLs.stdout) && !/（a\|b/.test(dirtyLs.stdout), 'v2.60.1 ls 渲染：净化后原因并入状态列单行呈现（旧版行尾管道符后追加会被 GFM 渲染器当超额单元格丢弃）');
  const tkPark = run(['takeover', 'pk-a-20260101', '--session', 'ses_x'], pkRepo);
  ok(tkPark.status === 1 && /unpark/.test(tkPark.stdout) && !/已是终态/.test(tkPark.stdout), 'v2.60.1 takeover 对 parked 专属文案：指路 unpark 而非误称「已是终态」（C4）');
  ok(run(['unpark', 'pk-a-20260101'], pkRepo).status === 0, 'v2.60.1 收尾：pk-a 还原 active 供后续');
  sh('git branch task/pk-zero-20260101', pkRepo);
  pkAddT('pk-zero-20260101', { branch: 'task/pk-zero-20260101', checkpoints: [] });
  pkAddT('pk-onmain-20260101', { branch: 'main', checkpoints: [] });
  const guardDoc = run(['doctor'], pkRepo);
  ok(!/I18 pk-zero-20260101/.test(guardDoc.stdout) && !/I18 pk-onmain-20260101/.test(guardDoc.stdout), 'v2.60.1 I18① 守卫（B1/F4）：零提交新任务（分支==基线 tip，isAnc 自反恒真）与 attached-on-main 不再误报未开工任务');
  ok(/I18 pk-b-20260101 分支已并入 main/.test(guardDoc.stdout), 'v2.60.1 I18① 守卫不误伤：有 checkpoint 的真漏收口（pk-b）照报');
  ok(!/I18 pk-dv-20260101/.test(guardDoc.stdout), 'v2.60.1 I18 参与资格（B4）：双源 verifying（等验收态）不参与账实对账');
  sh(`git update-ref refs/remotes/origin/main ${pkBase}`, pkRepo);
  const syncDoc = run(['doctor'], pkRepo);
  ok(/I18 pk-b-20260101 分支已并入 main/.test(syncDoc.stdout), 'v2.60.1 I18① refs 同源（B2）：origin/main 滞后（已合未推窗口）仍由本地 main 命中——旧版只认单一 mainRef 会漏报刚合完最可能忘 accept 的高价值时刻');
  const pk2 = path.join(tmp, 'pk2');
  fs.mkdirSync(path.join(pk2, '.taskflow', 'pk2-p-20260101'), { recursive: true });
  fs.writeFileSync(path.join(pk2, '.taskflow', 'pk2-p-20260101', 'task.json'), J({ id: 'pk2-p-20260101', title: '😀'.repeat(45), goal: 'g', tier: 'small', anchor: 'attached', status: 'parked', parkedReason: '等产品拍板', createdAt: pkNow, lastActiveAt: pkNow, sessionID: 's', subtasks: [] }));
  fs.mkdirSync(path.join(pk2, '.taskflow', 'pk2-m-20260101'), { recursive: true });
  fs.writeFileSync(path.join(pk2, '.taskflow', 'pk2-m-20260101', 'task.json'), J({ id: 'pk2-m-20260101', title: 'm', goal: 'g', tier: 'small', anchor: 'attached', status: 'merged', createdAt: pkNow, lastActiveAt: pkNow, sessionID: 's', subtasks: [], mergedAt: pkNow }));
  fs.writeFileSync(path.join(pk2, '.taskflow', 'index.json'), J({ tasks: [] }));
  const pk2Ls = run(['ls'], pk2);
  ok(pk2Ls.status === 0 && pk2Ls.stdout.includes('均已搁置') && !pk2Ls.stdout.includes('继续哪个？'), 'v2.60.1 ls 结尾三态（C2）：parked-only 场景不再端着全搁置表问「继续哪个？」，改指路 unpark');
  ok(!pk2Ls.stdout.includes('\uFFFD'), 'v2.60.1 trunc 码点安全（C5）：45 个 emoji 标题截断无 U+FFFD 乱码');

  // ---- v2.61.1 三线收口回归：mech 渲染登记表过滤（D1）+ changelog 门标题算数/触发词十三式 + plain-speech 80 字窗/编号列表 + guard 幽灵 worktree/花括号/BLOCKER_RE ----
  // ① D1 渲染过滤不变式：渲染清单=union(登记表「采纳产物」列)——产物列「—」的技能内门不落项目（旧版全家渲染把
  //    validate-plain-speech.mjs 渲染进项目=死产物：SKILL_ROOT 按脚本位置解析到项目根、读不存在的 references/glossary.md 恒红）
  ok(fs.existsSync(path.join(repo2, 'scripts/harness/validate-changelog.sh')) && fs.existsSync(path.join(repo2, 'scripts/harness/deploy-preflight.mjs')) && fs.existsSync(path.join(repo2, 'scripts/harness/credential-probe.mjs')) && fs.existsSync(path.join(repo2, 'scripts/design/extract-spec.js')) && fs.existsSync(path.join(repo2, '.omp/hooks/pre/taskflow-guard.js')), 'mech 渲染过滤（D1）：登记表在册产物照常渲染（changelog/preflight/凭证探针/提取器/guard 五落点齐，v2.62.0 DEPLOY_GATE 双产物）');
  ok(!fs.existsSync(path.join(repo2, 'scripts/harness/validate-plain-speech.mjs')), 'mech 渲染过滤（D1）：产物列「—」的技能内门（PLAIN_SPEECH_GATE）零渲染——旧版全家渲染把恒红死产物带进项目');
  ok(fs.existsSync(path.join(skillRoot, 'assets', 'harness', 'validate-plain-speech.mjs')), 'mech 渲染过滤（D1）资产面：技能内门脚本住技能仓 assets/ 原位（SKILL_ROOT 语义成立），过滤只断渲染不删资产');
  const psInst = run(['mech', 'install', 'PLAIN_SPEECH_GATE'], gproj2);
  ok(psInst.status === 0 && psInst.stdout.includes('无项目侧产物定义'), 'mech 渲染过滤（D1）：技能内门自身 install 早退（纯编排层提示，零渲染）');
  // ② changelog 门（标题行算数收口 + 触发词十三式）：「同类排查：」样板字写标题不再算满足（body 与触发词匹配面分离，
  //    对齐 decision-combo 门 tail -n +2 先例）；「缺陷修复」语序（L110 masse2e 活体零检出形态）入检
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — 修 bug：同类排查：唯一实例（样板字只在标题）\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：修复了崩溃演示\n- commits：aaa1111\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n`);
  const cTitleSamp = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cTitleSamp.status === 1 && /样板字只在标题/.test(cTitleSamp.stdout + cTitleSamp.stderr), 'CLASS_SWEEP_GATE 标题算数收口：触发词条目标题带「同类排查：」样板字、正文缺行 → 红点名（旧版匹配面含标题=假绿绕过）');
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — masse2e 缺陷修复并集\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：四处并集修完\n- commits：aaa1111\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n`);
  const cNewWord = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cNewWord.status === 1 && /缺陷修复并集/.test(cNewWord.stdout + cNewWord.stderr), 'CLASS_SWEEP_GATE 触发词十三式：「缺陷修复」语序（L110 masse2e 活体形态，旧词表零检出）→ 红点名');
  fs.writeFileSync(cl2, `# CHANGELOG\n\n## 2026-01-01 — masse2e 缺陷修复并集\n\n- 涉及文件：\`src/a.ts\`\n- 做了什么：四处并集修完\n- commits：aaa1111\n- 同类排查：唯一实例（并集语义一处修四处受益）\n- 出现次数：1\n\n## 2026-09-16 — 决策组合门落地\n\n- 锚点\n`);
  const cNewWordOk = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
  ok(cNewWordOk.status === 0, 'CLASS_SWEEP_GATE 十三式不误伤：新触发词条目正文补齐双行 → 绿（成行才算满足）');
  // ③ plain-speech 门：80 字窗改真扫描（解释括号不再要求紧邻代号首字符）+ 编号列表（1. 形态）入列表项约束
  const psWin = path.join(tmp, 'briefing-ps-win.md');
  fs.writeFileSync(psWin, 'DEPLOY_GATE 是部署协调门（防止两个任务互相覆盖部署）。\n');
  const psWinR = spawnSync('node', [psScript, psWin], { encoding: 'utf8' });
  ok(psWinR.status === 0, 'PLAIN_SPEECH_GATE 80 字窗真扫描：代号后隔词出解释括号 → 绿（旧版只锚窗口首字符，「DEPLOY_GATE 是部署协调门（…）」误红）');
  const psNum = path.join(tmp, 'briefing-ps-num.md');
  fs.writeFileSync(psNum, '1. 第一句说明背景情况。第二句补充细节。第三句给出数据。第四句总结结论。\n');
  const psNumR = spawnSync('node', [psScript, psNum], { encoding: 'utf8' });
  ok(psNumR.status === 1 && /列表项堆叠/.test(psNumR.stderr), 'PLAIN_SPEECH_GATE 编号列表入检：编号项 4 句 → 红点名列表项堆叠（旧版只扫 -/* 项，编号项零约束）');
  // ④ guard 三修：F-01 幽灵 worktree（空/缺 worktree 不进 realPath——realPath('') 解析到项目根=幽灵罩住全仓错归属）/
  //    F-02 花括号整行先展开再收集（bullet 正则逗号截断 docs/prd/{auth=真路径清单外误报）/ F-03 BLOCKER_RE 补 blocked·卡住
  const gIdxP = path.join(gproj, '.taskflow', 'index.json');
  const gIdx0 = JSON.parse(fs.readFileSync(gIdxP, 'utf8'));
  fs.mkdirSync(path.join(gproj, '.taskflow', 'g-ghost-a-20260101'), { recursive: true });
  fs.writeFileSync(path.join(gproj, '.taskflow', 'g-ghost-a-20260101', 'task.json'), J({ id: 'g-ghost-a-20260101', title: '无 worktree 幽灵', status: 'active', sessionID: 's', subtasks: [] })); // task.json 无 worktree 字段（guard-h-misfire 档案活体形态）
  fs.mkdirSync(path.join(gproj, '.taskflow', 'g-ghost-b-20260101'), { recursive: true });
  fs.writeFileSync(path.join(gproj, '.taskflow', 'g-ghost-b-20260101', 'task.json'), J({ id: 'g-ghost-b-20260101', title: '空串 worktree 幽灵', status: 'active', worktree: '', sessionID: 's', subtasks: [] }));
  fs.writeFileSync(gIdxP, J({ tasks: [
    { id: 'g-ghost-a-20260101', title: '无 worktree 幽灵', status: 'active', tier: 'small', branch: null, sessionID: 's' },
    { id: 'g-ghost-b-20260101', title: '空串 worktree 幽灵', status: 'active', tier: 'small', branch: null, worktree: '', sessionID: 's' },
    ...gIdx0.tasks,
  ] })); // 幽灵排最前：旧版归属首中即断——错点名幽灵的形态才可观察
  const gGhost = await gcall({ toolName: 'edit', input: { path: 'src/outside.ts' } });
  ok(gGhost?.additionalContext && gGhost.additionalContext.includes('g-live-20260101') && !gGhost.additionalContext.includes('g-ghost'), 'TASKFLOW_GUARD F-01 幽灵 worktree：空/缺 worktree 任务跳过归属判定，越界警告仍点名真主（g-live）——旧版空串进 realPath 解析到项目根=幽灵罩住全仓');
  fs.writeFileSync(gIdxP, JSON.stringify(gIdx0, null, 2) + '\n'); // 还原 index（后续语义不受幽灵残留影响）
  const gSpecP = path.join(gproj, '.taskflow', 'g-live-20260101', 'spec.md');
  const gSpec0 = fs.readFileSync(gSpecP, 'utf8');
  fs.writeFileSync(gSpecP, gSpec0.replace('## 边界与影响面\n\n- `src/in-scope.ts`（主清单）', '## 边界与影响面\n\n- `src/in-scope.ts`（主清单）\n- docs/prd/{auth,share}/functional.md（两域清单）'));
  const gBrace = await gcall({ toolName: 'edit', input: { path: 'docs/prd/auth/functional.md' } });
  const gBraceOut = await gcall({ toolName: 'edit', input: { path: 'docs/prd/unknown/functional.md' } });
  ok(gBrace === undefined && gBraceOut?.additionalContext && /编辑边界门/.test(gBraceOut.additionalContext), 'TASKFLOW_GUARD F-02 花括号收集：整行先展开再收集——{auth,share} 两展开在清单内放行、清单外仍警告（旧版 bullet 正则逗号截断成 docs/prd/{auth=清单内误报越界）');
  fs.writeFileSync(gSpecP, gSpec0);
  const hBlocked = await hcall([mkMsg('user', '继续'), mkMsg('assistant', '<task-result id="t9" agent="scout" status="completed">子任务卡住了：构建红</task-result>')]);
  ok(Array.isArray(hBlocked?.messages) && hBlocked.messages.length === 3 && /同类排查/.test(String(hBlocked.messages[2].content)), 'TASKFLOW_GUARD F-03 H 特征词补全：信封报告含「卡住」→ 触发三问提醒（旧词表零检出）');
  const hBlockedEn = await hcall([mkMsg('user', '继续'), mkMsg('assistant', '<task-result>{"note":"I am blocked by missing spec"}</task-result>')]);
  ok(Array.isArray(hBlockedEn?.messages) && hBlockedEn.messages.length === 3, 'TASKFLOW_GUARD F-03 H 特征词补全：信封报告含「blocked」→ 触发（block(?:er|ing|ed) 变体族收全）');
  const hLegend = await hcall([mkMsg('user', '⛔ 31 天需决策 🔴 2 项')]);
  ok(hLegend === undefined, 'TASKFLOW_GUARD F-03 反例不松动：纯图例行（无特征词无信封）→ 静默（v2.61.0 来源限定语义保持）');

  // ---- v2.64.0 jarProbe 实物对账：preflight ⓪探针优先（path 死文件场景回归锁）+ deploy 入口透传 + doctor I17 配置入口（夹具真跑，硬规则 17）----
  // 场景源：历史部署实证——compose 形态下 jarPath 指向宿主机 systemd 遗留死文件，
  // record/I17 同读该文件 → 遗留 md5 对遗留 md5 恒「一致」假绿；用户拍板「看 jar 包实物而非登记/任务时间」。
  const probeJar = path.join(tmp, 'probe-app.jar');
  fs.writeFileSync(probeJar, 'probe-jar-content\n');
  const probeMd5 = execFileSync('md5sum', [probeJar], { encoding: 'utf8' }).trim().split(/\s+/)[0];
  const probeState = path.join(tmp, 'live-probe.json');
  fs.writeFileSync(probeState, JSON.stringify({ schema: 'live-deploy-state/1', jar: { commit: credMain, version: '9.9.9', branch: 'main', md5: probeMd5, path: '/opt/dead/legacy.jar' } }));
  // 绿路（本缺陷回归锁）：jar.path 指向不存在死文件 + jarProbe 给出实物 md5=基线 → 0（v2.63.0 及以前 ssh 死路径=红）
  const dpProbeGreen = dpRunC(['--branch', 'main', '--state-file', probeState, '--jar-probe', `md5sum ${probeJar}`]);
  ok(dpProbeGreen.status === 0 && /✓ 实况核验.*jarProbe 实物探针/.test(dpProbeGreen.stdout), 'jarProbe 绿路：jar.path 死文件+探针实物 md5=基线 → 0（死路径对账假绿回归锁，实物判据优先）');
  // 红路：探针给出不同 md5 → 1 漂移
  const dpProbeRed = dpRunC(['--branch', 'main', '--state-file', probeState, '--jar-probe', 'echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  /x"']);
  ok(dpProbeRed.status === 1 && /实况核验.*≠ 基线登记/.test(dpProbeRed.stdout + dpProbeRed.stderr), 'jarProbe 红路：探针实物 md5 ≠ 基线 → 1 漂移（未登记部署/手工动包可见）');
  // 防呆路：探针输出非 md5 → 1（探针命令写错防呆，禁静默放行）
  const dpProbeBad = dpRunC(['--branch', 'main', '--state-file', probeState, '--jar-probe', 'echo not-a-hash']);
  ok(dpProbeBad.status === 1 && /非 md5/.test(dpProbeBad.stdout + dpProbeBad.stderr), 'jarProbe 防呆路：探针输出非 32 位 hex → 1（探针命令写错不静默放行）');
  // deploy 入口透传：project.json deploy.jarProbe → preflight --jar-probe（防呆红=透传真实到达，同 procProbe 透传模式）
  const probeStateOk = path.join(tmp, 'live-probe-ok.json');
  fs.writeFileSync(probeStateOk, JSON.stringify({ schema: 'live-deploy-state/1', jar: { commit: mainSha, version: '0.0.0', branch: 'main', md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', path: '/opt/app/app.jar' } }));
  pjDeploy.deploy.jarProbe = 'echo not-a-hash';
  fs.writeFileSync(path.join(tasksDir, 'project.json'), JSON.stringify(pjDeploy, null, 2) + '\n');
  const depJarProbeBad = run(['deploy', '--branch', 'main', '--state-file', probeStateOk, '--dry-run'], repo);
  ok(depJarProbeBad.status === 1 && /拒绝部署/.test(depJarProbeBad.stdout) && /实况核验/.test(depJarProbeBad.stdout + depJarProbeBad.stderr), 'deploy 入口 jarProbe 透传：deploy.jarProbe → --jar-probe（探针防呆红=透传到达）');
  delete pjDeploy.deploy.jarProbe;
  fs.writeFileSync(path.join(tasksDir, 'project.json'), JSON.stringify(pjDeploy, null, 2) + '\n');
  // doctor I17 配置入口放宽：仅 jarProbe（无 jarPath）→ 走到对账逻辑（base 空=无登记提示），不再被「无 deploy 配置」拒收
  pjDeploy.deploy.jarProbe = `md5sum ${probeJar}`;
  pjDeploy.deploy.server = pjDeploy.deploy.server || 'fixture-host';
  fs.writeFileSync(path.join(tasksDir, 'project.json'), JSON.stringify(pjDeploy, null, 2) + '\n');
  const doc17Probe = run(['doctor'], repo);
  ok(/I17 live-state 无 jar\.md5 登记/.test(doc17Probe.stdout), 'doctor I17 配置入口：仅 jarProbe 无 jarPath → 走到对账逻辑（fixture 无服务器=base 空），不再被「无 deploy 配置」拒收');
  delete pjDeploy.deploy.jarProbe;
  fs.writeFileSync(path.join(tasksDir, 'project.json'), JSON.stringify(pjDeploy, null, 2) + '\n');

  // ---- v2.65.0 mech 统一入口 + 机械确认闸：统一采纳对账谓词（mech ls/check/doctor 同源单点）+ install --yes 确认闸（夹具真跑，硬规则 17）----
  // 场景源：历史项目实证——编排层在「已装但版本不符（采纳漂移）」时未经用户拍板直接 mech install 刷新项目侧文件
  // （DEP_ASK_GATE 要求先拍板，无机械闸靠自觉）+ 采纳对账检测逻辑 doctor/mech 两份实现有漂移风险
  // （2026-10-16 用户拍板「检查、配置必须统一入口 + 机械确认闸」）。
  const skillVer = fs.readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8').match(/^version:\s*(\S+)/m)[1];
  const repo3 = path.join(tmp, 'repo3');
  fs.mkdirSync(repo3, { recursive: true });
  sh('git init -q -b main && git config user.email t@t.local && git config user.name t && echo ".taskflow/" >> .git/info/exclude && echo x > f.txt && git add -A && git commit -qm init', repo3);
  const td3 = path.join(repo3, '.taskflow');
  fs.mkdirSync(td3, { recursive: true });
  fs.writeFileSync(path.join(td3, 'project.json'), J({ key: 'sandbox/repo3', name: 'repo3', repoRoot: repo3, remote: null, git: true, createdAt: now, lastActiveAt: now }));
  fs.writeFileSync(path.join(td3, 'index.json'), J({ tasks: [] }));
  // ③ 首装空位不拦：无 --yes 直接落盘（懒加载保持——首装确认归 DEP_ASK_GATE 呈报流程，闸只拦漂移刷新/覆盖已有文件）
  const gate3 = path.join(repo3, 'scripts/harness/validate-decision-combo-gate.sh');
  const mFirst = run(['mech', 'install', '决策组合门'], repo3);
  ok(mFirst.status === 0 && fs.existsSync(gate3) && !/确认闸/.test(mFirst.stdout), 'mech install 首装空位：无 --yes 直接落盘不拦（懒加载体验回归锁，首装确认分工归 DEP_ASK_GATE 呈报流程）');
  // ① 漂移刷新无 --yes：拒绝落盘 + 将覆盖文件清单可见 + 显式确认指引
  const pjP3 = path.join(td3, 'project.json');
  const pj3 = JSON.parse(fs.readFileSync(pjP3, 'utf8'));
  pj3.mechanisms['决策组合门'].version = '0.0.1';
  fs.writeFileSync(pjP3, JSON.stringify(pj3, null, 2) + '\n');
  const gate3Before = fs.readFileSync(gate3, 'utf8');
  const mDriftNo = run(['mech', 'install', '决策组合门'], repo3);
  ok(mDriftNo.status === 1 && /确认闸/.test(mDriftNo.stdout) && /采纳漂移刷新/.test(mDriftNo.stdout) && /将覆盖文件清单/.test(mDriftNo.stdout) && /mech install 决策组合门 --yes/.test(mDriftNo.stdout), 'mech install 确认闸①：漂移刷新无 --yes → 拒绝落盘 + 原因/清单/确认指引可见');
  ok(JSON.parse(fs.readFileSync(pjP3, 'utf8')).mechanisms['决策组合门'].version === '0.0.1' && fs.readFileSync(gate3, 'utf8') === gate3Before, 'mech install 确认闸①：拒绝路径零落盘（登记版本与产物 byte 级不变）');
  // ①续 --yes：落盘 + 版本对账转一致（doctor 与 mech check 双双转绿——统一谓词两侧同源）
  const mDriftYes = run(['mech', 'install', '决策组合门', '--yes'], repo3);
  const pj3y = JSON.parse(fs.readFileSync(pjP3, 'utf8'));
  ok(mDriftYes.status === 0 && pj3y.mechanisms['决策组合门'].version === skillVer, `mech install 确认闸①：--yes 落盘 + 采纳登记刷回当前技能版本 v${skillVer}`);
  const doc3g = run(['doctor'], repo3);
  const chk3g = run(['mech', 'check'], repo3);
  ok(!/采纳漂移/.test(doc3g.stdout) && /采纳对齐：决策组合门/.test(doc3g.stdout) && chk3g.status === 0 && /决策组合门 — 一致/.test(chk3g.stdout), '统一对账出口：--yes 刷新后 doctor 采纳对账与 mech check 双双转绿（同谓词同结论）');
  // ② 覆盖已有文件（非漂移场景）：同版本但产物被本地定制 → 整文件覆盖须 --yes（v2.62.0「覆盖即删本地定制」悬险的机械闸）
  fs.appendFileSync(gate3, '\n# 本地定制段：不许被静默覆盖\n');
  const mLocalNo = run(['mech', 'install', '决策组合门'], repo3);
  ok(mLocalNo.status === 1 && /将整文件覆盖已有文件/.test(mLocalNo.stdout) && /validate-decision-combo-gate\.sh/.test(mLocalNo.stdout), 'mech install 确认闸②：同版本已有文件将被整文件覆盖 → 拒绝 + 点名文件');
  ok(fs.readFileSync(gate3, 'utf8').includes('本地定制段'), 'mech install 确认闸②：拒绝路径本地定制原样保留');
  const mLocalYes = run(['mech', 'install', '决策组合门', '--yes'], repo3);
  ok(mLocalYes.status === 0 && !fs.readFileSync(gate3, 'utf8').includes('本地定制段'), 'mech install 确认闸②：--yes 后按模板覆盖（整文件覆盖语义显式化，不再静默）');
  // ④ doctor 采纳漂移输出与统一谓词一致：同一漂移 fixture，doctor ⚠ 行与 mech check 漂移行指向同一结论（同 token/同版本差/同刷新指引）
  const pj3d = JSON.parse(fs.readFileSync(pjP3, 'utf8'));
  pj3d.mechanisms['决策组合门'].version = '0.0.2';
  fs.writeFileSync(pjP3, JSON.stringify(pj3d, null, 2) + '\n');
  const doc3d = run(['doctor'], repo3);
  const chk3d = run(['mech', 'check'], repo3);
  const docLine = doc3d.stdout.split('\n').find((l) => l.includes('决策组合门') && l.includes('快照版本不符')) ?? '';
  const chkLine = chk3d.stdout.split('\n').find((l) => l.includes('决策组合门') && l.includes('漂移')) ?? '';
  ok(doc3d.status === 1 && chk3d.status === 1 && /登记 v0\.0\.2/.test(docLine) && /登记 v0\.0\.2/.test(chkLine) && docLine.includes('mech install 决策组合门') && chkLine.includes('mech install 决策组合门'), 'doctor ↔ mech check 同源：同一漂移账两出口同 token/同版本差/同刷新指引（检测单点 mechAdoptionRows，禁止两份实现）');
  ok(/将覆盖文件清单先行，--yes 确认/.test(docLine), 'doctor 采纳漂移文案：保留重跑指引 + 补确认闸语义（将覆盖文件清单先行，--yes 确认）');

  // ---- 2.67.0 REQ_ANCHOR_GATE：需求基线对照门（mech install + 双模式真执行夹具，硬规则 17/27）----
  // 场景源：任务列表行显示口径 2026-09-29 方案稿拍板后 PRD 无感知（回写只落 F-EX-12 并入语义），拍板产物住任务
  // 局部档案归档即失联，19 天后用户发现线上行为偏离基线——六道相邻门全放行。用户拍板 BASELINE_GATE 行为级锚定。
  {
    const rgGate = path.join(repo2, 'scripts/harness/validate-baseline-anchor-gate.sh');
    // install：既有 validate-changelog.sh 被本地改动（陈旧副本）→ 渲染 union 刷新整文件覆盖过 --yes 确认闸
    const rgVcl = path.join(repo2, 'scripts/harness/validate-changelog.sh');
    fs.appendFileSync(rgVcl, '\n# 本地定制段（模拟陈旧副本）\n');
    const rgNo = run(['mech', 'install', 'REQ_ANCHOR_GATE'], repo2);
    ok(rgNo.status === 1 && /确认闸/.test(rgNo.stdout) && /validate-changelog\.sh/.test(rgNo.stdout) && fs.readFileSync(rgVcl, 'utf8').includes('本地定制段'), 'REQ_ANCHOR_GATE 确认闸：validate-changelog.sh 将被整文件覆盖 → 无 --yes 拒绝且本地副本零改动');
    const rgInst = run(['mech', 'install', 'REQ_ANCHOR_GATE', '--yes'], repo2);
    ok(rgInst.status === 0 && fs.existsSync(rgGate) && fs.readFileSync(rgGate, 'utf8').includes('基线外条目草案'), 'REQ_ANCHOR_GATE install：门脚本落位（mech 渲染 union 随链）');
    ok(fs.readFileSync(path.join(repo2, 'scripts/harness/validate-changelog.sh'), 'utf8').includes('validate-baseline-anchor-gate.sh'), 'REQ_ANCHOR_GATE install：validate-changelog 串接段随模板落位');
    const pjRG = JSON.parse(fs.readFileSync(path.join(td2, 'project.json'), 'utf8'));
    ok(pjRG.mechanisms && pjRG.mechanisms.REQ_ANCHOR_GATE, 'REQ_ANCHOR_GATE install：project.json mechanisms 采纳登记');
    ok(fs.readFileSync(clD, 'utf8').includes('基线对照门落地'), 'REQ_ANCHOR_GATE install：CHANGELOG 补锚点「基线对照门落地」');
    const docRG = run(['doctor'], repo2);
    ok(/采纳对齐：REQ_ANCHOR_GATE/.test(docRG.stdout), 'doctor 采纳对账：REQ_ANCHOR_GATE 装后对齐');
    // 延迟激活：docs/prd 不存在 → --spec 与默认模式双双 WARN 放行 exit 0（对齐 DOC_SYNC_GATE 先例，存量项目零破坏）
    const rgDelayDir = path.join(td2, 'rg-delay-20260101');
    fs.mkdirSync(rgDelayDir, { recursive: true });
    const rgSpecDelay = path.join(rgDelayDir, 'spec.md');
    fs.writeFileSync(rgSpecDelay, '# Spec\n\n## 验收标准\n\n- [ ] 无锚行（验证：目测）\n');
    const rgDelay = spawnSync('bash', [rgGate, '--spec', rgSpecDelay, '--base', 'main'], { cwd: repo2, encoding: 'utf8' });
    ok(rgDelay.status === 0 && /未激活/.test(rgDelay.stdout + rgDelay.stderr), '基线对照门延迟激活：项目无 docs/prd/ → WARN 放行 exit 0（无锚 spec 也不红）');
    const rgWarn = spawnSync('bash', [rgGate], { cwd: repo2, encoding: 'utf8' });
    ok(rgWarn.status === 0 && /未激活/.test(rgWarn.stdout + rgWarn.stderr), '基线对照门延迟激活：默认模式（收尾串接口）同 WARN 放行');
    // PRD 夹具：AI 域条目三枚（F-EX-12 / F-EX-15 / US-EX-01），提交为基线
    fs.mkdirSync(path.join(repo2, 'docs/prd/ai'), { recursive: true });
    const prdF = path.join(repo2, 'docs/prd/ai/functional.md');
    fs.writeFileSync(prdF, '# AI 域功能\n\n## F-EX-12 任务列表并入\n\n- 谁进列表/去重/轮询接管。\n\n## F-EX-15 分享卡片\n\n- 分享卡片口径。\n\n## US-EX-01 上报流\n\n- 用户上报流程。\n');
    sh('git add docs/prd && git commit -qm prd-baseline', repo2);
    const rp = () => execFileSync('git', ['-C', repo2, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const rgTaskJson = (id, extra) => JSON.stringify({ id, title: '基线门夹具', goal: 'g', tier: 'medium', anchor: 'attached', status: 'active', branch: null, worktree: null, baseBranch: 'main', createdAt: now, lastActiveAt: now, sessionID: 'ses_rg', checkpoints: [], subtasks: [], ...extra }, null, 2);
    const rgRun = (spec, extraArgs = []) => spawnSync('bash', [rgGate, '--spec', spec, ...extraArgs], { cwd: repo2, encoding: 'utf8' });
    // 红① B1：无锚验收行 → exit 1 且报文点名该行
    const rgADir = path.join(td2, 'rg-a-20260101');
    fs.mkdirSync(rgADir, { recursive: true });
    const rgSpecA = path.join(rgADir, 'spec.md');
    fs.writeFileSync(rgSpecA, '# Spec\n\n## 验收标准\n\n- [ ] 列表保留未完成条目（验证：目测；设计技术：等价类；基线：F-EX-12）\n- [ ] 行内容=标题+时间（验证：目测；设计技术：等价类）\n');
    const rgA = rgRun(rgSpecA, ['--base', 'main']);
    ok(rgA.status === 1 && /无锚验收行（B1）/.test(rgA.stdout + rgA.stderr) && /行内容=标题\+时间/.test(rgA.stdout + rgA.stderr) && !/列表保留未完成条目.*无锚/.test(rgA.stdout + rgA.stderr), '基线对照门红①B1：无锚验收行 → exit 1 且报文逐行点名（有锚行不误报）');
    // 红② B2：「见方案稿」非法锚 → exit 1
    const rgBDir = path.join(td2, 'rg-b-20260101');
    fs.mkdirSync(rgBDir, { recursive: true });
    const rgSpecB = path.join(rgBDir, 'spec.md');
    fs.writeFileSync(rgSpecB, '# Spec\n\n## 验收标准\n\n- [ ] 行内容=标题+时间（验证：目测；基线：见方案稿）\n');
    const rgB = rgRun(rgSpecB, ['--base', 'main']);
    ok(rgB.status === 1 && /非法锚形态（B2）/.test(rgB.stdout + rgB.stderr), '基线对照门红②B2：「见方案稿」非法锚 → exit 1（堵引用方案稿当锚绕过）');
    // 红③ B3：草案登记但分支 diff 无预填条目 → exit 1（baseCommit 优先于 --base 的解析路径同轮覆盖）
    const rgCDir = path.join(td2, 'rg-c-20260101');
    fs.mkdirSync(rgCDir, { recursive: true });
    const rgSpecC = path.join(rgCDir, 'spec.md');
    fs.writeFileSync(rgSpecC, '# Spec\n\n## 验收标准\n\n- [ ] 行内容=标题+时间（验证：目测；基线外：D-1）\n\n## 基线外条目草案\n\n| 草案 ID | 行为口径（一句话原文） | 出处血缘 | 用户确认 | PRD 去向（预填下一个空号） |\n| --- | --- | --- | --- | --- |\n| D-1 | 行内容=标题+时间 | 方案稿-b1.html（2026-09-29） | 2026-09-29 方案稿拍板 | F-EX-13 |\n');
    fs.writeFileSync(path.join(rgCDir, 'task.json'), rgTaskJson('rg-c-20260101', { baseCommit: rp() }));
    fs.mkdirSync(path.join(repo2, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo2, 'src', 'rg-c.ts'), 'export const c = 1;\n');
    sh('git add src && git commit -qm rg-c', repo2);
    const rgC = rgRun(rgSpecC);
    ok(rgC.status === 1 && /草案 D-1 未升格（B3）/.test(rgC.stdout + rgC.stderr) && /F-EX-13/.test(rgC.stdout + rgC.stderr), '基线对照门红③B3：草案登记但 diff 无预填条目 F-EX-13 → exit 1（baseCommit 解析路径）');
    // 红④ B4：PRD 新条目被静默改动且四路无留痕 → exit 1 点名条目
    const rgDDir = path.join(td2, 'rg-d-20260101');
    fs.mkdirSync(rgDDir, { recursive: true });
    const rgSpecD = path.join(rgDDir, 'spec.md');
    fs.writeFileSync(rgSpecD, '# Spec\n\n## 验收标准\n\n- [ ] 列表保留未完成条目（验证：目测；基线：F-EX-12）\n');
    fs.writeFileSync(path.join(rgDDir, 'task.json'), rgTaskJson('rg-d-20260101', { baseCommit: rp() }));
    fs.appendFileSync(prdF, '\n## F-EX-16 静默新条目\n\n- 被静默改写的口径。\n');
    sh('git add docs/prd && git commit -qm rg-d', repo2);
    const rgD = rgRun(rgSpecD);
    ok(rgD.status === 1 && /PRD 反向留痕缺失（B4）/.test(rgD.stdout + rgD.stderr) && /F-EX-16/.test(rgD.stdout + rgD.stderr), '基线对照门红④B4：PRD 被静默改写四路无留痕 → exit 1 点名 F-EX-16');
    // 绿路：全锚 + 草案已升格（新增条目文件）+ goalHash 一致 + B4 留痕走草案去向 → exit 0
    const rgGDir = path.join(td2, 'rg-green-20260101');
    fs.mkdirSync(rgGDir, { recursive: true });
    const rgSpecG = path.join(rgGDir, 'spec.md');
    fs.writeFileSync(rgSpecG, '# Spec\n\n## 目标\n\n行显示口径落 PRD 并实现\n\n## 验收标准\n\n- [ ] 行内容=标题+时间（验证：grep dist；设计技术：等价类；基线：F-EX-12）\n- [ ] 上报流程可用（验证：e2e；设计技术：状态迁移；基线：US-EX-01）\n- [ ] 静默区新口径（验证：目测；基线外：D-1）\n\n## 基线外条目草案\n\n| 草案 ID | 行为口径（一句话原文） | 出处血缘 | 用户确认 | PRD 去向（预填下一个空号） |\n| --- | --- | --- | --- | --- |\n| D-1 | 静默区新口径 | 本任务方案稿 | 2026-10-18 方案稿拍板 | F-EX-13 |\n');
    const rgCoreHash = (txt) => {
      const secs = {}; let curS = null;
      for (const l of txt.split('\n')) {
        const h = l.match(/^##\s+(.+?)\s*$/);
        if (h) { curS = h[1].trim(); continue; }
        if (curS) (secs[curS] = secs[curS] ?? []).push(l);
      }
      const grab = (name) => (secs[name] ?? []).map((l) => l.replace(/\[(x|X|\s)\]/g, '[ ]').trim()).filter(Boolean);
      return createHash('sha1').update([...grab('目标'), ...grab('验收标准')].join('\n')).digest('hex').slice(0, 12);
    };
    fs.writeFileSync(path.join(rgGDir, 'task.json'), rgTaskJson('rg-green-20260101', { baseCommit: rp(), goalHash: rgCoreHash(fs.readFileSync(rgSpecG, 'utf8')), goalHashAt: now }));
    fs.writeFileSync(path.join(repo2, 'docs/prd/ai/user-stories.md'), '# AI 域用户故事\n\n## F-EX-13 行内容口径\n\n- 上报任务列表行内容=标题+时间（升格自草案 D-1，出处 iter-comment：rg 任务）。\n');
    fs.writeFileSync(path.join(repo2, 'src', 'rg-green.ts'), 'export const g = 1;\n');
    sh('git add docs/prd src && git commit -qm rg-green', repo2);
    const rgG = rgRun(rgSpecG);
    ok(rgG.status === 0 && /五检查通过/.test(rgG.stdout), `基线对照门绿路：全锚+草案升格+goalHash 一致+B4 走草案去向 → exit 0（${(rgG.stdout + rgG.stderr).split('\n').find((l) => l.includes('baseline-gate')) ?? ''}）`);
    // 红⑤ B5：goalHash 篡改 → exit 1（复用 I11 判定）
    fs.writeFileSync(path.join(rgGDir, 'task.json'), rgTaskJson('rg-green-20260101', { baseCommit: rp(), goalHash: 'deadbeef123', goalHashAt: now }));
    const rgH = rgRun(rgSpecG);
    ok(rgH.status === 1 && /goalHash 不一致（B5）/.test(rgH.stdout + rgH.stderr), '基线对照门红⑤B5：goalHash 失配 → exit 1（spec 承重节被改未经 req-confirm）');
    // 收尾模式 C1/C2：锚点已插入 + docs/prd 在位 → 条目级红绿
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-05 — 功能条目\n\n- 涉及文件：`src/a.ts`\n- 做了什么：新功能\n- commits：aaa1111\n- 文档同步：F-EX-99\n\n## 2026-01-02 — 基线对照门落地\n\n- 锚点\n');
    const rgC1 = spawnSync('bash', [rgGate], { cwd: repo2, encoding: 'utf8' });
    ok(rgC1.status === 1 && /查无 PRD 条目：F-EX-99/.test(rgC1.stdout + rgC1.stderr), '基线对照门收尾 C1 红：文档同步行列出不存在的条目 F-EX-99 → exit 1');
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-05 — PRD 改动条目\n\n- 涉及文件：`docs/prd/ai/functional.md`\n- 做了什么：排版\n- commits：bbb2222\n- 文档同步：不适用——纯排版\n\n## 2026-01-02 — 基线对照门落地\n\n- 锚点\n');
    const rgC1b = spawnSync('bash', [rgGate], { cwd: repo2, encoding: 'utf8' });
    ok(rgC1b.status === 1 && /禁写「不适用」/.test(rgC1b.stdout + rgC1b.stderr), '基线对照门收尾 C1 红②：触及 docs/prd/** 却写「不适用」→ exit 1（自相矛盾）');
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-05 — PRD 改动条目\n\n- 涉及文件：`docs/prd/ai/functional.md`\n- 做了什么：更新条目\n- commits：ccc3333\n- 文档同步：docs/prd/ai/functional.md\n\n## 2026-01-02 — 基线对照门落地\n\n- 锚点\n');
    const rgC2 = spawnSync('bash', [rgGate], { cwd: repo2, encoding: 'utf8' });
    ok(rgC2.status === 1 && /无条目 ID（C2）/.test(rgC2.stdout + rgC2.stderr), '基线对照门收尾 C2 红：引 PRD 路径无条目 ID → exit 1（须落条目粒度）');
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-05 — PRD 改动条目\n\n- 涉及文件：`docs/prd/ai/functional.md`\n- 做了什么：更新条目\n- commits：ddd4444\n- 文档同步：F-EX-12 行显示口径并入本条\n\n## 2026-01-02 — 基线对照门落地\n\n- 锚点\n');
    const rgCok = spawnSync('bash', [rgGate], { cwd: repo2, encoding: 'utf8' });
    ok(rgCok.status === 0 && /条目 ID 留痕合规/.test(rgCok.stdout), '基线对照门收尾绿：文档同步行带真实条目 ID → exit 0');
    // validate-changelog 串接（本门入收尾链；条目同时喂饱前三个门）
    fs.writeFileSync(clD, '# CHANGELOG\n\n## 2026-01-05 — 前端改动\n\n- 涉及文件：`src/a.ts`\n- 做了什么：改样式\n- commits：abc1234\n- 组合评估：语义中性——测试夹具\n- 规格表：不适用——纯逻辑无视觉变更\n- 基线：不适用——纯逻辑无视觉变更\n- 文档同步：F-EX-12\n\n## 2026-01-02 — 基线对照门落地\n\n- 锚点\n');
    const cRG = spawnSync('bash', [path.join(repo2, 'scripts/harness/validate-changelog.sh')], { cwd: repo2, encoding: 'utf8' });
    ok(cRG.status === 0 && cRG.stdout.includes('基线对照门'), 'validate-changelog 串接：基线对照门入收尾链全过');
  }

  // ---- 2.69.0：状态机机器源 + 事件日志 + revert-plan + gates + 守门 J 墙/K/E/T + skills --usage ----
  {
    // 状态机模块（纯函数直测）+ data.md 表对账 + STATUS 键集合一致
    const sm = await import('file://' + path.join(path.dirname(script), 'taskflow-state-machine.mjs'));
    ok(sm.STATES.length === 5 && sm.STATES.join(',') === 'active,verifying,parked,merged,archived', 'v2.69.0 状态机模块：STATES 五态枚举（archived 兼容保留，脚本从不写入）');
    ok(sm.TRANSITIONS.length === 7, 'v2.69.0 状态机模块：TRANSITIONS 7 行（对齐 data.md 状态机表）');
    for (const r of sm.TRANSITIONS) ok(sm.validateTransition(r.from, r.to, r.cmd).ok === true, `v2.69.0 validateTransition 合法路：${r.from ?? '（无）'}→${r.to} via ${r.cmd}`);
    for (const [f, t2, c, tag] of [['parked', 'verifying', 'commit --deployed', 'parked→verifying'], ['verifying', 'parked', 'park', 'verifying→parked'], ['merged', 'active', 'unpark', 'merged→active'], ['active', 'archived', 'archive', 'active→archived']]) {
      const v = sm.validateTransition(f, t2, c);
      ok(v.ok === false && /data\.md/.test(v.reason), `v2.69.0 validateTransition 非法路：${tag} → ok:false 且 reason 引 data.md 状态机表`);
    }
    // data.md 状态机表 ↔ TRANSITIONS 逐行对账（机器源 = 文档表镜像）
    const dataMd = fs.readFileSync(path.join(path.dirname(script), '..', 'references', 'data.md'), 'utf8');
    const smTable = dataMd.match(/## 状态机[\s\S]*?(?=\n## )/)?.[0] ?? '';
    const smRows = smTable.split('\n').filter((l) => /^\| (（无）|active|parked|verifying|merged) /.test(l));
    ok(smRows.length === sm.TRANSITIONS.length, `v2.69.0 表↔模块行数对账：data.md ${smRows.length} 行 = TRANSITIONS ${sm.TRANSITIONS.length} 行`);
    for (const l of smRows) {
      const c = l.split('|').map((x) => x.trim());
      const from = c[1] === '（无）' ? null : c[1];
      const to = c[3].includes('物理归层') ? 'archive/' : c[3];
      const cmdM = c[2].match(/tf\.mjs (.+?)`/) ?? c[2].match(/^(\S+)/);
      const toks = (cmdM?.[1] ?? '').replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean); // 剥 <占位>：accept <id> --pass → [accept,--pass]
      ok(sm.TRANSITIONS.some((r) => {
        if (r.from !== from || r.to !== to) return false;
        const rt = r.cmd.split(/\s+/);
        return rt.every((w, i) => toks[i] === w) && toks.length >= rt.length; // 命令 token 前缀匹配（表单元格含占位符/参数散文）
      }), `v2.69.0 表行对账：${from ?? '（无）'}→${to} via ${toks.join(' ')}`);
    }
    const tfSrc = fs.readFileSync(script, 'utf8');
    const stKeys = (tfSrc.match(/^const STATUS = \{(.+?)\};/m)?.[1] ?? '').match(/(\w+):/g)?.map((x) => x.replace(':', '')).sort().join(',') ?? '';
    ok(stKeys === [...sm.STATES].sort().join(','), 'v2.69.0 STATUS 显示映射键集合 === STATES（tf.mjs 与机器源对账）');
    ok(sm.isVerifying({ status: 'active', deploy: { status: 'verifying' } }) === true && sm.isVerifying({ status: 'parked' }) === false, 'v2.69.0 isVerifying 双源：deploy.status=verifying 命中 / parked 不命中');

    // 事件日志 + 写侧断言放行的命令级抽验（自建 ev-repo 夹具）
    const evRepo = path.join(tmp, 'ev-repo');
    fs.mkdirSync(path.join(evRepo, '.taskflow'), { recursive: true });
    sh('git init -q -b main && git config user.email t@t && git config user.name t', evRepo);
    fs.writeFileSync(path.join(evRepo, 'base.txt'), 'x\n');
    sh("echo '.taskflow/' >> .git/info/exclude && git add -A && git commit -qm init", evRepo);
    const evBase = execFileSync('git', ['-C', evRepo, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    const evNow = new Date().toISOString();
    sh('git checkout -q -b task/ev-a-20260101 && echo a > src-a.txt && git add -A && git commit -qm a && git checkout -q main', evRepo);
    const evDir = path.join(evRepo, '.taskflow', 'ev-a-20260101');
    fs.mkdirSync(evDir, { recursive: true });
    fs.writeFileSync(path.join(evDir, 'task.json'), J({ id: 'ev-a-20260101', title: '事件链主角', goal: 'g', tier: 'small', anchor: 'attached', status: 'active', branch: 'task/ev-a-20260101', baseCommit: evBase, createdAt: evNow, lastActiveAt: evNow, sessionID: 'ses_ev', subtasks: [], checkpoints: [] }));
    const evSpecW = () => fs.writeFileSync(path.join(evDir, 'spec.md'), '# Spec — 事件链主角\n\n## 目标\n\n事件链。\n\n## 验收标准\n\n- [ ] 好（验证：x）\n\n## 边界与影响面\n\n- **改动文件集合声明**：`src-a.txt`\n');
    evSpecW();
    fs.writeFileSync(path.join(evRepo, '.taskflow', 'index.json'), J({ tasks: [
      { id: 'ev-a-20260101', title: '事件链主角', status: 'active', tier: 'small', branch: 'task/ev-a-20260101', worktree: null, sessionID: 'ses_ev', createdAt: evNow, lastActiveAt: evNow },
    ] }));
    fs.writeFileSync(path.join(evRepo, '.taskflow', 'project.json'), J({ key: 'evproj', git: true }));
    const evEvents = () => fs.readFileSync(path.join(evRepo, '.taskflow', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const evPark = run(['park', 'ev-a-20260101', '--reason', '测试'], evRepo);
    const ePark = evEvents().pop();
    ok(evPark.status === 0 && ePark.task === 'ev-a-20260101' && ePark.from === 'active' && ePark.to === 'parked' && ePark.cmd === 'park' && !Number.isNaN(Date.parse(ePark.ts)), 'v2.69.0 事件日志：park 后尾行 {ts,task,from:active,to:parked,cmd:park}');
    const evUnpark = run(['unpark', 'ev-a-20260101'], evRepo);
    const eUn = evEvents().pop();
    ok(evUnpark.status === 0 && eUn.from === 'parked' && eUn.to === 'active' && eUn.cmd === 'unpark', 'v2.69.0 事件日志：unpark 后尾行 parked→active');
    sh('git checkout -q task/ev-a-20260101 && echo x >> src-a.txt && git add -A', evRepo);
    const evDep = run(['commit', '-m', '部署存档', '--all', '--session', 'ses_ev', '--deployed'], evRepo);
    const eDep = evEvents().pop();
    ok(evDep.status === 0 && eDep.from === 'active' && eDep.to === 'verifying' && eDep.cmd === 'commit --deployed', `v2.69.0 事件日志：--deployed 真翻转记事件${evDep.status ? ' ← ' + evDep.stdout + evDep.stderr : ''}`);
    sh('git checkout -q main && git merge -q --no-ff task/ev-a-20260101 -m merge-ev-a', evRepo);
    const evAcc = run(['accept', 'ev-a-20260101', '--pass'], evRepo);
    const eAcc = evEvents().pop();
    ok(evAcc.status === 0 && eAcc.from === 'verifying' && eAcc.to === 'merged' && eAcc.cmd === 'accept --pass', `v2.69.0 事件日志：accept --pass 翻转记事件${evAcc.status ? ' ← ' + evAcc.stdout + evAcc.stderr : ''}`);

    // revert-plan：非 merged 红 / merged 绿（只读不执行）
    const evBDir = path.join(evRepo, '.taskflow', 'ev-b-20260101');
    fs.mkdirSync(evBDir, { recursive: true });
    fs.writeFileSync(path.join(evBDir, 'task.json'), J({ id: 'ev-b-20260101', title: '非合并样例', goal: 'g', tier: 'small', anchor: 'attached', status: 'active', branch: null, createdAt: evNow, lastActiveAt: evNow, sessionID: 'ses_ev', subtasks: [], checkpoints: [] }));
    const rpNeg = run(['revert-plan', 'ev-b-20260101'], evRepo);
    ok(rpNeg.status === 1 && /非 merged/.test(rpNeg.stdout), 'v2.69.0 revert-plan 负路：active 任务 → exit 1（打回走 resume.md 第 9 步）');
    const rpGo = run(['revert-plan', 'ev-a-20260101'], evRepo);
    const rpFile = path.join(evDir, 'revert-plan.md');
    const rpText = fs.existsSync(rpFile) ? fs.readFileSync(rpFile, 'utf8') : '';
    ok(rpGo.status === 0 && rpText.includes('git revert -m 1') && rpText.trim().endsWith('本方案由 tf.mjs 生成，未执行任何 git 写操作——执行需用户逐条确认'), `v2.69.0 revert-plan 绿路：方案落盘含 revert 命令与「未执行」尾行${rpGo.status ? ' ← ' + rpGo.stdout + rpGo.stderr : ''}`);
    ok(rpText.includes('unmergedAt') && rpText.includes('resume.md 第 10 步'), 'v2.69.0 revert-plan 方案含档案注记（unmergedAt）与续迭代指引');
    ok(execFileSync('git', ['-C', evRepo, 'status', '--porcelain'], { encoding: 'utf8' }).trim() === '', 'v2.69.0 revert-plan 只读：git status --porcelain 干净（零 git 级变更）');

    // gates：双绿 verdict 可进合并 / 越界红
    const gGreen = run(['gates', 'ev-a-20260101'], evRepo);
    ok(gGreen.status === 0 && /快照门：过/.test(gGreen.stdout) && /越界门：过/.test(gGreen.stdout) && /已并入预检：过/.test(gGreen.stdout) && /stale：过/.test(gGreen.stdout) && /I16 敞口：过/.test(gGreen.stdout) && /gates verdict：0 红 0 黄——可进合并/.test(gGreen.stdout), `v2.69.0 gates 双绿：五道门全过 + verdict 可进合并${gGreen.status ? ' ← ' + gGreen.stdout + gGreen.stderr : ''}`);
    // 红路：分支追加声明集外提交（分支新提交未并入 main——越界门 diff 非空报红；同根预检红（未并入）+ stale 红（分支脱离主线），合计 3 红）
    sh('git checkout -q task/ev-a-20260101 && echo b > b-out.txt && git add -A && git commit -qm out-of-scope && git checkout -q main', evRepo);
    const gRed = run(['gates', 'ev-a-20260101'], evRepo);
    ok(gRed.status === 1 && /越界门：红/.test(gRed.stdout) && /gates verdict：3 红 0 黄——先消化红灯/.test(gRed.stdout), `v2.69.0 gates 红路：分支越界提交 → 越界+预检+stale 三红 + verdict 先消化红灯${gRed.status !== 1 ? ' ← ' + gRed.stdout + gRed.stderr : ''}`);

    // J 墙 / K / E / T（gproj 守门夹具伪造事件——遍历全部 tool_call handler，与宿主派发同序）
    const jcall = async (toolName, input, env = {}) => {
      for (const k of Object.keys(env)) process.env[k] = env[k];
      let out;
      for (const fn of handlers['tool_call'] ?? []) out = (await fn({ toolName, input }, mkCtx())) ?? out;
      for (const k of Object.keys(env)) delete process.env[k];
      return out;
    };
    const jT = path.join(gproj, '.taskflow', 'g-ver-20260101', 'task.json');
    const jOld = fs.readFileSync(jT, 'utf8');
    const jFlip = await jcall('write', { path: jT, content: JSON.stringify({ ...JSON.parse(jOld), status: 'active' }) });
    ok(jFlip?.block === true && /J 状态翻转墙/.test(jFlip.reason) && /TF_STATUS=off/.test(jFlip.reason), 'v2.69.0 J 墙 enforce（缺省）：write 手改 status → block，reason 含豁免指引');
    const jOff = await jcall('write', { path: jT, content: JSON.stringify({ ...JSON.parse(jOld), status: 'active' }) }, { TF_STATUS: 'off' });
    ok(jOff === undefined, 'v2.69.0 J 墙 off：TF_STATUS=off 单次豁免放行');
    const jWarn = await jcall('write', { path: jT, content: JSON.stringify({ ...JSON.parse(jOld), status: 'active' }) }, { TF_STATUS: 'warn' });
    ok(jWarn?.additionalContext && /J 状态翻转墙/.test(jWarn.additionalContext) && !jWarn.block, 'v2.69.0 J 墙 warn：警告档放行附 additionalContext');
    const jNote = await jcall('write', { path: jT, content: JSON.stringify({ ...JSON.parse(jOld), note: '备注变更' }) });
    ok(jNote === undefined, 'v2.69.0 J 墙误报面：纯 note 字段变更放行');
    const jNew = await jcall('write', { path: path.join(gproj, '.taskflow', 'g-new-20260101', 'task.json'), content: JSON.stringify({ id: 'g-new-20260101', status: 'active' }) });
    ok(jNew === undefined, 'v2.69.0 J 墙建档路：新文件 status=active 放行');
    const jNewV = await jcall('write', { path: path.join(gproj, '.taskflow', 'g-new2-20260101', 'task.json'), content: JSON.stringify({ id: 'g-new2-20260101', status: 'verifying' }) });
    ok(jNewV?.block === true, 'v2.69.0 J 墙建档路：新文件 status=verifying 拦（仅 active 可建档）');
    const jBad = await jcall('write', { path: jT, content: '{oops' });
    ok(jBad?.block === true && /坏档案/.test(jBad.reason), 'v2.69.0 J 墙：坏 JSON 视同违规拦截');
    const jEdit = await jcall('edit', { path: jT, old_string: '"status": "verifying"', new_string: '"status": "merged"' });
    ok(jEdit?.block === true && /status verifying→merged/.test(jEdit.reason), 'v2.69.0 J 墙 edit 通道：字面替换模拟检出翻转 → block');
    const jEditNote = await jcall('edit', { path: jT, old_string: '"title": "验收中"', new_string: '"title": "验收中二"' });
    ok(jEditNote === undefined, 'v2.69.0 J 墙 edit 通道：非状态字段替换放行');
    const jSed = await jcall('bash', { command: "sed -i 's/verifying/merged/' .taskflow/g-ver-20260101/task.json" });
    ok(jSed?.block === true && /J 状态翻转墙/.test(jSed.reason), 'v2.69.0 J 墙 bash 通道：sed -i 触及 task.json 且不含 tf.mjs → block');
    const jSedOff = await jcall('bash', { command: "sed -i 's/verifying/merged/' .taskflow/g-ver-20260101/task.json" }, { TF_STATUS: 'off' });
    ok(jSedOff === undefined, 'v2.69.0 J 墙 bash 通道：TF_STATUS=off 放行');
    const jTfmjs = await jcall('bash', { command: 'node tf.mjs park g-x --reason y' });
    ok(jTfmjs === undefined, 'v2.69.0 J 墙 bash 通道：tf.mjs 命令零干扰');
    const k1 = await jcall('bash', { command: 'git push origin main' });
    ok(k1?.additionalContext && /TASKFLOW_GUARD K/.test(k1.additionalContext) && /g-ver-20260101/.test(k1.additionalContext) && !k1.block, 'v2.69.0 K：verifying 在档时 git push → 提醒不拦（点名任务）');
    const k2 = await jcall('bash', { command: 'git push origin main' }, { TF_VERIFY_WARN: 'off' });
    ok(k2 === undefined, 'v2.69.0 K：TF_VERIFY_WARN=off 关闭提醒');
    const eLive = await call('before_provider_request', { payload: { system: 'BASE', messages: [] } });
    ok(typeof eLive?.system === 'string' && eLive.system.includes('taskflow 实况：') && /等验收 g-ver-20260101（部署 \d{2}-\d{2} \d{2}:\d{2}）/.test(eLive.system) && eLive.system.includes('活 g-live-20260101'), 'v2.69.0 E 实况行：活/等验收（部署短格式）注入 system');
    const tFile = path.join(tmp, 'skill-usage.jsonl');
    fs.rmSync(tFile, { force: true });
    await jcall('read', { path: 'skill://taskflow/SKILL.md' }, { TF_SKILL_USAGE: tFile });
    await jcall('read', { path: 'skill://x/references/y.md' }, { TF_SKILL_USAGE: tFile });
    await jcall('read', { path: '/etc/hosts' }, { TF_SKILL_USAGE: tFile });
    const tRows = fs.existsSync(tFile) ? fs.readFileSync(tFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    ok(tRows.length === 2 && tRows[0].skill === 'taskflow' && tRows[1].skill === 'x' && tRows.every((r) => r.project === 'guard-proj'), 'v2.69.0 T 埋点：skill:// 读取计数（非 skill 路径不记，技能名截去子路径，项目名取 cwd basename）');

    // skills --usage 报表
    const usgFile = path.join(tmp, 'usage-fix.jsonl');
    fs.writeFileSync(usgFile, [
      JSON.stringify({ ts: new Date().toISOString(), skill: 'taskflow', project: 'dx-snap-share' }),
      JSON.stringify({ ts: new Date().toISOString(), skill: 'taskflow', project: 'ev-repo' }),
      JSON.stringify({ ts: '2026-09-01T00:00:00Z', skill: 'code-review', project: 'old' }),
    ].join('\n'));
    const usg = spawnSync('node', [script, 'skills', '--usage'], { cwd: evRepo, encoding: 'utf8', env: { ...process.env, TF_SKILL_USAGE: usgFile } });
    ok(usg.status === 0 && /taskflow：总 2｜近 30 天 2/.test(usg.stdout) && /code-review：总 1｜近 30 天 0/.test(usg.stdout) && /全文零加载（仅描述常驻）/.test(usg.stdout) && usg.stdout.includes('不含描述常驻效果；Claude Code 侧不在统计内'), `v2.69.0 skills --usage：计数/近30天/零加载标注/口径尾行${usg.status ? ' ← ' + usg.stdout + usg.stderr : ''}`);
    const usgNone = spawnSync('node', [script, 'skills', '--usage'], { cwd: evRepo, encoding: 'utf8', env: { ...process.env, TF_SKILL_USAGE: path.join(tmp, 'no-such-usage.jsonl') } });
    ok(usgNone.status === 0 && /暂无埋点数据/.test(usgNone.stdout), 'v2.69.0 skills --usage：无埋点文件 → 暂无埋点数据 exit 0');
  }

  process.exitCode = failures ? 1 : 0; // 失败≠0：堵住链式调用「grep 匹配到失败文案也算成功」的放行洞
  console.log(failures ? `\n${failures} 项断言失败` : '\n全部通过');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
