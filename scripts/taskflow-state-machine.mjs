// taskflow-state-machine.mjs — 状态机唯一机器源（v2.69.0）
// data.md「状态机」表是文档版事实源，本模块是其机器可读镜像：tf.test.mjs 对账两者一致。
// 纪律：改状态机（增删状态/转换行）必须三处同步——本模块、references/data.md 表、
// assets/guard/taskflow-guard.js 的 STATE_SNAPSHOT 快照；漂移由 doctor --self / mech check 兜底。
// 状态翻转唯一写路径 = 各转换行的 cmd；手改 task.json/index.json 的 status = 违规（data.md:98），
// 宿主侧由守门 J 墙（TF_STATUS）物理兜底，档案修复唯一路径 node tf.mjs reconcile --fix。

export const STATES = ['active', 'verifying', 'parked', 'merged', 'archived'];
// archived：兼容保留枚举，脚本从不写入（data.md:80——生命周期不再使用，仅 adopt 标记备份类分支）

// 7 行转换，逐行对齐 data.md 状态机表（from=null 表示建档前；archive 行 to='archive/' 为物理归层，status 保持 merged 无翻转）
export const TRANSITIONS = [
  {
    from: null, event: '建档', cmd: 'new-task', to: 'active',
    precondition: '用户确认标题/目标/档位',
    undo: '无产出 → 删分支+worktree+档案即撤',
  },
  {
    from: 'active', event: '部署落定', cmd: 'commit --deployed', to: 'verifying',
    precondition: '—',
    undo: '分支未进 main：删分支即撤；已进 main：git revert -m 1 <merge-commit>',
  },
  {
    from: 'active', event: '验收通过（无部署约定项目）', cmd: 'accept --pass', to: 'merged',
    precondition: '任务分支已并入主分支（脚本 isAnc 强制）',
    undo: 'git revert -m 1 <merge-commit> + 档案记 unmergedAt',
  },
  {
    from: 'active', event: '搁置', cmd: 'park', to: 'parked',
    precondition: 'status=active 且非等验收（isVerifying 双源均拒——线上敞口须先收口）；--reason 必填',
    undo: 'tf.mjs unpark <id> 即撤',
  },
  {
    from: 'parked', event: '恢复', cmd: 'unpark', to: 'active',
    precondition: 'status=parked',
    undo: '再 park 即撤',
  },
  {
    from: 'verifying', event: '验收通过', cmd: 'accept --pass', to: 'merged',
    precondition: '任务分支已并入主分支（verify-first 先完成 merge.md §5 合并再翻转，脚本强制）',
    undo: 'git revert -m 1 <merge-commit> + 档案记 unmergedAt',
  },
  {
    from: 'merged', event: '归档归层', cmd: 'archive', to: 'archive/',
    precondition: 'decisions 无未晋升条目',
    undo: '终态；续迭代走 resume.md 第 10 步（不复活旧任务）',
  },
];

// 等验收判定（语义同 tf.mjs isVerifying，双源：顶层 status 或 deploy.status 任一命中）
export function isVerifying(t) {
  return t?.status === 'verifying' || t?.deploy?.status === 'verifying';
}

// 转换合法性白名单校验：from/to/cmd 三元组必须命中 TRANSITIONS 某行，未命中即违规。
// 纯函数零副作用——tf.mjs 写侧用 assertTransition 包装为硬断言，测试直接消费返回值。
export function validateTransition(from, to, cmd) {
  const hit = TRANSITIONS.find((r) => r.from === from && r.to === to && r.cmd === cmd);
  if (hit) return { ok: true, reason: `合法转换 ${describe(from)} → ${describe(to)} via ${cmd}` };
  const legal = TRANSITIONS
    .map((r) => `${describe(r.from)}→${r.to}（${r.cmd}）`)
    .join('、');
  return {
    ok: false,
    reason: `${describe(from)}→${describe(to)} via ${cmd} 不在状态机白名单——唯一事实源 data.md 状态机表；合法扳机：${legal}`,
  };
}

function describe(s) {
  return s === null ? '（无）' : String(s);
}
