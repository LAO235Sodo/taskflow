#!/usr/bin/env node
/*!
 * extract-app-baseline.js — App 现状页基线提取器（taskflow 机制 APP_PAGE_BASELINE 的工具体，硬规则 21）
 * 零依赖 node（≥16）。双模式：
 *
 *   static（离线，可测）：布局 XML + values 目录 → 结构树 + @color/@dimen/@string token 解析（day/night 双主题）
 *     node extract-app-baseline.js --mode static \
 *       --layouts res/layout/activity_home.xml[,res/layout/item_x.xml] \
 *       --values res/values[,res/values-night] \
 *       --out .taskflow/<id>/design/baseline/baseline-home.json
 *
 *   device（真机/模拟器，需 adb）：截图 + uiautomator 结构树；可叠加 --layouts/--values 做 token 合并
 *     node extract-app-baseline.js --mode device --page home \
 *       [--layouts ... --values ...] \
 *       --out .taskflow/<id>/design/baseline/baseline-home.json
 *     截图默认写 --out 同名 .png（可用 --screenshot 覆盖）
 *
 * 产出 schema = app-baseline/1（消费：validate-app-baseline-gate.sh 校验头；原型制作/自查/验收对照）：
 *   头部：schema / extractedAt / source{platform,mode,layouts?,valuesDirs?,device?,screenshot?} / stats
 *   static roots[]：{ file, tree } —— tree 节点：tag / id / attrs（android:* 原始属性全量）/
 *     layout{width,height,padding*,margin*} / styles{text,textColor,textSize,background,src,hint} /
 *     children[]（文档顺序 = 结构一等公民）
 *   device：tree 节点：tag（类短名）/ id（resource-id 去包名）/ text / desc / clickable /
 *     rect{x,y,w,h}（uiautomator bounds 换算）/ styles（--layouts 合并时的静态解析值）
 *
 * 解析语义：
 *   @color/@dimen/@string → { ref, day, night? }（night 仅当 values-night* 目录有同名键；无 night 变体 = 只有 day）
 *   @string 且无 night 变体 → 直接解析为字符串（styles.text = 文本本身）
 *   @drawable / ?attr / @android:* 等本工具不可解析为值的引用 → { ref } 保引用名
 *   #hex / 字面量 → { day: <原值> }
 * 退出码：0 成功；1 参数/文件/设备错误。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/* ---------- 极简 XML 解析（标签 + 属性 + 文本；零依赖） ---------- */
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' };
function decodeEnt(s) { return String(s).replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, (m) => ENTITIES[m] ?? m); }

function parseAttrs(raw) {
  const attrs = {};
  for (const m of raw.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = decodeEnt(m[2]);
  return attrs;
}
function findTagEnd(text, lt) {
  // 属性值内合法未转义 >（XML 只有 < 与 & 必须转义）——按引号状态扫描，防标签中途截断
  let q = null;
  for (let i = lt + 1; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '>') return i;
  }
  return -1;
}

function parseXml(text) {
  const root = { tag: '#doc', attrs: {}, children: [], text: '', seq: [] };
  const stack = [root];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const t = text.slice(i, lt);
      if (t.trim()) { // 纯空白跳过；内容保原始间距入 seq（styled string 的交错顺序靠 seq 还原）
        const top = stack[stack.length - 1];
        top.text += t.trim();
        top.seq.push({ t: 1, s: t });
      }
    }
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt); i = e < 0 ? text.length : e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt);
      const content = text.slice(lt + 9, e < 0 ? text.length : e);
      const top = stack[stack.length - 1];
      top.text += content;
      top.seq.push({ t: 1, s: content });
      i = e < 0 ? text.length : e + 3;
      continue;
    }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) { const e = text.indexOf('>', lt); i = e < 0 ? text.length : e + 1; continue; }
    const gt = findTagEnd(text, lt);
    if (gt < 0) break;
    const selfClose = text[gt - 1] === '/';
    const inner = text.slice(lt + 1, selfClose ? gt - 1 : gt);
    const closing = inner.startsWith('/');
    if (closing) { if (stack.length > 1) stack.pop(); i = gt + 1; continue; }
    const nameM = inner.match(/^([\w:.-]+)/);
    if (!nameM) { i = gt + 1; continue; }
    const node = { tag: nameM[1], attrs: parseAttrs(inner.slice(nameM[1].length)), children: [], text: '', seq: [] };
    stack[stack.length - 1].children.push(node);
    stack[stack.length - 1].seq.push({ t: 0, n: node });
    if (!selfClose) stack.push(node);
    i = gt + 1;
  }
  return root.children[0] ?? null;
}

