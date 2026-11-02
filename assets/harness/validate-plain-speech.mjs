#!/usr/bin/env node
// validate-plain-speech.mjs — PLAIN_SPEECH_GATE 呈报稿门（SKILL.md 硬规则 24；细则 references/plain-speech.md）
// 防的事故类：面向用户的呈报满篇未解释行话/名词定语堆栈/代号裸奔，人类读不懂（2026-10-09 用户实证）。
// 用法：node validate-plain-speech.mjs <呈报稿.md> [<更多稿>...]
// 词表（真源，不在此复述）：references/glossary.md（行话/大白话/锚词三列）
//                          + references/data.md 机制登记表 token 列（ASCII 代号集）
// 检测三项：①行话裸奔（±2 行内无锚词）②代号裸奔（同行代号后 80 字符内无括号）③超长句（剥行内代码后单句 >60 字）
// 词表（真源，不在此复述）：references/glossary.md（技能行话，三列）+ references/data.md 机制登记表 token 列（ASCII 代号集）
//                        + <项目根>/.taskflow/glossary.md（项目词表，可选层 v2.43.1：从被检稿向上发现，项目词覆盖同名的技能词）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

// ---- 词表加载 ----
function parseGlossary(text) {
  const rows = [];
  for (const line of (text ?? '').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const [term, plain, anchors] = [cells[1], cells[2], cells[3]];
    if (!term || !plain || /^[-: ]+$/.test(term) || term === '行话') continue;
    const anchorList = (anchors ?? '').split(/[、,，/]/).map((s) => s.trim()).filter(Boolean);
    rows.push({ term, plain, anchors: anchorList });
  }
  return rows;
}
// 项目词表（可选层，v2.43.1）：从被检稿路径向上找 <项目根>/.taskflow/glossary.md——存在即合并加载，项目词覆盖同名的技能词；不存在=静默只用技能词表
function loadProjectGlossaryText(fromFile) {
  let dir = path.dirname(path.resolve(fromFile));
  for (let hop = 0; hop < 10; hop++) {
    const p = path.join(dir, '.taskflow', 'glossary.md');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}
function loadGlossary() {
  return parseGlossary(readText(path.join(SKILL_ROOT, 'references', 'glossary.md')));
}
function loadTokens() {
  const text = readText(path.join(SKILL_ROOT, 'references', 'data.md'));
  const sec = text.match(/## 机制登记表[\s\S]*?(?=\n## |$)/)?.[0] ?? '';
  const tokens = [];
  for (const line of sec.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const t = cells[1] ?? '';
    if (!t || t === 'token') continue;
    if (/^[-A-Za-z_.][-A-Za-z0-9_.]*$/.test(t) && /[A-Z_]/.test(t) && t.length >= 3) tokens.push(t);
  }
  return tokens;
}

// ---- 检测 ----
const stripInlineCode = (s) => s.replace(/`[^`]*`/g, '');
const SENT_SPLIT = /[，。；：、！？!?,;:|（）()【】\[\]─│┌┐└┘├┤┬┴┼\s]+/; // 框线字符+空白均不当句子：终端框线表格的对齐空格会撑爆句长（2026-10-09 评分实测两轮误报，防假红）
const QUOTE_SPAN = /[「][^「」]*[」]|“[^”]*”|"[^"]*"/g; // 引号内容=引用/列举（含半角双引号——中文语境常用，对抗审查实证假红），行话/代号检测豁免；漏放行方向符合"宁可放过不误拦"

function scan(file, glossary, tokens, violations) {
  const text = readText(file);
  if (!text) { violations.push({ file, line: 0, type: '文件不可读', detail: file }); return; }
  const lines = text.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const bare = stripInlineCode(raw);
    if (!bare.trim()) continue;
    const bareTerms = bare.replace(QUOTE_SPAN, ''); // 行话/代号检测用剥引号版；超长句/段落检测保留原文（引号内长句仍算病）

    // ① 行话裸奔：命中行话词，±2 行窗口内无任一锚词
    for (const g of glossary) {
      if (!bareTerms.includes(g.term)) continue;
      const window = [i - 2, i - 1, i, i + 1, i + 2]
        .filter((j) => j >= 0 && j < lines.length)
        .map((j) => stripInlineCode(lines[j]).replace(QUOTE_SPAN, '')).join(' ');
      if (!g.anchors.some((a) => window.includes(a))) {
        violations.push({ file, line: i + 1, type: '行话裸奔', detail: `「${g.term}」附近 2 行内无解释（锚词：${g.anchors.join('/')}；大白话：${g.plain}）` });
      }
    }

    // ② 代号裸奔：ASCII 机制代号 / I<数字> 出现，代号后 80 字符窗口内无解释性括号对
    const codeTokens = [...tokens, ...Array.from(bareTerms.matchAll(/\bI\d+\b/g), (m) => m[0])];
    for (const t of new Set(codeTokens)) {
      let idx = bareTerms.indexOf(t);
      while (idx !== -1) {
        const after = bareTerms.slice(idx + t.length, idx + t.length + 80);
        // 2026-10-13 F1 收口：原 ^[（(] 只锚窗口首字符=要求括号紧邻代号（隔一个空格即误红，实证「DEPLOY_GATE 是部署协调门（…）」）；
        // 改为窗口内找解释性括号对。已知边界（防错不防骗）：紧邻代码引用括号如 GATE(参数)、foo() 同样命中放行——门不判定括号内是否真大白话。
        if (!/[（(][^（）()]*[）)]/.test(after)) {
          violations.push({ file, line: i + 1, type: '代号裸奔', detail: `「${t}」后 80 字符内无（大白话解释）——括号解释从机制登记表「大白话」列或 glossary.md 抄` });
        }
        idx = bareTerms.indexOf(t, idx + 1);
      }
    }

    // ③ 超长句：剥行内代码后单句 >60 字
    for (const sent of bare.split(SENT_SPLIT)) {
      if (sent.length > 60) {
        violations.push({ file, line: i + 1, type: '超长句', detail: `单句 ${sent.length} 字（>60）——名词定语堆栈信号，拆成带主谓的因果短句：「${sent.slice(0, 24)}…」` });
      }
    }
    // ③b 句号级超长句（v2.46.1，真样本实证盲区）：一句写到 80 字以上不落句号——冒号/破折号/括号串联的"合法碎片拼接"绕过细切检测
    //    分隔含半角句点+空白边界（v2.47.0 对抗审查：作者用 . 分隔多段不得计成一句假红；版本号 v2.46.1 后无空白不切）；表格行豁免（| 分隔结构非散文长句）
    if (!raw.trim().startsWith('|')) {
      for (const sent of bare.split(/(?:。|！|？|\.(?=\s|$))+/)) {
        if (sent.replace(/\s/g, '').length > 80) {
          violations.push({ file, line: i + 1, type: '超长句（句号级）', detail: `一「句」${sent.replace(/\s/g, '').length} 字不落句号（>80）——冒号/破折号/括号串联的长句信号，拆成独立短句` });
        }
      }
    }
    // ⑥ 列表项堆叠（v2.47.0 对抗审查实证）：规范"每项 1–3 句"机械化——列表行被段落检测豁免后项内无约束的盲区
    //    2026-10-13 F2 补编号列表（1. 形态）——原只匹配 -/*，编号项零约束（审查实跑 4 句编号项全绿）；
    //    口径对齐段落检测豁免（^\d+\./）与骨架统计 listRows（均认编号行）：编号项归列表项管、不归段落管
    const listMatch = raw.trim().match(/^(?:[-*]|\d+\.)\s+/);
    if (listMatch) {
      const item = bare.trim().replace(/^(?:[-*]|\d+\.)\s+/, '');
      const sents = item.split(/(?:。|！|？)+/).filter((s) => s.trim()).length;
      const chars = item.replace(/\s/g, '').length;
      if (sents > 3 || chars > 150) {
        violations.push({ file, line: i + 1, type: '列表项堆叠', detail: `列表项 ${sents} 句/${chars} 字（>3 句或 >150 字）——列表项 1–3 句，更长的内容升格为小节段落` });
      }
    }
  }

  // 第二遍（v2.46.0）：④段落堆叠 + ⑤装饰横幅——2026-10-09 用户截图实证「长句没分段没逻辑分层」「喜欢写横幅」
  let paraLines = [];
  let paraStart = 0;
  const flushPara = (endLine) => {
    if (!paraLines.length) return;
    const text = paraLines.map(stripInlineCode).join(' ');
    const chars = text.replace(/\s/g, '').length;
    const sents = text.split(/[。！？；?!]+/).filter((s) => s.trim()).length; // 粗粒度句读（句号级）——逗号顿号括号不算断句，与"一段≤4 句"的"句"同口径
    if (sents > 6 || chars > 200) {
      violations.push({ file, line: paraStart, type: '段落堆叠', detail: `连续文本 ${paraLines.length} 行 ${sents} 句/${chars} 字（>6 句或 >200 字）——一段一个中心 ≤4 句，因果链超两跳改列表` });
    }
    paraLines = [];
  };
  let fence2 = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) { flushPara(i + 1); fence2 = !fence2; continue; }
    if (fence2) continue;
    const t = stripInlineCode(raw).trim();
    if (/^[─═—=\-*]{8,}$/.test(t) && !raw.trim().startsWith('|')) {
      violations.push({ file, line: i + 1, type: '装饰横幅', detail: '整行装饰符号——分节用标题或空行，不画线（表格分隔行不受影响）' });
      flushPara(i + 1);
      continue;
    }
    if (!t || t.startsWith('|') || t.startsWith('│') || /^[┌├└┬┴┼┐┘]/.test(t) || t.startsWith('-') || t.startsWith('*') || /^\d+\./.test(t) || /^#/.test(t) || t.startsWith('>')) { flushPara(i + 1); continue; }
    if (!paraLines.length) paraStart = i + 1;
    paraLines.push(raw);
  }
  flushPara(lines.length);

  // ⑦ 无骨架（v2.47.0 对抗审查实证：600 字纯段落流每段独立合格、整体无结构）：纯段落总字数 >400 且骨架行（列表/表格/≥2 个标题）为零 → 红
  // ⑧ emoji 标题滥用（规范"每份输出 ≤1"机械化）：带 emoji 的标题行 >1 → 红
  let paraChars = 0;
  let listRows = 0;
  let tableRows = 0;
  let headingRows = 0;
  let emojiHeadings = 0;
  for (let i = 0; i < lines.length; i++) {
    const rawL = lines[i];
    if (/^\s*```/.test(rawL)) continue;
    const tl = stripInlineCode(rawL).trim();
    if (/^#{1,6}\s/.test(tl)) {
      headingRows++;
      if (/[📌⚠️✅🎯🔧🚀❗️]/u.test(tl)) emojiHeadings++;
    } else if (tl.startsWith('|') || tl.startsWith('│') || /^[┌├└┬┴┼]/.test(tl)) tableRows++;
    else if (/^[-*]\s+/.test(tl) || /^\d+\./.test(tl)) listRows++;
    else if (tl && !tl.startsWith('>')) paraChars += tl.replace(/\s/g, '').length;
  }
  if (paraChars > 350 && listRows === 0 && tableRows === 0 && headingRows < 2) { // 阈值 350：对齐规范"超 300 字须有骨架"留余量（v2.47.0 对抗审查定稿；初定 400 偏松实证）
    violations.push({ file, line: 1, type: '无骨架', detail: `纯段落 ${paraChars} 字（>350）且全文无表格/列表/分节标题——超 300 字的输出必须有显式骨架（规范 §3），纯段落流=不合格` });
  }
  if (emojiHeadings > 1) {
    violations.push({ file, line: 1, type: 'emoji 标题滥用', detail: `${emojiHeadings} 个带 emoji 的标题（规范 ≤1）——emoji 标题仅用于真正的清单/多节内容且每份输出至多 1 个` });
  }
}

