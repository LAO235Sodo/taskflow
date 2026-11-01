#!/usr/bin/env node
/*!
 * extract-data-model.js — 数据模型现状提取器（taskflow 机制 DATA_MODEL_GATE 的工具体，硬规则 28）
 * 由 `node tf.mjs mech install DATA_MODEL_GATE` 落位项目 scripts/design/（勿手改真源产物，重跑再生）。
 *
 * 干什么：扫描仓库里的 SQL DDL 面（全部 .sql 文件）与注解实体面（.kt/.java 中含 @TableName/@Entity 的文件），
 * 机械产出「数据模型现状」四件事实——表清单（含多定义源）、实体↔DDL 列级映射（mismatches）、
 * 同名表重复定义（duplicates）、表间依赖（显式 FK + _id 启发式）——落单源双形态两文件：
 *   docs/data-model/data-model-extract.json  机器真源（schema=data-model-extract/1；门脚本与 AI 消费）
 *   docs/data-model/data-model-extract.md    人读渲染（五节：表清单/一致性/重复定义/依赖/unresolved）
 * 这是 DATA_MODEL_GATE 对照表「现状列」的唯一合法来源——禁止凭记忆转述现状（硬规则 19 同型纪律）。
 *
 * 用法：node extract-data-model.js --root <目录> [--out <目录>]
 *   --root  扫描根（backend/ 或仓库根）；--out 缺省 <root>/docs/data-model/
 *   Node ≥16 零依赖；跳过 node_modules/.git/build/dist；文件数 >3000 截断并在 stats 注记。
 *
 * 解析边界（尽力而为，解析不了进 unresolved 禁静默丢）：
 *   - SQL：CREATE TABLE 体内逐列取名/类型/COMMENT；ALTER TABLE ADD COLUMN 合并进表（无 CREATE 单列成表）；
 *     约束行（PRIMARY/UNIQUE/KEY/INDEX/CONSTRAINT/FOREIGN）不算列。
 *   - 依赖：显式 FOREIGN KEY…REFERENCES → kind=fk；列名 *_id 去后缀命中已提取表（单/复数）→ kind=implicit-id
 *     （同一 from+via 显式 FK 优先，implicit 不重复计）；启发式未命中目标表 → unresolved 注记，禁静默猜。
 *   - 实体：@(TableName|Table)(value|name =)?"table" 定表；@TableId/@TableField 后首个属性为字段
 *     （Kotlin val/var、Java 成员），列名缺省 camel→snake；KDoc/行尾注释为 comment；
 *     @TableField(exist = false) 不参与映射比对；@Entity 无表名 → unresolved。
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---------- CLI ---------- */
function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const ROOT = arg('--root');
if (!ROOT || ROOT === true) { console.error('缺 --root <目录>（扫描根，如 backend 或仓库根）'); process.exit(1); }
const ROOT_ABS = path.resolve(ROOT);
if (!fs.existsSync(ROOT_ABS)) { console.error(`--root 不存在：${ROOT_ABS}`); process.exit(1); }
const OUT_ABS = path.resolve(arg('--out', path.join(ROOT_ABS, 'docs', 'data-model')));
const NOW = new Date().toISOString();
const MAX_FILES = 3000;

/* ---------- 文件收集 ---------- */
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist']);
function walk(dir, files) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, files); continue; }
    if (!e.isFile()) continue;
    if (/\.(sql|kt|java)$/.test(e.name)) files.push(p);
    if (files.length >= MAX_FILES) return;
  }
}
const ALL_FILES = [];
walk(ROOT_ABS, ALL_FILES);
const TRUNCATED = ALL_FILES.length >= MAX_FILES;
const sqlFiles = ALL_FILES.filter((f) => f.endsWith('.sql'));
const ktJavaFiles = ALL_FILES.filter((f) => f.endsWith('.kt') || f.endsWith('.java'));

