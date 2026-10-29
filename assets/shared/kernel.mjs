// kernel.mjs — taskflow 共享内核（v2.86.0 单源共享内核）：状态机枚举/数据边界机械件的唯一机器源。
// 零 import 纯函数/常量模块——guard 渲染副本与项目侧产物经 mech install 内联展开后自包含（tf.mjs inlineSharedDeps）。
// 纪律：改这里 = 同时改两端（守门+CLI）——禁再建本地副本（此前 guard 与 tf.mjs 各持一份逐字副本，2026-10-29 三模式重构收编）。

// ---- 状态机枚举（与 scripts/taskflow-state-machine.mjs 的 TRANSITIONS、references/data.md 状态机表对账）----
export const STATES = ['active', 'verifying', 'parked', 'merged', 'archived'];
// archived：兼容保留枚举，脚本从不写入（data.md:80——生命周期不再使用，仅 adopt 标记备份类分支）

// [from, to] 白名单（from null=建档前）；archive 是物理归层无 status 翻转，不入本表
export const STATE_LEGAL = [
  [null, 'active'], ['active', 'verifying'], ['active', 'merged'],
  ['active', 'parked'], ['parked', 'active'], ['verifying', 'merged'],
];

// ---- 数据边界机械件（v2.72.0 起；v2.76.0 检索修正）----
// 词表补英文管道形态（i 志大小写）；算子补 reduce/aggregate + i 志 + SQL GROUP BY 形态；
// 注释行（//、/*、*、<!--、# 开头）剔除后再计数——注释/UI 文案里的词提及不算管道证据（真仓实测误报主源）
export const J20_WORD_RE = /环比|同比|上期|较上期|对比|排名|统计|previous[\s_-]*(?:period|month|week)|last[\s_-]*(?:period|month|week)|month[\s_-]*over[\s_-]*month|year[\s_-]*over[\s_-]*year/gi;
export const J20_CODE_RE = /\b(?:sum|count|avg|max|min|sort|reduce|aggregate)\s*\(/gi;
export function j20CodeLines(text) { // 特征探测窗口：首 500 行+尾 200 行（v2.76.0 D3④——固定 500 行窗口漏文件尾部管道）；注释行剔除（S10-8）
  const lines = String(text ?? '').split('\n');
  const win = lines.length > 700 ? [...lines.slice(0, 500), ...lines.slice(-200)] : lines;
  return win.filter((l) => { const t = l.trim(); return t && !/^(?:\/\/|\/\*|\*|<!--|#)/.test(t); });
}
export function j20Scan(text) { // 数据管道特征探测：词特征任一命中；代码特征须 ≥2 个不同算子（单 sort(/count( 全仓皆是无害噪音）；GROUP BY 单独记一算子
  const body = j20CodeLines(text).join('\n');
  const words = [...new Set(body.match(J20_WORD_RE) ?? [])];
  const codes = new Set((body.match(J20_CODE_RE) ?? []).map((s) => s.replace(/\s+/g, '')));
  if (/\bGROUP\s+BY\b/i.test(body)) codes.add('GROUP BY');
  return { hit: words.length > 0 || codes.size >= 2, detail: [...words, ...codes].slice(0, 6).join('、') };
}

// 同扩展名族映射（v2.77.1 F2b①）：非 .vue 目标的 basename 检索限定同语言扩展名族
// （share.ts 检索串「share」曾以整词命中 Java 注释/文案：dx-snap-share 实测报 80 个代码文件、真实 import 消费方 2 个，膨胀 40×）。
// 族外扩展名（映射表未覆盖）不设限，由 F2b② 跨语言歧义标注兜底；.vue=null（检索串带扩展名，限定 .vue 族会漏 .ts 消费方）
export const EXT_FAMILY = {
  '.ts': ['.ts', '.tsx', '.mts', '.cts'], '.tsx': ['.ts', '.tsx', '.mts', '.cts'], '.mts': ['.ts', '.tsx', '.mts', '.cts'], '.cts': ['.ts', '.tsx', '.mts', '.cts'],
  '.js': ['.js', '.jsx', '.mjs', '.cjs'], '.jsx': ['.js', '.jsx', '.mjs', '.cjs'], '.mjs': ['.js', '.jsx', '.mjs', '.cjs'], '.cjs': ['.js', '.jsx', '.mjs', '.cjs'],
  '.java': ['.java'], '.kt': ['.kt', '.kts'], '.kts': ['.kt', '.kts'], '.scala': ['.scala'], '.groovy': ['.groovy'],
  '.py': ['.py'], '.rb': ['.rb'], '.php': ['.php'], '.go': ['.go'], '.rs': ['.rs'], '.swift': ['.swift'], '.cs': ['.cs'],
  '.c': ['.c', '.h'], '.h': ['.c', '.h'], '.cpp': ['.cpp', '.cc', '.cxx', '.hpp'], '.cc': ['.cpp', '.cc', '.cxx', '.hpp'], '.cxx': ['.cpp', '.cc', '.cxx', '.hpp'], '.hpp': ['.cpp', '.cc', '.cxx', '.hpp'],
  '.vue': null,
};