// ---- main ----
const files = process.argv.slice(2);
if (!files.length) { console.error('用法：node validate-plain-speech.mjs <呈报稿.md> [...]'); process.exit(1); }
const baseGlossary = loadGlossary();
const tokens = loadTokens();
if (!baseGlossary.length) { console.error('⛔ [plain-speech] 词表空：references/glossary.md 不可解析'); process.exit(1); }
const violations = [];
let maxGlossary = baseGlossary.length;
let projectLayers = 0;
for (const f of files) {
  // 项目词表合并（v2.43.1）：项目词覆盖同名的技能词；逐文件独立合并（多稿可能来自不同项目）
  const projText = loadProjectGlossaryText(f);
  const projRows = parseGlossary(projText);
  if (projRows.length) {
    projectLayers++;
    const byTerm = new Map(baseGlossary.map((g) => [g.term, g]));
    for (const g of projRows) byTerm.set(g.term, g);
    const merged = [...byTerm.values()];
    maxGlossary = Math.max(maxGlossary, merged.length);
    scan(f, merged, tokens, violations);
  } else {
    scan(f, baseGlossary, tokens, violations);
  }
}
if (violations.length) {
  console.error(`⛔ [plain-speech] ${violations.length} 处不可读信号（PLAIN_SPEECH_GATE，细则 references/plain-speech.md）：`);
  for (const v of violations) console.error(`  ${v.file}:${v.line} [${v.type}] ${v.detail}`);
  process.exit(1);
}
console.log(`✓ [plain-speech] ${files.length} 份呈报稿过门（词表 ${maxGlossary} 条行话${projectLayers ? `，含 ${projectLayers} 份项目词表已合并` : ''} + ${tokens.length} 个代号）`);
process.exit(0);
