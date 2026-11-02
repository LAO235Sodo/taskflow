// host-adapter.mjs — taskflow 宿主适配层（v2.87.0）：omp 扩展事件面「运行时合同」单点——注入落点/会话 id/本会话标注。
// 背景（2.84.1 实锤）：before_provider_request 的 payload 形状随 provider transport 而定，omp 文档只合同「返回替换后的
// 请求体」——向 payload.system 写入在真实形状（无 system 键）下被传输层静默丢弃=E/U/V 三墙 no-op 19 天。合同细节收拢
// 本模块：改注入形态只改这里，guard/测试/金丝雀同源消费（渲染副本经 inlineSharedDeps 内联自包含）。
// 零 import 纯函数。

// 注入落点（2.84.1 通道修复）：主形态=messages 头插（新数组，禁原地 mutate 共享数组）；Anthropic 形字符串/blocks
// system 保留兼容；无一命中（未知传输形态）返回 undefined 不注入不炸。
export function injectPrepend(p, inject) {
  if (Array.isArray(p?.messages)) { p.messages = [{ role: 'system', content: inject }, ...p.messages]; return p; }
  if (typeof p?.system === 'string') { p.system = `${inject}\n\n${p.system}`; return p; }
  if (Array.isArray(p?.system)) { p.system = [{ type: 'text', text: inject }, ...p.system]; return p; }
  return undefined;
}

// 会话 id 源（v2.84.0「，本会话」标注）：会话文件 basename 去 .jsonl（形如 时间戳_uuid）；非串/空/异常返回 null（降级无标注）。
// 零 import：basename 用字符串切分等价实现（/ 与 \ 双分隔符，Windows 会话路径同样正确）。
export function sessIdOf(sessionFile) {
  try {
    if (typeof sessionFile !== 'string' || !sessionFile) return null;
    return sessionFile.split(/[\\/]/).pop().replace(/\.jsonl$/, '') || null;
  } catch { return null; }
}

// 「，本会话」标注（2.84.1 后缀匹配）：整名相等或 sessionId 下划线后缀（uuid 段）相等皆亮（旧精确相等在
// 时间戳_uuid 文件名形态下恒不命中=标注永不亮，对抗审查实锤）；不匹配/缺参返回空串（降级无标注）。
export function inSessionMark(sessionId, tjSessionId) {
  return sessionId && tjSessionId && (tjSessionId === sessionId || sessionId.endsWith('_' + tjSessionId)) ? '，本会话' : '';
}