/* ---------- values 资源解析（colors/dimens/strings；目录角色按 basename 判定） ---------- */
function loadValuesDir(dir) {
  const map = { color: {}, dimen: {}, string: {} };
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    const doc = parseXml(fs.readFileSync(path.join(dir, f), 'utf8'));
    const textOf = (n) => (n.seq && n.seq.length ? n.seq.map((x) => (x.t ? x.s : textOf(x.n))).join('') : (n.text || '')).trim(); // styled string（<b>/<i>/<xliff:g> 子 run）按 seq 交错顺序拼全，防静默丢文本/错序
    const walk = (n) => {
      if (map[n.tag] && n.attrs && n.attrs.name) map[n.tag][n.attrs.name] = textOf(n);
      (n.children || []).forEach(walk);
    };
    if (doc) walk(doc);
  }
  return map;
}
function loadValues(dirs) {
  const dayDirs = [], nightDirs = [];
  for (const d of dirs) (path.basename(d).startsWith('values-night') ? nightDirs : dayDirs).push(d);
  const day = { color: {}, dimen: {}, string: {} }, night = { color: {}, dimen: {}, string: {} };
  for (const d of dayDirs.length ? dayDirs : dirs) { const m = loadValuesDir(d); for (const k of Object.keys(m)) Object.assign(day[k], m[k]); }
  for (const d of nightDirs) { const m = loadValuesDir(d); for (const k of Object.keys(m)) Object.assign(night[k], m[k]); }
  return { day, night, hasNight: nightDirs.length > 0 };
}

/* ---------- @ref 解析 ---------- */
function resolveValue(v, values) {
  if (v == null || v === '') return undefined;
  const s = String(v).trim();
  const m = s.match(/^@(color|dimen|string)\/([\w.]+)$/);
  if (!m) {
    if (/^[@?]/.test(s)) return { ref: s };                       // @drawable/?attr/@android:* → 保引用
    return values ? { day: s } : s;                                // 字面量：有 values 上下文 → 统一 {day}；否则原样
  }
  const [, kind, name] = m;
  if (!values) return { ref: s };                                  // 无 --values 上下文：保引用不崩（审查 P1）
  const dayV = values.day[kind][name];
  const nightV = values.night[kind][name];
  const out = { ref: s };
  if (dayV != null) out.day = dayV;
  if (nightV != null) out.night = nightV;
  if (dayV == null && nightV == null) return { ref: s };          // 解析不到 → 保引用（如 @drawable）
  if (kind === 'string' && nightV == null) return dayV;           // 字符串无 night 变体 → 直接文本
  return out;
}

