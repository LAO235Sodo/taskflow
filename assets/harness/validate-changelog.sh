#!/usr/bin/env bash
# validate-changelog.sh — CHANGELOG 收尾校验（由 node tf.mjs mech install 决策组合门 生成；收尾必跑）
# 检查：存在性 / 条目格式（做了什么·涉及文件·commits）/ 反引号路径自洽 / 串接决策组合门。
# 退出码：0 通过（WARN 不阻断）；1 FAIL。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHANGELOG="$ROOT/docs/CHANGELOG.md"
fail() { echo "⛔ [changelog] $*" >&2; exit 1; }
warn() { echo "⚠ [changelog] $*" >&2; }

[ -f "$CHANGELOG" ] || fail "缺 docs/CHANGELOG.md"

grep -q '^## ' "$CHANGELOG" || fail "无任何 ^## 条目"

MISSING=""
grep -q '做了什么' "$CHANGELOG" || MISSING="$MISSING 做了什么"
grep -q '涉及文件' "$CHANGELOG" || MISSING="$MISSING 涉及文件"
grep -q 'commits' "$CHANGELOG" || MISSING="$MISSING commits"
[ -z "$MISSING" ] || fail "条目缺字段：$MISSING"

# 修复类条目（同类排查门 CLASS_SWEEP_GATE 硬规则 25 + 出现次数）——条目级块解析，仅受管区（锚点之上）
# 对抗加固史（v2.49.0）：文件级 grep 两绕过（触发词变体/跨条目泄漏）→ 条目级；审查二轮三缺陷再修——
# ①锚点祖父豁免：与同链组合门同口径，锚点「决策组合门落地」之下历史条目不检（全文件扫描会误红历史=逼人回改祖父区）；
# ②标题行入块：触发词写在 ## 标题（conventional 风格 ## Bug Fixes）不再免检；③词表十三式小写匹配（修复的bug/修复 bug/
# 修复了/缺陷修复/修复缺陷/修 bug/bug 修复/bugfix/bug-fix/fix(es)?|fixed 与 bug|缺陷|问题|issue 同句窗口搭配（16 字内，
# 裸 fix/Fix 高频词不单列防误报，「masse2e 缺陷修复并集」活体零触发实证））。
# 块语义（2026-10-13 审查收口）：触发词匹配扫整块含标题行（标题触发检查），「同类排查：」等行级满足检查只扫正文
# （body 变量，标题行不入）——标题里写样板字不算满足，对齐 validate-decision-combo-gate.sh tail -n +2 先例口径。
# 已知边界（复验残留，记边界不修）：代码围栏内行首 ## 会切块产生幽灵块（误报方向，与组合门同款暴露）；
# 首个 ^## 之前的卷首文字不进任何块（preamble 半边盲区，真实性低）；锚点行被手工删除时本检查扫全文件而组合门降级豁免
# （口径相反，仅人为破坏可达——锚点是受管区契约，删锚点=拆门，doctor/组合门另有把关）。
SWEEP_ANCHOR_LINE="$(grep -n '^## .*决策组合门落地' "$CHANGELOG" | tail -1 | cut -d: -f1)" || true
SWEEP_INPUT="$CHANGELOG"
SWEEP_TMP_FILE=""
if [ -n "$SWEEP_ANCHOR_LINE" ]; then
  if [ "$SWEEP_ANCHOR_LINE" -le 1 ]; then SWEEP_INPUT=/dev/null; else
    SWEEP_TMP_FILE=$(mktemp); head -n $((SWEEP_ANCHOR_LINE - 1)) "$CHANGELOG" > "$SWEEP_TMP_FILE"; SWEEP_INPUT="$SWEEP_TMP_FILE"
  fi
