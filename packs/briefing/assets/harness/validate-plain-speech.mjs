#!/usr/bin/env node
// validate-plain-speech.mjs — 呈报落稿门（PLAIN_SPEECH_GATE，v3.0.0 重写，F38/F39/F41）
// 检测四项（检测项从「锚词邻近」改为结构化）：
//   ① 禁用词表命中——技能自造词清单（换传统术语再写），命中即红并给替换建议；
//   ② 结构检查——首行必须是「一句话结论」；其后 ≤3 级展开；单段 ≤4 句；总长 ≤40 行；
//   ③ 代号裸奔照旧禁——机制 token（ASCII 代号集，真源=references/schemas/mechanisms.json）未带括号解释直接出现；
//   ④ 可懂度抽检——文末必含「不看上下文也能懂的检验问题」≥1 条（自检：读者不问人能否核对结论）。
// 词表面向「面向用户的稿件」；项目行话从 <项目根>/.taskflow/glossary.md 合并（白话层，非禁用层）。
// 退出码：0 绿 / 1 红（逐条点名）。用法：node validate-plain-speech.mjs <稿.md> [<更多稿>...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'); // packs/briefing/assets/harness → 技能仓根（四级）

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

// ① 禁用词表（F39：自造词→传统术语；命中=红+替换建议）。增删只改本表。
const BANNED = [
  ['扳机', '触发条件/触发命令'],
  ['敞口', '未收口的风险窗口'],
  ['收口', '完成后续步骤'],
  ['游离', '未登记的'],
  ['归层', '归档'],
  ['让位', '优先/暂缓'],
  ['双活', '两个并行会话'],
  ['占号', '预留编号'],
  ['簿记', '登记/记录'],
  ['接力', '交接'],
  ['落痕', '留记录'],
  ['呈报稿', '提交给用户的报告'],
  ['咬合', '命中/拦截'],
  ['钉死', '固定'],
  ['根治', '彻底修复'],
];

// ③ 代号集：机制 token（真源 mechanisms.json；无 ASCII 字母的 token 不入集）
function loadTokens() {
  try {
    const j = JSON.parse(readText(path.join(SKILL_ROOT, 'references', 'schemas', 'mechanisms.json')));
    return (j.mechanisms ?? []).map((m) => String(m?.token ?? '')).filter((t) => /[A-Z]{2,}/.test(t));
  } catch { return []; }
}

// 项目词表（白话层）：从被检稿向上发现 <项目根>/.taskflow/glossary.md——「术语|大白话」行合并进白话提示层
function loadProjectPlain(fromFile) {
  let dir = path.dirname(path.resolve(fromFile));
  for (let hop = 0; hop < 10; hop++) {
    const p = path.join(dir, '.taskflow', 'glossary.md');
    if (fs.existsSync(p)) {
      const rows = [];
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!line.trim().startsWith('|')) continue;
        const cells = line.split('|').map((c) => c.trim());
        if (cells.length < 3 || !cells[1] || /^[-: ]+$/.test(cells[1]) || cells[1] === '行话') continue;
        rows.push([cells[1], cells[2] ?? '']);
      }
      return rows;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [];
}

const parasOf = (text) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const sentencesOf = (p) => p.split(/(?<=[。！？!?.])\s*/).filter((s) => s.trim());

function scan(file, tokens, violations) {
  const raw = readText(file);
  if (!raw.trim()) { violations.push(`${path.basename(file)}：文件为空`); return; }
  const lines = raw.split('\n');
  const text = raw;
  // ① 禁用词表
  for (const [word, replace] of BANNED) {
    const re = new RegExp(word, 'g');
    let m; let n = 0;
    while ((m = re.exec(text)) !== null) { n++; if (n > 3) break; }
    if (n) violations.push(`${path.basename(file)}：自造词「${word}」命中 ${n} 处 → 用传统术语（建议：${replace}）`);
  }
  // ③ 代号裸奔（token 后 12 字符内无括号/中文解释）
  for (const tk of tokens) {
    const re = new RegExp(`${tk}(?![^（()\\n]{0,12}[（(])`, 'g'); // 负前瞻：其后 12 个非括号字符内出现开括号=已带白话，不算裸奔（旧形态回溯会在短窗误匹配）
    let m;
    while ((m = re.exec(text)) !== null) {
      violations.push(`${path.basename(file)}：代号裸奔「${tk}」——首现须带括号大白话（DEPLOY_GATE（部署协调门：…）形）`);
      break;
    }
  }
  // ② 结构检查
  const paras = parasOf(text);
  const first = paras[0] ?? '';
  if (first.includes('\n') || sentencesOf(first).length > 1 || first.length > 80) violations.push(`${path.basename(file)}：首行必须是一句话结论（单句 ≤80 字；现状 ${sentencesOf(first).length} 句/${first.length} 字）`);
  let maxDepth = 0;
  for (const l of lines) { const h = l.match(/^(#{1,6})\s/); if (h) maxDepth = Math.max(maxDepth, h[1].length); if (/^\s{4,}\S/.test(l)) maxDepth = Math.max(maxDepth, 3); }
  if (maxDepth > 3) violations.push(`${path.basename(file)}：展开层级 >3（最深 ${maxDepth} 级）——扁平化或拆分`);
  for (const [i, p] of paras.slice(1).entries()) {
    if (/^[-*#|>]/m.test(p)) continue; // 列表/标题/表格段不按段落句数检
    const sc = sentencesOf(p).length;
    if (sc > 4) violations.push(`${path.basename(file)}：第 ${i + 2} 段 ${sc} 句（>4）——一段一中心，因果链超两跳列表化`);
  }
  if (lines.length > 40) violations.push(`${path.basename(file)}：总长 ${lines.length} 行（>40）——明细拆附件`);
  // ④ 可懂度抽检
  if (!/不看上下文也能懂的检验问题/.test(text)) violations.push(`${path.basename(file)}：文末缺「不看上下文也能懂的检验问题」节（≥1 条——自检读者不问人能否核对结论）`);
}

const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!files.length) { console.error('用法：node validate-plain-speech.mjs <呈报稿.md> [<更多稿>...]'); process.exit(1); }
const tokens = loadTokens();
const violations = [];
for (const f of files) scan(f, tokens, violations);
if (violations.length) {
  console.error(`⛔ [plain-speech] ${violations.length} 处待修（禁用词/结构/代号裸奔/可懂度抽检）：`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`✓ [plain-speech] ${files.length} 份稿件通过（禁用词 0/结构合规/代号带白话/可懂度抽检在位）`);
process.exit(0);