/* ---------- SQL DDL 解析 ---------- */
const tables = new Map(); // lower(name) -> {name, source:[{file,line}], columns:[{name,type,comment}], altered:[file,line]……列合并按 name 去重 }
const dupCreates = new Map(); // lower(name) -> [{file,line}]
const fkDeps = []; // {from,to,via,line,file}
function lower(s) { return String(s).toLowerCase(); }
function stripTok(s) { return s.replace(/[`"[]]/g, '').trim(); }

function parseSqlFile(file, text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const cm = line.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([A-Za-z_][\w$]*)[`""]?\s*\(/i);
    if (cm) {
      const name = stripTok(cm[1]);
      const key = lower(name);
      const src = { file: rel(file), line: i + 1 };
      if (!tables.has(key)) tables.set(key, { name, source: [], columns: [] });
      const t = tables.get(key);
      t.source.push(src);
      if (!dupCreates.has(key)) dupCreates.set(key, []);
      dupCreates.get(key).push(src);
      // 体内扫描：深度 1 的行为列/约束，直到深度归 0
      let depth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      let j = i;
      while (j < lines.length - 1 && depth > 0) {
        j += 1;
        const body = lines[j];
        depth += (body.match(/\(/g) || []).length - (body.match(/\)/g) || []).length;
        const raw = body.replace(/--[^\n]*/g, '').trim().replace(/,$/, '');
        if (!raw || depth > 1) continue;
        if (/^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|CHECK)\b/i.test(raw)) {
          const fkm = raw.match(/FOREIGN\s+KEY\s*\(\s*[`"[]?([\w$]+)[`""]?\s*\)\s*REFERENCES\s+[`"[]?([A-Za-z_][\w$]*)/i);
          if (fkm) fkDeps.push({ from: name, file: rel(file), line: j + 1, via: stripTok(fkm[1]), to: stripTok(fkm[2]) });
          continue;
        }
        const colm = raw.match(/^[`"[]?([A-Za-z_][\w$]*)[`""]?\s+([A-Za-z_][\w]*(?:\s*\([\d,\s]*\))?)/);
        if (!colm) continue;
        const cname = stripTok(colm[1]);
        const ctype = colm[2].replace(/\s+/g, '');
        const cmtm = raw.match(/COMMENT\s+(?:'((?:[^'\\]|\\.|'')*)'|"([^"]*)")/i);
        const comment = cmtm ? (cmtm[1] ?? cmtm[2] ?? '').replace(/''/g, "'") : '';
        if (!t.columns.some((c) => lower(c.name) === lower(cname))) t.columns.push({ name: cname, type: ctype, comment });
      }
      i = j + 1;
      continue;
    }
    const am = line.match(/ALTER\s+TABLE\s+[`"[]?([A-Za-z_][\w$]*)[`""]?\s+ADD\s+(?:COLUMN\s+)?[`"[]?([A-Za-z_][\w$]*)[`""]?\s+([A-Za-z_][\w]*(?:\s*\([\d,\s]*\))?)/i);
    if (am) {
      const name = stripTok(am[1]);
      const key = lower(name);
      const src = { file: rel(file), line: i + 1 };
      if (!tables.has(key)) tables.set(key, { name, source: [src], columns: [] });
      const t = tables.get(key);
      const cname = stripTok(am[2]);
      const cmtm = line.match(/COMMENT\s+(?:'((?:[^'\\]|\\.|'')*)'|"([^"]*)")/i);
      if (!t.columns.some((c) => lower(c.name) === lower(cname))) t.columns.push({ name: cname, type: am[3].replace(/\s+/g, ''), comment: cmtm ? (cmtm[1] ?? cmtm[2] ?? '').replace(/''/g, "'") : '' });
    }
    i += 1;
  }
}
function rel(p) { return path.relative(ROOT_ABS, p) || path.basename(p); }