/* ---------- static：布局 XML → 基线树 ---------- */
const A = (attrs, k) => attrs['android:' + k];
function layoutNode(xmlNode, values) {
  const attrs = xmlNode.attrs || {};
  const idRaw = A(attrs, 'id');
  const node = {
    tag: xmlNode.tag === 'view' && attrs.class ? attrs.class.split('.').pop() : xmlNode.tag,
    id: idRaw ? idRaw.replace(/^@\+?id\//, '') : null,
    attrs,
    layout: {
      width: A(attrs, 'layout_width'), height: A(attrs, 'layout_height'),
      padding: A(attrs, 'padding'), paddingLeft: A(attrs, 'paddingLeft'), paddingTop: A(attrs, 'paddingTop'),
      paddingRight: A(attrs, 'paddingRight'), paddingBottom: A(attrs, 'paddingBottom'),
      marginLeft: A(attrs, 'layout_marginLeft'), marginTop: A(attrs, 'layout_marginTop'),
      marginRight: A(attrs, 'layout_marginRight'), marginBottom: A(attrs, 'layout_marginBottom'),
    },
    styles: {},
    children: (xmlNode.children || []).filter((c) => c.tag !== '#text').map((c) => layoutNode(c, values)),
  };
  for (const [dst, src] of [['text', 'text'], ['hint', 'hint'], ['textColor', 'textColor'], ['textSize', 'textSize'], ['background', 'background'], ['src', 'src']]) {
    const raw = A(attrs, src);
    if (raw != null && raw !== '') node.styles[dst] = resolveValue(raw, values);
  }
  return node;
}
function countNodes(n) { return 1 + (n.children || []).reduce((a, c) => a + countNodes(c), 0); }

/* ---------- device：adb 截图 + uiautomator 树 ---------- */
function adb(args, opts) { return spawnSync('adb', args, opts); }
function requireAdb() {
  const r = adb(['get-serialno'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) { console.error('⛔ adb 不可用或无设备连接（device 模式需要真机/模拟器）'); process.exit(1); }
  return r.stdout.trim();
}
function parseBounds(b) {
  const m = String(b || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const [, x1, y1, x2, y2] = m.map(Number);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
function deviceNode(xmlNode, staticById) {
  const a = xmlNode.attrs || {};
  const cls = (a.class || '').split('.').pop() || xmlNode.tag;
  const rid = a['resource-id'] || '';
  const id = rid.includes('/') ? rid.slice(rid.lastIndexOf('/') + 1) : (rid || null);
  const node = {
    tag: cls, id, text: a.text || '', desc: a['content-desc'] || '',
    clickable: a.clickable === 'true', rect: parseBounds(a.bounds), styles: {},
  };
  if (id && staticById && staticById[id]) node.styles = staticById[id];
  node.children = (xmlNode.children || []).filter((c) => c.tag !== '#text').map((c) => deviceNode(c, staticById));
  return node;
}
function collectStaticById(roots) {
  const byId = {};
  for (const r of roots) {
    const walk = (n) => { if (n.id) byId[n.id] = n.styles || {}; (n.children || []).forEach(walk); };
    walk(r.tree);
  }
  return byId;
}

/* ---------- CLI ---------- */
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const MODE = arg('--mode', 'device');
const OUT = arg('--out');
const LAYOUTS = (arg('--layouts') || '').split(',').map((s) => s.trim()).filter(Boolean);
const VALUES_DIRS = (arg('--values') || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!OUT) { console.error('缺 --out <baseline.json>（基线 JSON 落盘路径）'); process.exit(1); }

const values = VALUES_DIRS.length ? loadValues(VALUES_DIRS) : null;
const source = { platform: 'android', mode: MODE };
let payloadTree = null, roots = [], stats = { nodes: 0 };

if (MODE === 'static') {
  if (!LAYOUTS.length) { console.error('static 模式缺 --layouts <a.xml[,b.xml]>'); process.exit(1); }
  source.layouts = LAYOUTS; source.valuesDirs = VALUES_DIRS;
  for (const f of LAYOUTS) {
    if (!fs.existsSync(f)) { console.error(`布局不存在：${f}`); process.exit(1); }
    const doc = parseXml(fs.readFileSync(f, 'utf8'));
    if (!doc) { console.error(`布局解析失败：${f}`); process.exit(1); }
    roots.push({ file: f, tree: layoutNode(doc, values) });
  }
  stats.nodes = roots.reduce((a, r) => a + countNodes(r.tree), 0);
} else if (MODE === 'device') {
  source.device = requireAdb();
  const page = arg('--page', 'page');
  const shot = arg('--screenshot') || OUT.replace(/\.json$/, '') + '.png';
  const cap = adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (cap.status !== 0 || !cap.stdout || !cap.stdout.length) { console.error('⛔ adb screencap 失败'); process.exit(1); }
  fs.mkdirSync(path.dirname(path.resolve(shot)), { recursive: true });
  fs.writeFileSync(shot, cap.stdout);
  source.screenshot = path.basename(shot);
  const DUMP = '/sdcard/app-baseline-uidump.xml';
  adb(['shell', 'uiautomator', 'dump', DUMP], { encoding: 'utf8' });
  const pull = adb(['exec-out', 'cat', DUMP], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  adb(['shell', 'rm', '-f', DUMP], { encoding: 'utf8' });
  if (pull.status !== 0 || !pull.stdout || !pull.stdout.includes('<')) { console.error('⛔ uiautomator dump 拉取失败（' + page + '）'); process.exit(1); }
  const doc = parseXml(pull.stdout);
  const firstNode = doc && (doc.tag === 'hierarchy' ? doc.children[0] : doc);
  if (!firstNode) { console.error('⛔ uiautomator dump 解析失败'); process.exit(1); }
  if (LAYOUTS.length) {
    source.layouts = LAYOUTS; source.valuesDirs = VALUES_DIRS;
    const staticRoots = LAYOUTS.filter(fs.existsSync).map((f) => ({ file: f, tree: layoutNode(parseXml(fs.readFileSync(f, 'utf8')), values) }));
    payloadTree = deviceNode(firstNode, collectStaticById(staticRoots));
  } else {
    payloadTree = deviceNode(firstNode, null);
  }
  stats.nodes = countNodes(payloadTree);
} else { console.error(`未知 --mode ${MODE}（static | device）`); process.exit(1); }

const baseline = {
  schema: 'app-baseline/1',
  extractedAt: new Date().toISOString(),
  source,
  stats,
};
if (payloadTree) baseline.tree = payloadTree; else baseline.roots = roots;

fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n');
console.log(`✓ 基线落盘 ${OUT}（mode=${MODE}，nodes=${stats.nodes}${source.screenshot ? '，screenshot=' + source.screenshot : ''}）`);
