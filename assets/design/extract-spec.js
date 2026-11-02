/*!
 * extract-spec.js — 原型→规格表机械提取器（taskflow 机制 DESIGN_SPEC_EXTRACT 的工具体）
 * 浏览器上下文执行（omp browser tab.run / Playwright evaluate / DevTools console 粘贴均可），零依赖单文件。
 *
 * 用法（在打开原型 HTML 的页面里执行本文件后）：
 *   const out = __designSpecExtractCLI(JSON.stringify({
 *     roots: ['.sE .phone', '.sG .phone'],   // 必填：每屏/每卡片的根选择器（多匹配各自成树）
 *     source: 'design-v2.html'               // 建议：源文件名，写入头部供溯源
 *   }));
 *   // out 是 JSON 字符串：{ json: <规格表对象>, markdown: <结构树摘要> }
 *   // 编排层落盘：.taskflow/<task-id>/design/spec-extract.json + spec-extract.md（真源住址，data.md「产物住址约定」）
 *
 * 产出 schema = design-spec-extract/1，结构是一等公民：
 *   头部：schema / extractedAt / source / url / devicePixelRatio / viewport / stats
 *   roots[]：{ selector, matchIndex, elementCount, tree }
 *   节点：sel（路径选择器）/ tag / role（data-spec 属性=组件角色标记，原型作者可打标）/ cls / text /
 *         rect（x,y,w,h CSS px）/ layout（display/flex 方向/对齐/gap——排版语义）/
 *         styles（色/底/渐变/描边×4边/圆角×4角/阴影/字体五项/字距/行高/内距/外距/透明度）/
 *         pseudo（::before/::after content+色——徽章/角标常用）/ children[]
 *
 * 消费（硬规则 19 / prototype-selfcheck.md 标准来源第一位）：
 *   - 子任务 spec 附件 = spec-extract.md（结构树摘要）+ json 路径——执行者对照源码级规格实现，禁止编排层凭记忆转述
 *   - 验收对照 = 实现渲染采样值 vs 本表预期值逐项比对（硬规则 13：禁目测定案）
 *   - 原型 HTML 改动 = 重新提取（规格表随拍板冻结，是拍板时刻的机械快照）
 */