fi
SWEEP_VIOL=$(awk '
  function flush() {
    if (!seen) return;
    if (tolower(buf) ~ /修复的[[:space:]]*bug|修复[[:space:]]*bug|修复了|缺陷修复|修复缺陷|修[[:space:]]*bug|bug[-[:space:]]*修复|bugfix|bug[-[:space:]]*fix|fix(es)?[[:space:]][^。；\n]{0,16}(bug|缺陷|问题)|fixed[[:space:]][^。；\n]{0,16}(bug|缺陷|问题|issue)|热修|hotfix/) {
      if (body !~ /(^|\n)[^\n]*同类排查：/) printf "%s —— 缺「同类排查：」行（唯一实例+证据 / N 处已修——扩散三问：上游/下游/同类 grep，细则 testing.md §十）——须成行出现，标题提及不算（2026-10-13 审查实证标题行写样字算数的绕过已收口）\n", title;
      if (body !~ /(^|\n)[^\n]*出现次数：/) printf "%s —— 缺「出现次数：」行\n", title;
    }
  }
  /^## / { flush(); seen = 1; buf = $0 "\n"; body = ""; title = $0; next }
  { if (seen) { buf = buf $0 "\n"; body = body $0 "\n" } }
  END { flush() }
' "$SWEEP_INPUT")
[ -n "$SWEEP_TMP_FILE" ] && rm -f "$SWEEP_TMP_FILE"
if [ -n "$SWEEP_VIOL" ]; then
  fail "修复类条目（触发词十三式，大小写不敏感：修复的 bug／修复 bug／修复了／缺陷修复／修复缺陷／修 bug／bug 修复／bugfix／bug-fix／fix(es) bug类宾语／fixed bug类宾语|issue／热修复／hotfix）条目级缺行：$SWEEP_VIOL"
fi

# 功能代码条目文档同步门（DOC_SYNC_GATE，硬规则 26）——涉及功能代码（__ASSET_EXTS__ 扩展名路径）的条目
# 须含「文档同步：」行（列明更新的 PRD/design/functional-map 条目；行为/契约零变更写「文档同步：不适用——理由」）。
# 延迟激活（对齐 STYLE_SOURCE_GATE 哲学）：锚点条目「## <日期> — 文档同步门落地」不存在 = 未激活，
# 全部豁免只 WARN 提示（存量项目升级零破坏；显式插入锚点=显式接受强制）。
DOC_ANCHOR_LINE="$(grep -n '^## .*文档同步门落地' "$CHANGELOG" | tail -1 | cut -d: -f1)" || true
if [ -z "$DOC_ANCHOR_LINE" ]; then
  warn "文档同步门未激活——在 docs/CHANGELOG.md 顶部插入锚点条目「## <日期> — 文档同步门落地」后启用（插入即接受强制，锚点之上新条目受检）"
else
  DOC_TMP=$(mktemp); head -n $((DOC_ANCHOR_LINE - 1)) "$CHANGELOG" > "$DOC_TMP"
  # __ASSET_EXTS__ 由 mech install 渲染时替换为项目扩展名集（java|ts|js|vue…）——正则字面量替换后天然成立
  DOC_VIOL=$(awk '
    function flush() {
      if (!seen) return;
      if (buf ~ /涉及文件/ && buf ~ /\.(__ASSET_EXTS__)/ && body !~ /(^|\n)[^\n]*文档同步：/) printf "%s —— 缺「文档同步：」行（列明更新的 PRD/design/functional-map 条目；零变更写「文档同步：不适用——理由」）——须成行出现，标题提及不算（v2.55.1 活体攻击实证：块内任意位置含「文档同步」字样可绕过；2026-10-13 收口标题行写样字算数的残余面）\n", title;
    }
    /^## / { flush(); seen = 1; buf = $0 "\n"; body = ""; title = $0; next }
    { if (seen) { buf = buf $0 "\n"; body = body $0 "\n" } }
    END { flush() }
  ' "$DOC_TMP")
  rm -f "$DOC_TMP"
  [ -n "$DOC_VIOL" ] && fail "功能代码条目缺文档同步行（DOC_SYNC_GATE，硬规则 26）：$DOC_VIOL"
fi
if grep -qE '<!DOCTYPE|<html' "$CHANGELOG"; then
  fail "CHANGELOG 含 HTML——纯 markdown"
fi

# 反引号路径自洽（只 WARN 计数，不阻断；跳过省略号与 7 位 commit hash；反引号经变量绕开 ERE \` 锚）
BT='`'
WARN_N=0
for p in $(grep -oE "${BT}[^${BT}]+${BT}" "$CHANGELOG" | tr -d "$BT" | grep '/' | grep -vE '^\.\.\.$|^[0-9a-f]{7}$' || true); do
  [ -e "$ROOT/$p" ] || { warn "反引号路径不存在：$p"; WARN_N=$((WARN_N+1)); }
done
[ "$WARN_N" -gt 0 ] && warn "共 $WARN_N 个路径待核（历史条目可豁免）"

# 串接决策组合门（失败即整体失败）
echo "== 决策组合门 =="
"$ROOT/scripts/harness/validate-decision-combo-gate.sh"
# 串接原型规格表门（失败即整体失败；DESIGN_SPEC_EXTRACT 机制）
echo "== 原型规格表门 =="
"$ROOT/scripts/harness/validate-design-spec-gate.sh"
# 串接现状基线门（失败即整体失败；APP_PAGE_BASELINE 机制）
echo "== 现状基线门 =="
"$ROOT/scripts/harness/validate-app-baseline-gate.sh"
# 串接需求基线对照门（失败即整体失败；REQ_ANCHOR_GATE 机制，硬规则 27——文档同步行条目 ID 真实性/PRD 粒度/不适用矛盾）
echo "== 基线对照门 =="
"$ROOT/scripts/harness/validate-baseline-anchor-gate.sh"
echo "✓ [changelog] 全部通过"
