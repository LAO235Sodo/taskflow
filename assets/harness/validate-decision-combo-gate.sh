#!/usr/bin/env bash
# validate-decision-combo-gate.sh — 决策组合门（taskflow 硬规则 16① 的机械执行体）
# 由 `node tf.mjs mech install 决策组合门` 生成（模板住技能仓库 assets/harness/，assetExts 按项目注入——勿手改，重装覆盖）。
# 双模式：
#   默认                          CHANGELOG 静态校验：锚点之上条目，凡反引号资产 token 命中 decisions/ → 须含「组合评估：」行列全或「语义中性——理由」
#   --spec <spec.md> [--base <ref>]  merge 阶段完备性：分支 diff 命中的决策须全量入 spec「决策组合评估」表
# 退出码：0 通过/降级（无 decisions、无锚点）；1 违规。兼容 macOS bash 3.2（无 mapfile/关联数组）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
TASKFLOW_DIR=".taskflow"
if [ -n "$COMMON_DIR" ]; then TASKFLOW_DIR="$(dirname "$COMMON_DIR")/.taskflow"; fi
DECISIONS_DIR="$TASKFLOW_DIR/decisions"
GATE_ANCHOR="决策组合门落地"
ASSET_EXTS='__ASSET_EXTS__'  # mech install 注入（project.json assetExts，'|' 分隔）
BT='`'  # 反引号经变量传递（GNU grep ERE 中 \` 是 buffer 锚，字面量必须绕开——2026-09-27 审查实证）

fail() { echo "⛔ [combo-gate] $*" >&2; exit 1; }
warn() { echo "⚠ [combo-gate] $*" >&2; }

if [ ! -d "$DECISIONS_DIR" ]; then
  warn "decisions/ 不存在 → 门降级通过（项目无决策台账）"
  exit 0
fi

# 资产文件 → 命中的决策文档 stem（basename 去扩展名子串匹配；<6 字符标识符跳过防误命中）
match_decisions() {
  local base ext stem doc
  base="$(basename "$1")"
  ext="${base##*.}"
  # 扩展名命中判定用 grep -qx（bash 3.2 的 case 模式变量中 '|' 是字面量非 alternation——2026-09-27 实证）
  [ -n "$ext" ] && [ "$ext" != "$base" ] || return 0
  printf '%s' "$ASSET_EXTS" | tr '|' '\n' | grep -qx "$ext" || return 0
  stem="${base%.*}"
  [ "${#stem}" -ge 6 ] || return 0
  for doc in "$DECISIONS_DIR"/*.md; do
    [ -e "$doc" ] || continue
    grep -q -F "$stem" "$doc" && basename "$doc" .md
  done
  return 0
}

# ---- 参数解析 ----
SPEC_ARG=""
BASE_ARG="origin/main"
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) SPEC_ARG="${2:?--spec 需要路径}"; shift 2 ;;
    --base) BASE_ARG="${2:?--base 需要 ref}"; shift 2 ;;
    *) fail "未知参数 $1" ;;
  esac
done

if [ -n "$SPEC_ARG" ]; then
  # 模式二：spec 完备性——diff 命中决策须全量入「决策组合评估」表
  [ -f "$SPEC_ARG" ] || fail "spec 不存在：$SPEC_ARG"
  git rev-parse --verify --quiet "$BASE_ARG" >/dev/null || fail "base ref 不存在：${BASE_ARG}（配错 base=零输入假绿，禁放行）"
  SPEC_TEXT="$(cat "$SPEC_ARG")"
  REQUIRED="" ; VIOL=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    for stem in $(match_decisions "$f" | sort -u); do
      case " $REQUIRED " in *" $stem "*) continue ;; esac
      REQUIRED="$REQUIRED $stem"
      echo "$SPEC_TEXT" | sed -n '/决策组合评估/,/^## /p' | grep -q -F "$stem" || { warn "spec「决策组合评估」表缺命中决策：${stem}（diff 文件 $f 命中）"; VIOL=1; }
    done
  done < <(git diff --name-only "$BASE_ARG...HEAD" 2>/dev/null || git diff --name-only "$BASE_ARG..HEAD")
  [ "$VIOL" -eq 0 ] && echo "✓ [combo-gate] spec 完备性通过${REQUIRED:+（命中：$REQUIRED ）}"
  exit "$VIOL"
fi

# ---- 模式一：CHANGELOG 静态校验 ----
CHANGELOG="$ROOT/docs/CHANGELOG.md"
[ -f "$CHANGELOG" ] || fail "缺 docs/CHANGELOG.md（应由 mech install 建档；缺失=门未启用，跑 node tf.mjs mech install 决策组合门）"

ANCHOR_LINE="$(grep -n "^## .*$GATE_ANCHOR" "$CHANGELOG" | tail -1 | cut -d: -f1)" || true
[ -n "$ANCHOR_LINE" ] || { warn "CHANGELOG 无锚点条目「${GATE_ANCHOR}」→ 门尚未启用（历史全豁免）"; exit 0; }
[ "$ANCHOR_LINE" -gt 1 ] || { echo "✓ [combo-gate] 锚点之上无条目（bootstrap 通过）"; exit 0; }

# 受管区按 ^## 切块（awk 聚合后以 NUL 分隔输出，bash read -d '' 整块读取——
# 逐行 read 会把块拆散致校验不可达，2026-09-27 全新上下文审查 B1 实证后重写）
VIOLATIONS=0
head -n $((ANCHOR_LINE - 1)) "$CHANGELOG" | awk '
  /^## / { if (buf != "") { printf "%s%c", buf, 0; buf = "" } }
  { buf = buf $0 "\n" }
  END { if (buf != "") printf "%s%c", buf, 0 }
' | while IFS= read -r -d '' block; do
  title="$(printf '%s\n' "$block" | grep -m1 '^## ' || true)"
  [ -n "$title" ] || continue
  # token 从正文提取、组合评估也在整块内查——标题行反引号不参与（防标题误报）
  tokens="$(printf '%s\n' "$block" | tail -n +2 | grep -oE "${BT}[^${BT}]+${BT}" | tr -d "$BT" | grep -E "\\.($ASSET_EXTS)\$" || true)"
  [ -n "$tokens" ] || continue
  REQUIRED=""
  for tok in $tokens; do
    for stem in $(match_decisions "$tok" | sort -u); do
      case " $REQUIRED " in *" $stem "*) continue ;; esac
      REQUIRED="$REQUIRED $stem"
    done
  done
  [ -n "$REQUIRED" ] || continue
  if printf '%s\n' "$block" | tail -n +2 | grep -qE '组合评估\*{0,2}\s*[:：]'; then
    MISS=""
    for stem in $REQUIRED; do
      printf '%s\n' "$block" | grep -q -F "$stem" || MISS="$MISS $stem"
    done
    if [ -n "$MISS" ]; then echo "⛔ [combo-gate] $title — 组合评估行列缺命中决策：${MISS}" >&2; exit 1; fi
  else
    echo "⛔ [combo-gate] $title — 反引号资产命中决策（${REQUIRED}）但无「组合评估：」行 → 补「组合评估： <列全量命中决策 或 语义中性——理由>」" >&2
    exit 1
  fi
done
echo "✓ [combo-gate] CHANGELOG 受管区全部合规"
