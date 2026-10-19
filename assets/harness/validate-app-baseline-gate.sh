#!/usr/bin/env bash
# validate-app-baseline-gate.sh — 现状基线门（taskflow 硬规则 21 / 机制 APP_PAGE_BASELINE 的机械执行体）
# 由 `node tf.mjs mech install APP_PAGE_BASELINE` 生成（模板住技能仓库 assets/harness/——勿手改，重装覆盖）。
# 防的事故类：改现有页面的原型「凭模型先验捏造、不像现有 App」（2026-09-27 用户实证——对标引导无现状档/
# 真源仅覆盖定稿原型/提取器够不到 Android XML/单文件 HTML 内联 CSS 凭记忆）。本脚本把「现状基线存在且被引用」
# 从 agent 记性变成机械检查：App 现状页 = 「长什么样」的唯一事实，原型 = 基线 + 显式 delta。
# 双模式：
#   默认                          CHANGELOG 静态校验：锚点之上条目，凡反引号资产命中前端视觉资产
#                                    （res/layout|values|drawable|color|menu|anim|font/xml 或 .vue/.tsx/.jsx/.css/.scss/.sass/.less/.qml）
#                                    → 该条目须含「基线：」行——指向存在的 baseline*.json（schema=app-baseline/1（Android）/ design-spec-extract/1（web））
#                                    或「基线：不适用——<理由>」廉价合法通道（新增页面等，防静默绕闸）
#   --spec <spec.md>              merge 阶段完备性：spec 产物链「原型」行已拍板 → 必须有「现状基线」行——
#                                    已提取 → 挂链 baseline*.json（存在 + schema 合法）；不适用 → 必须带理由
# 降级通过：无 .taskflow（CI fresh checkout）/ CHANGELOG 无锚点（门未启用，历史祖父豁免）。
# 退出码：0 通过/降级；1 违规。兼容 macOS bash 3.2（无 mapfile/关联数组；NUL 分块读取——逐行 read 会拆散块）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
TASKFLOW_DIR=".taskflow"
MAIN_ROOT="$ROOT"
if [ -n "$COMMON_DIR" ]; then TASKFLOW_DIR="$(dirname "$COMMON_DIR")/.taskflow"; MAIN_ROOT="$(dirname "$COMMON_DIR")"; fi

GATE_ANCHOR="现状基线门落地"
BT='`'  # 反引号经变量传递（GNU grep ERE 中 \` 是 buffer 锚——2026-09-27 审查实证）
# 前端视觉资产判定（与 validate-design-spec-gate 同谓词：逻辑代码 ext 不触发，结构/样式资产才触发）
FE_RE='(^|/)res/(layout|layout-[^/]*|values|values-[^/]*|drawable|drawable-[^/]*|color|menu|anim|font|xml)/|\.(vue|tsx|jsx|css|scss|sass|less|qml)$'

fail() { echo "⛔ [baseline-gate] $*" >&2; exit 1; }
warn() { echo "⚠ [baseline-gate] $*" >&2; }

if [ ! -d "$TASKFLOW_DIR" ]; then
  warn "$TASKFLOW_DIR 不存在（CI fresh checkout / 非 taskflow 项目）→ 门降级通过"
  exit 0
fi

# ---- 参数解析 ----
SPEC_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) SPEC_ARG="${2:?--spec 需要路径}"; shift 2 ;;
    *) fail "未知参数 $1（用法见脚本头注释）" ;;
  esac
done

# 基线 JSON 有效性：存在（repo 根/主仓库根/绝对路径三处解析）+ schema 头——
# app-baseline/1（Android 提取器）或 design-spec-extract/1（web 腿：extract-spec.js 指向运行中的真实站点提取，落 baseline/ 目录——同一工具换目标即基线提取器，不改其 schema）
valid_baseline_json() {
  local p="$1"
  local f=""
  if [ -f "$ROOT/$p" ]; then f="$ROOT/$p"
  elif [ -f "$MAIN_ROOT/$p" ]; then f="$MAIN_ROOT/$p"
  elif [ -f "$p" ]; then f="$p"
  else return 1; fi
  grep -qE '"schema"[[:space:]]*:[[:space:]]*"(app-baseline|design-spec-extract)/' "$f"
}