/* ---------- 实体解析（MyBatis-Plus / JPA 注解面） ---------- */
const entities = [];
const unresolved = [];
function camelToSnake(s) { return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(); }
function parseEntityFile(file, text) {
  if (!/@(TableName|Entity)\b/.test(text)) return;
  const lines = text.split(/\r?\n/);
  const fileRel = rel(file);
  // 分段：每个表名注解（@TableName/@Table(…)）开启一个实体段——一个文件可含多个实体类（AgentWorkflowEntities.kt 实证）
  const segStarts = [];
  for (let i = 0; i < lines.length; i++) if (/@(?:TableName|Table)\s*\(/.test(lines[i])) segStarts.push(i);
  if (!segStarts.length) {
    unresolved.push({ file: fileRel, reason: '含 @Entity 但无 @(TableName|Table)(value|name=)"表名" 注解——表名解析不了，人工补对照（禁静默猜）' });
    return;
  }
  for (let s = 0; s < segStarts.length; s++) parseEntitySegment(fileRel, lines, segStarts[s], s + 1 < segStarts.length ? segStarts[s + 1] : lines.length);
}
function parseEntitySegment(fileRel, lines, from, to) {
  const tmRe = /@(?:TableName|Table)\s*\(\s*(?:(?:value|name)\s*=\s*)?"([^"]+)"/;
  let table = null;
  for (let i = from; i < to; i++) { const m = lines[i].match(tmRe); if (m) { table = m[1]; break; } }
  if (!table) return; // 分段边界本身即表名注解——不可能缺
  let cls = null;
  for (let i = from; i < to; i++) { const m = lines[i].match(/(?:data\s+)?class\s+([A-Za-z_]\w*)/); if (m) { cls = m[1]; break; } }
  if (!cls) cls = path.basename(fileRel).replace(/\.(kt|java)$/, '');
  const fields = [];
  let pending = null; // {column|null, existFalse, comment}
  let pendingComment = '';
  let inKDoc = false; let kDoc = '';
  const declReKt = /(?:^|\s)(?:lateinit\s+)?(?:val|var)\s+([A-Za-z_]\w*)\s*:\s*([^,=\s]+)/;
  const declReJava = /(?:private|protected|public)\s+(?:static\s+)?(?:final\s+)?([\w.<>\[\]]+)\s+([A-Za-z_]\w*)\s*[;=]/;
  for (let i = from; i < to; i++) {
    const line = lines[i];
    const code = line.replace(/\s*\/\/.*$/, '');
    // KDoc 收集（多行块 + 单行 /** x */；闭行内容不并入；类声明行清空待挂注释——类 KDoc 不冒充字段注释）
    if (inKDoc) {
      if (line.includes('*/')) { kDoc += ' ' + line.replace(/^\s*\*?\s?/, '').replace(/\*\/.*$/, ''); pendingComment = kDoc.replace(/\s+/g, ' ').trim(); inKDoc = false; kDoc = ''; }
      else kDoc += ' ' + line.replace(/^\s*\*?\s?/, '');
      continue;
    }
    const oneLineKd = line.match(/^\s*\/\*\*\s*(.+?)\s*\*\/\s*$/);
    if (oneLineKd) { pendingComment = oneLineKd[1].trim(); continue; }
    if (/\/\*\*/.test(line)) { inKDoc = true; kDoc = line.replace(/^\s*\/\*\*\s?/, ''); continue; }
    if (/^\s*\/\//.test(line)) { pendingComment = line.replace(/^\s*\/\/\s?/, '').trim(); continue; }
    if (/(?:data\s+)?class\s+[A-Za-z_]\w*/.test(line)) { pendingComment = ''; continue; }
    if (!code.trim()) { pendingComment = ''; continue; }
    const idm = code.match(/@TableId\b/);
    const tfm = code.match(/@TableField\s*\(\s*(?:(?:value\s*=\s*)?"([^"]+)")?([^)]*)\)/);
    if (idm || tfm) {
      const tail = tfm ? tfm[2] : (idm ? code.slice(code.indexOf('@TableId') + 8) : '');
      pending = { column: tfm ? (tfm[1] ?? null) : null, existFalse: /exist\s*=\s*false/.test(tail) };
      if (pendingComment) pending.comment = pendingComment;
      pendingComment = '';
    }
    const dk = code.match(declReKt);
    const dj = code.match(declReJava);
    const d = dk ? { prop: dk[1], type: dk[2] } : dj ? { prop: dj[2], type: dj[1] } : null;
    if (d) {
      const trailing = (line.match(/\/\/\s*(.+)$/) || [])[1];
      const comment = [pending?.comment, trailing].filter(Boolean).join('；') || '';
      const column = pending ? (pending.existFalse ? null : (pending.column ?? camelToSnake(d.prop))) : camelToSnake(d.prop);
      fields.push({ prop: d.prop, column, type: d.type, comment });
      pending = null; pendingComment = '';
    }
  }
  entities.push({ cls, table, file: fileRel, fields });
}

/* ---------- 扫描执行 ---------- */
for (const f of sqlFiles) { try { parseSqlFile(f, fs.readFileSync(f, 'utf8')); } catch (e) { unresolved.push({ file: rel(f), reason: `SQL 解析异常：${e.message}` }); } }
for (const f of ktJavaFiles) { try { const t = fs.readFileSync(f, 'utf8'); if (/@(TableName|Entity)\b/.test(t)) parseEntityFile(f, t); } catch (e) { unresolved.push({ file: rel(f), reason: `实体解析异常：${e.message}` }); } }

/* ---------- 依赖推导（显式 FK 优先；_id 启发式禁静默猜） ---------- */
const dependencies = [];
const seenDep = new Set(); // `${from}|${via}`
for (const k of fkDeps) {
  const from = tableOf(k.from) ?? k.from;
  const to = tableOf(k.to) ?? k.to;
  const key = `${lower(from)}|${lower(k.via)}`;
  if (seenDep.has(key)) continue;
  seenDep.add(key);
  dependencies.push({ from, to, via: k.via, kind: 'fk', evidence: [{ file: k.file, line: k.line }] });
}
function tableOf(name) { const t = tables.get(lower(name)); return t ? t.name : null; }
const tableNames = new Map([...tables.keys()].map((k) => [k, tables.get(k).name]));
/* 三级确定性命中：①直接同名（单/复数）②后缀 _<候选> 唯一 ③同模块前缀（from 与候选共享首 _ 段、排除自身）唯一；
   多义仍不猜——进 unresolved（agent_workflow_run ← agent_step_run.run_id 走③，rule_executions.scheme_id 双候选走 unresolved） */
function depTarget(base, fromName) {
  const cands = [...new Set([base, base + 's', base + 'es', base.endsWith('s') ? base.slice(0, -1) : base])];
  for (const c of cands) if (tableNames.has(c)) return { table: tableNames.get(c) };
  const hits = new Set();
  for (const c of cands) for (const [k, n] of tableNames) if (k === c || k.endsWith('_' + c)) hits.add(n);
  if (hits.size === 1) return { table: [...hits][0] };
  if (hits.size > 1) {
    const others = [...hits].filter((n) => n !== fromName);
    const mod = lower(fromName).split('_')[0];
    const sameMod = others.filter((n) => lower(n).split('_')[0] === mod);
    if (sameMod.length === 1) return { table: sameMod[0] };
    if (others.length === 1) return { table: others[0] };
    return { ambiguous: [...hits] };
  }
  return { ambiguous: [] };
}
for (const [key, t] of tables) {
  for (const col of t.columns) {
    const m = col.name.match(/^(.+)_id$/i);
    if (!m) continue;
    const base = lower(m[1]);
    const dkey = `${lower(t.name)}|${lower(col.name)}`;
    if (seenDep.has(dkey)) continue;
    const hit = depTarget(base, t.name);
    if (hit.table) {
      seenDep.add(dkey);
      dependencies.push({ from: t.name, to: hit.table, via: col.name, kind: 'implicit-id', evidence: t.source.map((s) => ({ file: s.file, line: s.line })) });
    } else {
      seenDep.add(dkey);
      const why = hit.ambiguous.length
        ? `表 ${t.name} 列 ${col.name} 后缀命中多张表（${hit.ambiguous.join('/')}）——多义不猜，人工确认依赖`
        : `表 ${t.name} 列 ${col.name} 启发式未命中已提取表（候选 ${base}/${base}s 不在提取集）——人工确认依赖或注记无关联`;
      unresolved.push({ file: t.source[0]?.file ?? '', reason: why });
    }
  }
}

/* ---------- duplicates：同名表 CREATE >1 处（含同文件；实体注解处计入 sources） ---------- */
const duplicates = [];
for (const [key, srcs] of [...dupCreates.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
  if (srcs.length <= 1) continue;
  const sources = [...srcs];
  for (const e of entities) if (lower(e.table) === key) sources.push({ file: e.file, line: 0, note: `实体 ${e.cls} @TableName` });
  duplicates.push({ table: tables.get(key).name, sources });
}

/* ---------- mappings：实体 ↔ DDL 列级比对 ---------- */
const mappings = [];
for (const e of entities.sort((a, b) => (a.cls < b.cls ? -1 : 1))) {
  const t = tables.get(lower(e.table));
  if (!t) { mappings.push({ cls: e.cls, table: e.table, ddlSources: [], result: 'table-missing', entityOnlyColumns: e.fields.filter((f) => f.column).map((f) => f.column), ddlOnlyColumns: [], checkedAt: NOW }); continue; }
  const entityCols = [...new Set(e.fields.filter((f) => f.column).map((f) => f.column))];
  const ddlCols = [...new Set(t.columns.map((c) => c.name))];
  const lc = (s) => lower(s);
  const entitySet = new Set(entityCols.map(lc));
  const ddlSet = new Set(ddlCols.map(lc));
  const entityOnly = entityCols.filter((c) => !ddlSet.has(lc(c)));
  const ddlOnly = ddlCols.filter((c) => !entitySet.has(lc(c)));
  const result = entityOnly.length ? 'entity-only' : ddlOnly.length ? 'ddl-only' : 'matched';
  mappings.push({ cls: e.cls, table: e.table, ddlSources: t.source, result, entityOnlyColumns: entityOnly, ddlOnlyColumns: ddlOnly, checkedAt: NOW });
}

/* ---------- 产物组装 ---------- */
const sortedTables = [...tables.values()].map((t) => ({ name: t.name, source: t.source, columns: t.columns })).sort((a, b) => (a.name < b.name ? -1 : 1));
const payload = {
  schema: 'data-model-extract/1',
  extractedAt: NOW,
  root: ROOT_ABS,
  stats: {
    sqlFiles: sqlFiles.length, entityFiles: entities.length, tables: sortedTables.length,
    mappingsMatched: mappings.filter((m) => m.result === 'matched').length,
    mappingsMismatch: mappings.filter((m) => m.result !== 'matched').length,
    duplicates: duplicates.length, dependencies: dependencies.length, unresolved: unresolved.length,
    truncated: TRUNCATED ? `文件数达上限 ${MAX_FILES} 截断——结果不完整，收窄 --root 再跑` : false,
  },
  tables: sortedTables,
  entities: entities.sort((a, b) => (a.cls < b.cls ? -1 : 1)),
  mappings,
  duplicates,
  dependencies: dependencies.sort((a, b) => (a.from + a.to + a.via < b.from + b.to + b.via ? -1 : 1)),
  unresolved: unresolved.sort((a, b) => (a.file < b.file ? -1 : 1)),
};

/* .md 人读渲染（五节） */
const md = [];
md.push('# 数据模型现状提取（data-model-extract/1）');
md.push('');
md.push(`- 提取时间：${NOW}　根：\`${ROOT_ABS}\`　（本文件为机器渲染产物——禁手改；变更后重跑 extract-data-model.js 再生）`);
md.push(`- 统计：表 ${payload.stats.tables}／实体 ${entities.length}／映射 matched ${payload.stats.mappingsMatched}·mismatch ${payload.stats.mappingsMismatch}／重复定义 ${payload.stats.duplicates}／依赖 ${payload.stats.dependencies}／unresolved ${payload.stats.unresolved}${TRUNCATED ? `／⚠ ${payload.stats.truncated}` : ''}`);
md.push('');
md.push('## ① 表清单（含各定义源）');
md.push('');
md.push('| 表 | 定义源（文件:行号） | 列数 |');
md.push('| --- | --- | --- |');
for (const t of sortedTables) md.push(`| ${t.name} | ${t.source.map((s) => `\`${s.file}:${s.line}\``).join('、') || '（仅 ALTER）'} | ${t.columns.length} |`);
md.push('');
md.push('## ② 实体↔DDL 一致性');
md.push('');
const mm = mappings.filter((m) => m.result !== 'matched');
md.push(`- matched：${payload.stats.mappingsMatched} 个实体↔表列级一致；mismatch：${mm.length} 个（明细如下）`);
md.push('');
if (mm.length) {
  md.push('| 实体 | 表 | 类别 | 差异列 |');
  md.push('| --- | --- | --- | --- |');
  for (const m of mm) {
    const diff = [];
    if (m.entityOnlyColumns.length) diff.push(`entity-only: ${m.entityOnlyColumns.join('、')}`);
    if (m.ddlOnlyColumns.length) diff.push(`ddl-only: ${m.ddlOnlyColumns.join('、')}`);
    md.push(`| ${m.cls} | ${m.table}${m.result === 'table-missing' ? '（DDL 缺表）' : ''} | ${m.result} | ${diff.join('；') || '—'} |`);
  }
} else md.push('（全部一致——无 mismatch）');
md.push('');
md.push('## ③ 重复定义表（同名 CREATE 多处；实体注解处一并点名）');
md.push('');
if (duplicates.length) {
  md.push('| 表 | 定义源 |');
  md.push('| --- | --- |');
  for (const d of duplicates) md.push(`| ${d.table} | ${d.sources.map((s) => `\`${s.file}:${s.line}${s.note ? `（${s.note}）` : ''}\``).join('、')} |`);
} else md.push('（无）');
md.push('');
md.push('## ④ 依赖关系（表级；fk=显式外键 / implicit-id=_id 启发式）');
md.push('');
const outs = new Map(); const ins = new Map();
for (const d of payload.dependencies) {
  (outs.get(d.from) ?? outs.set(d.from, []).get(d.from)).push(d);
  (ins.get(d.to) ?? ins.set(d.to, []).get(d.to)).push(d);
}
const nodes = [...new Set([...payload.dependencies.flatMap((d) => [d.from, d.to]), ...outs.keys(), ...ins.keys()])].sort();
for (const n of nodes) {
  const o = (outs.get(n) ?? []).map((d) => `${d.to}（via ${d.via}，${d.kind}）`);
  const i2 = (ins.get(n) ?? []).map((d) => `${d.from}（via ${d.via}，${d.kind}）`);
  md.push(`- **${n}**`);
  if (o.length) md.push(`  - 依赖谁（出边）：${o.join('；')}`);
  if (i2.length) md.push(`  - 被谁依赖（入边）：${i2.join('；')}`);
  if (!o.length && !i2.length) md.push('  - （孤立）');
}
md.push('');
md.push('```mermaid');
md.push('graph LR');
for (const d of payload.dependencies) md.push(`  ${d.from} -->|${d.via}| ${d.to}`);
md.push('```');
md.push('');
md.push('## ⑤ unresolved（解析不了/启发式未命中——禁静默丢，人工核对补对照表）');
md.push('');
if (unresolved.length) { for (const u of unresolved) md.push(`- \`${u.file}\` — ${u.reason}`); } else md.push('（无）');
md.push('');

fs.mkdirSync(OUT_ABS, { recursive: true });
fs.writeFileSync(path.join(OUT_ABS, 'data-model-extract.json'), JSON.stringify(payload, null, 2) + '\n');
fs.writeFileSync(path.join(OUT_ABS, 'data-model-extract.md'), md.join('\n') + '\n');
console.log(`✓ 数据模型提取落盘 ${OUT_ABS}（表 ${payload.stats.tables}、实体 ${entities.length}、duplicates ${duplicates.length}、dependencies ${dependencies.length}、mismatch ${payload.stats.mappingsMismatch}、unresolved ${unresolved.length}${TRUNCATED ? '，⚠ 已截断' : ''}）`);
