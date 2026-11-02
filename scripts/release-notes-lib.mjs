// release-notes-lib.mjs — RELEASE_CHAIN ⑥ GitHub Release 支撑纯函数（v2.93.0 自 tf.mjs 拆出）。
// 拆分唯一动机 = 可测：tf.mjs 尾部无条件 process.exit 分发，import 即退出，夹具无法直接调用；
// 先例 = taskflow-state-machine.mjs / assets/shared/kernel.mjs（同款「机器源拆分，宿主 import」）。
// tf.mjs 与 tf.test.mjs 双端 import 本模块，两处实现单源；除既有先例外禁再拆 tf.mjs 本体（单文件 CLI 设计纪律）。
// hygieneScanText 与 tf.mjs hygieneScan 共用词表与豁免语义——用于非 git 面公开内容（Release notes 等生成文本）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const R = (s) => String(s ?? '').trim();
const trunc = (s, n) => { const a = Array.from(String(s ?? '')); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); }; // 码点安全切片（与 tf.mjs 同口径）

/* 词表加载（PUBLIC_HYGIENE_GATE 唯一黑名单源 assets/harness/hygiene-terms.json；缺文件/缺条目=抛错大声报） */
export function hygieneLoadTerms(skillRoot) {
  const p = path.join(skillRoot, 'assets', 'harness', 'hygiene-terms.json');
  const j = JSON.parse(readFileSync(p, 'utf8'));
  if (!Array.isArray(j.terms) || !j.terms.length) throw new Error('hygiene-terms.json 缺非空 terms 数组');
  return j.terms.map((t) => {
    if (!t.pattern || !t.level || !t.type) throw new Error(`hygiene-terms.json 条目缺 pattern/level/type：${trunc(JSON.stringify(t), 80)}`);
    return { ...t, re: new RegExp(t.pattern, (t.flags || '') + 'g') };
  });
}

/* 文本扫描：按行过词表，行级豁免 hygiene-ok:<非空理由>；block/warn 分级返回（不落盘不改状态） */
export function hygieneScanText(text, skillRoot) {
  const sroot = skillRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const terms = hygieneLoadTerms(sroot);
  const exemptRe = /hygiene-ok[::]\s*\S/;
  const hits = [];
  String(text ?? '').split('\n').forEach((line, i) => {
    if (exemptRe.test(line)) return;
    for (const t of terms) {
      t.re.lastIndex = 0;
      if (t.re.test(line)) {
        hits.push({ no: i + 1, level: t.level, type: t.type, hint: t.hint || '', matched: trunc(R((line.match(t.re) || [''])[0]), 40), line: trunc(R(line), 120) });
        if (t.level === 'block') break;
      }
    }
  });
  return { hits, blocks: hits.filter((h) => h.level === 'block'), warns: hits.filter((h) => h.level !== 'block') };
}

/* Release notes 提取：取 CHANGELOG.md 中 <ver> 条目正文（至下一 ## 前），title 取标题行末段（同 releaseCmd clTitle 的 split('—') 口径）；缺条目/空正文=null。
   实现=两步切割而非单正则：lookahead 里的 $ 在 m 模式匹配任意行尾，空行「行首即行尾」致捕获恒空（2026-11-02 夹具红实证）。 */
export function releaseExtractNotes(root, ver) {
  const clP = path.join(root, 'CHANGELOG.md');
  if (!fsExists(clP)) return null;
  const txt = readFileSync(clP, 'utf8');
  const esc = ver.replace(/\./g, '\\.');
  const start = txt.search(new RegExp(`^## ${esc} — `, 'm'));
  if (start < 0) return null;
  const lineEnd = txt.indexOf('\n', start);
  const line = txt.slice(start, lineEnd < 0 ? undefined : lineEnd);
  const rest = lineEnd < 0 ? '' : txt.slice(lineEnd + 1);
  const next = rest.search(/^## /m);
  const body = (next < 0 ? rest : rest.slice(0, next)).trim();
  if (!body) return null;
  const title = R(line.split('—').pop()) || `v${ver}`;
  return { title, body };
}

function fsExists(p) { try { readFileSync(p); return true; } catch { return false; } }