# ---- 模式二：spec 完备性（merge 阶段调用）----
if [ -n "$SPEC_ARG" ]; then
  [ -f "$SPEC_ARG" ] || fail "spec 不存在：${SPEC_ARG}"
  # 产物链节：原型行已拍板 → 基线行必须在链（无产物链节/未拍板 = PROTOTYPE_STALE 门管辖，本门不管）
  CHAIN="$(sed -n '/^## .*产物链/,/^## /p' "$SPEC_ARG")"
  if [ -z "$CHAIN" ] || ! printf '%s\n' "$CHAIN" | grep -E '^\|.*原型' | grep -q '已拍板'; then
    echo "✓ [baseline-gate] spec 无已拍板原型（产物链缺失或未拍板）——本门不适用（PROTOTYPE_STALE 门管辖）"
    exit 0
  fi
  BASELINE_ROW="$(printf '%s\n' "$CHAIN" | grep -E '^\|.*现状基线' | head -1 || true)"
  if [ -z "$BASELINE_ROW" ]; then
    fail "spec 产物链「原型」已拍板，但无「现状基线」行 → 改现有页任务立项时跑 scripts/design/extract-app-baseline.js 提取（硬规则 21）；新增页面 = 行写「不适用——新增页面」+同类现状页取样"
  fi
  if printf '%s' "$BASELINE_ROW" | grep -q '已提取'; then
    JSON_PATH="$(printf '%s' "$BASELINE_ROW" | grep -oE "[^ ${BT}]+baseline[^ ${BT}]*\.json" | head -1 || true)"
    if [ -z "$JSON_PATH" ]; then
      fail "产物链「现状基线」已提取，但行内无 baseline*.json 路径 → 把提取产物路径写进该行"
    fi
    valid_baseline_json "$JSON_PATH" || fail "产物链挂链的基线无效：${JSON_PATH}（不存在或缺 \"schema\": \"app-baseline/1\"（Android）/ \"design-spec-extract/1\"（web）头——重新提取）"
    echo "✓ [baseline-gate] spec 完备性通过（已拍板原型 ↔ ${JSON_PATH}）"
    exit 0
  fi
  if printf '%s' "$BASELINE_ROW" | grep -q '不适用'; then
    if printf '%s' "$BASELINE_ROW" | grep -qE '不适用.*(——|—).+'; then
      echo "✓ [baseline-gate] spec 完备性通过（现状基线不适用，理由在链）"
      exit 0
    fi
    fail "产物链「现状基线」= 不适用但缺理由（——之后写明，如「新增页面」）——防静默绕闸"
  fi
  fail "产物链「现状基线」状态无法识别（已提取 / 不适用——理由，二者必居其一）：${BASELINE_ROW}"
fi

# ---- 模式一：CHANGELOG 静态校验 ----
CHANGELOG="$ROOT/docs/CHANGELOG.md"
[ -f "$CHANGELOG" ] || fail "缺 docs/CHANGELOG.md（应由 mech install 建档；缺失=门未启用，跑 node tf.mjs mech install APP_PAGE_BASELINE）"

ANCHOR_LINE="$(grep -n "^## .*$GATE_ANCHOR" "$CHANGELOG" | tail -1 | cut -d: -f1)" || true
[ -n "$ANCHOR_LINE" ] || { warn "CHANGELOG 无锚点条目「${GATE_ANCHOR}」→ 门尚未启用（历史全豁免）"; exit 0; }
[ "$ANCHOR_LINE" -gt 1 ] || { echo "✓ [baseline-gate] 锚点之上无条目（bootstrap 通过）"; exit 0; }

# 受管区按 ^## 切块（awk 聚合后以 NUL 分隔输出，bash read -d '' 整块读取——逐行 read 会拆散块，B1 实证）
head -n $((ANCHOR_LINE - 1)) "$CHANGELOG" | awk '
  /^## / { if (buf != "") { printf "%s%c", buf, 0; buf = "" } }
  { buf = buf $0 "\n" }
  END { if (buf != "") printf "%s%c", buf, 0 }
' | while IFS= read -r -d '' block; do
  title="$(printf '%s\n' "$block" | grep -m1 '^## ' || true)"
  [ -n "$title" ] || continue
  # token 从正文提取（标题行反引号不参与——防标题误报）；只认前端视觉资产
  tokens="$(printf '%s\n' "$block" | tail -n +2 | grep -oE "${BT}[^${BT}]+${BT}" | tr -d "$BT" | grep -E "$FE_RE" || true)"
  [ -n "$tokens" ] || continue
  baseline_line="$(printf '%s\n' "$block" | tail -n +2 | grep -E '基线\*{0,2}\s*[:：]' | head -1 || true)"
  if [ -z "$baseline_line" ]; then
    echo "⛔ [baseline-gate] $title — 涉及前端视觉资产但缺「基线：」行 → 指向 baseline*.json 或「基线：不适用——<理由>」（如新增页面）" >&2
    exit 1
  fi
  # 廉价合法通道：不适用 + 理由（防静默绕闸：理由必填）
  if printf '%s' "$baseline_line" | grep -qE '基线\*{0,2}\s*[:：].{0,40}不适用.*(——|—).+' \
     || printf '%s' "$baseline_line" | grep -qE '基线\*{0,2}\s*[:：]\s*(无现状|不适用|新增页面)(——|—).+'; then
    continue
  fi
  json_path="$(printf '%s' "$baseline_line" | grep -oE "${BT}[^${BT}]+\.json${BT}" | tr -d "$BT" | head -1 || true)"
  [ -n "$json_path" ] || json_path="$(printf '%s' "$baseline_line" | grep -oE '[^ 　]+\.json' | head -1 || true)"
  if [ -z "$json_path" ] || ! valid_baseline_json "$json_path"; then
    echo "⛔ [baseline-gate] $title — 「基线：」行指向的 JSON 无效（${json_path}：不存在或缺 \"schema\": \"app-baseline/1\"（Android）/ \"design-spec-extract/1\"（web）头）→ 用 scripts/design/extract-app-baseline.js 重新提取（web：extract-spec.js 指向运行中的真实站点）" >&2
    exit 1
  fi
done
echo "✓ [baseline-gate] CHANGELOG 受管区全部合规（现状基线门）"
