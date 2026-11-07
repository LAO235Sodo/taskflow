#!/usr/bin/env node
// gen-mechanisms.mjs — references/schemas/mechanisms.json 生成器（v3.0.0，F23/F22）。
// 机制注册表出 markdown：机器真源从 data.md 表格迁 JSON；lint 死规则检查 / mech ls / mech install / doctor 采纳对账同源消费。
// 源优先级：packs/*/manifest.json（终态——包=机械载体）+ scripts/mechanisms-core.json（核心非包机制）；
// packs/ 无任何 manifest 时（迁移期）回退解析 references/data.md「## 机制登记表」（一次性过渡，v3 收尾删表后该路径不可达）。
// 进 release 链：改 manifest/核心表后必须重跑本脚本再提交（机制与包对账由 doctor I20 机械强制）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'references', 'schemas', 'mechanisms.json');
const CORE = path.join(root, 'scripts', 'mechanisms-core.json');
const DATA = path.join(root, 'references', 'data.md');

const mechanisms = [];
let source = '';

const manifests = [];
const packsDir = path.join(root, 'packs');
if (fs.existsSync(packsDir)) {
  for (const d of fs.readdirSync(packsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const mp = path.join(packsDir, d.name, 'manifest.json');
    if (fs.existsSync(mp)) manifests.push([d.name, mp]);
  }
}

if (manifests.length) {
  source = `packs(${manifests.length})+core`;
  for (const [name, mp] of manifests) {
    let m;
    try { m = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e) { console.error(`⛔ manifest 不可解析：${mp}（${e.message}）`); process.exit(1); }
    // install_targets 键（项目侧落盘路径）= 采纳产物集（doctor 采纳对账/mech 渲染过滤的消费契约）；variants 分档资产并入去重
    const products = [...new Set([
      ...Object.keys(m.install_targets ?? {}).map(String),
      ...Object.values(m.variants ?? {}).flatMap((a) => (Array.isArray(a) ? a.map(String) : [])),
    ])];
    // 触点（lint 死规则检查）：包内文档触点须包路径前缀（packs/<name>/PACK.md——lint 按字面路径找文件）；缺省=docs+entry-routes
    const docPath = m.docs ? `packs/${name}/${m.docs}` : null;
    const touch = Array.isArray(m.touch) && m.touch.length ? m.touch.map((t) => (t === m.docs ? docPath : t)) : [docPath, 'references/entry-routes.md'].filter(Boolean);
    // 子 token 声明（manifest.mechanisms）：一包多机制（存量项目 project.json.mechanisms 的既有采纳 token 兼容）——主 token 行照常推导，子 token 追加
    if (Array.isArray(m.mechanisms)) {
      for (const sub of m.mechanisms) {
        if (!sub?.token) continue;
        mechanisms.push({
          token: sub.token, name: sub.name ?? sub.token, pack: name,
          def: `${m.docs}（packs/${name}/）`,
          touch: Array.isArray(sub.touch) && sub.touch.length ? sub.touch : [docPath, 'references/entry-routes.md'].filter(Boolean),
          triggers: sub.triggers ?? [],
          products: [...new Set((sub.products ?? []).map(String))],
          fixture: Array.isArray(sub.fixtures) && sub.fixtures.length ? sub.fixtures.join('、') : '—（随包主 token 夹具承载）',
          plain: sub.plain ?? sub.token,
        });
      }
    }
    mechanisms.push({
      token: m.token ?? name,
      name: m.name ?? name,
      pack: name,
      def: `${m.docs}（packs/${name}/）`,
      touch,
      triggers: m.triggers ?? [],
      products,
      fixture: Array.isArray(m.fixtures) && m.fixtures.length ? m.fixtures.join('、') : '—',
      plain: m.plain ?? m.name ?? name,
    });
  }
  if (fs.existsSync(CORE)) {
    const core = JSON.parse(fs.readFileSync(CORE, 'utf8'));
    for (const row of core.mechanisms ?? []) mechanisms.push({ pack: null, ...row });
  }
} else {
  // 迁移期回退：解析 data.md 登记表（列：token/定义处/触点/采纳产物/fixture/检测/大白话）
  source = 'data.md(过渡)';
  const text = fs.existsSync(DATA) ? fs.readFileSync(DATA, 'utf8') : '';
  const sec = text.match(/## 机制登记表[\s\S]*?(?=\n## |$)/)?.[0] ?? '';
  for (const line of sec.split('\n')) {
    if (!/^\|/.test(line) || /^\|[-: |]+$/.test(line) || /^\| *token/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6 || !cells[1]) continue;
    mechanisms.push({
      token: cells[1],
      name: cells[1],
      pack: null,
      def: cells[2] ?? '',
      touch: (cells[3] ?? '').split(/[、,;]/).map((s) => s.trim()).filter(Boolean),
      triggers: [],
      products: (cells[4] ?? '').split(/[、,;]/).map((s) => s.trim()).filter((s) => s && !s.startsWith('—')),
      fixture: cells[5] ?? '',
      plain: cells[7] ?? cells[2] ?? '',
    });
  }
}

if (!mechanisms.length) { console.error('⛔ 未收集到任何机制（packs manifest 与 data.md 表均空）——先生成源再跑'); process.exit(1); }
const seen = new Set();
for (const m of mechanisms) {
  if (seen.has(m.token)) { console.error(`⛔ token 重复：${m.token}`); process.exit(1); }
  seen.add(m.token);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source, mechanisms }, null, 2) + '\n');
console.log(`✓ mechanisms.json 生成（源=${source}，机制 ${mechanisms.length} 项）→ ${path.relative(root, OUT)}`);