(function (global) {
  'use strict';

  var SCHEMA = 'design-spec-extract/1';
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TITLE: 1, HEAD: 1, NOSCRIPT: 1, TEMPLATE: 1, BR: 1 };

  var LAYOUT_PROPS = ['display', 'position', 'flex-direction', 'flex-wrap', 'align-items',
    'justify-content', 'gap', 'text-align', 'overflow'];
  var STYLE_PROPS = ['color', 'background-color', 'background-image', 'background-size',
    'border-top-width', 'border-top-style', 'border-top-color',
    'border-right-width', 'border-right-style', 'border-right-color',
    'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
    'border-left-width', 'border-left-style', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'box-shadow', 'font-family', 'font-size', 'font-weight', 'font-style',
    'letter-spacing', 'line-height', 'text-transform', 'opacity'];
  var BOX_PROPS = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];

  function pick(cs, props) {
    var o = {};
    for (var i = 0; i < props.length; i++) o[props[i]] = cs.getPropertyValue(props[i]);
    return o;
  }

  function ownText(el) {
    var t = '';
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) t += n.nodeValue;
    }
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > 60 ? t.slice(0, 59) + '…' : t;
  }

  /* 路径选择器：tag + (#id | 首类) + :nth-of-type——定位唯一、可 grep、可采样映射 */
  function selectorOf(el, root) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== root.parentElement) {
      var tag = cur.tagName.toLowerCase();
      var part = tag;
      if (cur.id) { part = tag + '#' + cur.id; }
      else if (cur.classList && cur.classList.length) {
        // 取第一个非工具类（滤掉布局辅助类如 container/wrapper 之外难以判断，保守取首类）
        part = tag + '.' + cur.classList[0].replace(/[^a-zA-Z0-9_-]/g, '');
      }
      var sameTag = 0, sib = cur;
      while (sib) { if (sib.nodeType === 1 && sib.tagName === cur.tagName) sameTag++; sib = sib.previousElementSibling; }
      if (sameTag > 1) part += ':nth-of-type(' + sameTag + ')';
      if (cur !== root) parts.unshift(part);
      if (cur === root) break;
      cur = cur.parentElement;
      if (!cur || cur.nodeType !== 1) break;
    }
    return parts.join(' > ');
  }

  function pseudoOf(el) {
    var out = {};
    ['::before', '::after'].forEach(function (ps) {
      var cs = getComputedStyle(el, ps);
      var content = cs.getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") return;
      out[ps] = {
        content: content.replace(/^"|"$/g, ''),
        'background-color': cs.getPropertyValue('background-color'),
        'background-image': cs.getPropertyValue('background-image'),
        color: cs.getPropertyValue('color'),
        'border-radius': cs.getPropertyValue('border-radius'),
        width: cs.getPropertyValue('width'),
        height: cs.getPropertyValue('height')
      };
    });
    return Object.keys(out).length ? out : null;
  }

  function digestValue(v, max) { // 摘要用：去单位外噪声、限长
    if (!v) return '';
    v = String(v).replace(/\s+/g, ' ').trim();
    if (v === 'none' || v === 'normal' || v === '0px' || v === '0, 0, 0, 0' || v === 'rgba(0, 0, 0, 0)') return '';
    return v.length > (max || 40) ? v.slice(0, (max || 40) - 1) + '…' : v;
  }

  function digestLine(node, depth) {
    var pad = new Array(depth + 1).join('  ') + '- ';
    var s = node.tag;
    if (node.cls) s += '.' + node.cls;
    if (node.role) s += ' [role=' + node.role + ']';
    s += ' ' + Math.round(node.rect.w) + 'x' + Math.round(node.rect.h);
    var st = node.styles;
    var bits = [];
    var r = digestValue(st['border-top-left-radius']) || digestValue(st['border-top-right-radius']);
    if (r) bits.push('r:' + r);
    var bg = digestValue(st['background-color']) || digestValue(st['background-image'], 60);
    if (bg) bits.push('bg:' + bg);
    var bt = digestValue(st['border-top-width']);
    if (bt) bits.push('border:' + bt + ' ' + digestValue(st['border-top-color']));
    var sh = digestValue(st['box-shadow'], 50);
    if (sh) bits.push('shadow:' + sh);
    var fs = digestValue(st['font-size']);
    if (fs) bits.push('fs:' + fs + (digestValue(st['font-weight']) ? '/' + st['font-weight'] : ''));
    var c = digestValue(st['color']);
    if (c) bits.push('c:' + c);
    if (bits.length) s += ' | ' + bits.join(' ');
    var lay = node.layout;
    var lb = [];
    if (lay.display && lay.display !== 'block') lb.push(lay.display);
    if (lay['flex-direction'] && lay['flex-direction'] !== 'row') lb.push(lay['flex-direction']);
    if (lay['align-items'] && lay['align-items'] !== 'normal') lb.push('ai:' + lay['align-items']);
    if (lay['justify-content'] && lay['justify-content'] !== 'normal') lb.push('jc:' + lay['justify-content']);
    if (digestValue(lay.gap)) lb.push('gap:' + lay.gap);
    if (lb.length) s += ' | ' + lb.join(' ');
    var pd = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].map(function (p) { return digestValue(node.box[p]); }).filter(Boolean);
    if (pd.length) s += ' | pad:' + pd.join(' ');
    if (node.pseudo) s += ' | pseudo:' + Object.keys(node.pseudo).join(',');
    if (node.text) s += ' "' + node.text + '"';
    return pad + s;
  }

  function walkTree(el, root, counter, mdLines, depth) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none') return null; // 不可达子树剪枝（display:none 后代样式是未解析假值）
    var rect = el.getBoundingClientRect();
    var node = {
      sel: selectorOf(el, root),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('data-spec') || null,
      cls: el.classList && el.classList.length ? el.classList[0] : null,
      text: ownText(el),
      rect: { x: Math.round(rect.x * 10) / 10, y: Math.round(rect.y * 10) / 10, w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 },
      layout: pick(cs, LAYOUT_PROPS),
      styles: pick(cs, STYLE_PROPS),
      box: pick(cs, BOX_PROPS),
      pseudo: pseudoOf(el),
      children: []
    };
    counter.n++;
    mdLines.push(digestLine(node, depth));
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      if (SKIP_TAGS[kids[i].tagName]) continue;
      var child = walkTree(kids[i], root, counter, mdLines, depth + 1);
      if (child) node.children.push(child);
    }
    return node;
  }

  function extractDesignSpec(rootSelectors, opts) {
    opts = opts || {};
    var doc = global.document;
    if (!doc || !doc.body) throw new Error('extract-spec.js 需在浏览器页面上下文执行（document 未就绪）');
    var counter = { n: 0 };
    var roots = [];
    var md = ['# 原型规格表（design-spec-extract/1 机械提取）', ''];
    md.push('- source: ' + (opts.source || doc.location.href));
    md.push('- extractedAt: ' + new Date().toISOString());
    md.push('- devicePixelRatio: ' + (global.devicePixelRatio || 1) + '，rect 为 CSS px');
    md.push('- 用法：子任务实现唯一视觉依据；验收=实现采样值 vs 本表逐项比对（禁目测）');
    md.push('');
    (rootSelectors || []).forEach(function (sel) {
      var matches;
      try { matches = doc.querySelectorAll(sel); } catch (e) { throw new Error('根选择器无效：' + sel + '（' + e.message + '）'); }
      if (!matches.length) throw new Error('根选择器零匹配：' + sel);
      for (var i = 0; i < matches.length; i++) {
        md.push('## ' + sel + (matches.length > 1 ? ' [' + (i + 1) + '/' + matches.length + ']' : ''));
        md.push('');
        var lines = [];
        var before = counter.n;
        var tree = walkTree(matches[i], matches[i], counter, lines, 0);
        if (tree) tree.sel = sel; // 根节点 sel = 根选择器本身（采样可直接 querySelector）
        roots.push({ selector: sel, matchIndex: i, elementCount: counter.n - before, tree: tree });
        md.push.apply(md, lines);
        md.push('');
      }
    });
    return {
      schema: SCHEMA,
      extractedAt: new Date().toISOString(),
      source: opts.source || doc.location.href,
      url: doc.location.href,
      devicePixelRatio: global.devicePixelRatio || 1,
      viewport: { w: global.innerWidth, h: global.innerHeight },
      stats: { roots: roots.length, elements: counter.n },
      roots: roots,
      markdown: md.join('\n')
    };
  }

  /* 程序化入口：任意 browser 工具一行调用，返回 JSON 字符串（编排层落盘两个文件） */
  function cli(jsonArgs) {
    var a = JSON.parse(jsonArgs || '{}');
    var spec = extractDesignSpec(a.roots || [], a);
    return JSON.stringify({ json: spec, markdown: spec.markdown });
  }

  global.extractDesignSpec = extractDesignSpec;
  global.__designSpecExtractCLI = cli;
  if (global.console) global.console.log('[extract-spec] 就绪：__designSpecExtractCLI(JSON.stringify({roots:[...], source:"..."})) → {json, markdown}');
})(typeof window !== 'undefined' ? window : globalThis);
