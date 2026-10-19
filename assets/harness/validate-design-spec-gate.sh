#!/usr/bin/env bash
# validate-design-spec-gate.sh — 原型规格表门（taskflow 硬规则 19 / 机制 DESIGN_SPEC_EXTRACT 的机械执行体）
# 由 `node tf.mjs mech install DESIGN_SPEC_EXTRACT` 生成（模板住技能仓库 assets/harness/——勿手改，重装覆盖）。
# 防的事故类：前端原型实现「凭记忆转述」漏项（r2-r5 四轮返工实证——复用按钮实底/
# tab 胶囊/收益行格式/分隔线/圆角/内距全部漏在没进 spec 的部分）。本脚本把「结构化规格表存在且被引用」
# 从 agent 记性变成机械检查。
# 双模式：
#   默认                          CHANGELOG 静态校验：锚点之上条目，凡反引号资产命中前端视觉资产
#                                    （res/layout|values|drawable|color|menu|anim|font/xml 或 .vue/.tsx/.jsx/.css/.scss/.sass/.less/.qml）
#                                    → 该条目须含「规格表：」行——指向存在的 spec-extract*.json（schema=design-spec-extract/1）
#                                    或「规格表：不适用——<理由>」廉价合法通道（防静默绕闸）
#   --spec <spec.md>              merge 阶段完备性：spec 产物链「原型」行已拍板 → 必须挂 spec-extract*.json（存在 + schema 合法）
# 降级通过：无 .taskflow（CI fresh checkout）/ 项目无任何原型 HTML / CHANGELOG 无锚点（门未启用，历史祖父豁免）。
# 退出码：0 通过/降级；1 违规。兼容 macOS bash 3.2（无 mapfile/关联数组）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
TASKFLOW_DIR=".taskflow"
MAIN_ROOT="$ROOT"
if [ -n "$COMMON_DIR" ]; then TASKFLOW_DIR="$(dirname "$COMMON_DIR")/.taskflow"; MAIN_ROOT="$(dirname "$COMMON_DIR")"; fi

GATE_ANCHOR="规格表门落地"
BT='`'  # 反引号经变量传递（GNU grep ERE 中 \` 是 buffer 锚——2026-09-27 审查实证）
# 前端视觉资产判定（与代码扩展名解耦：逻辑代码 ext 不触发，结构/样式资产才触发）
FE_RE='(^|/)res/(layout|layout-[^/]*|values|values-[^/]*|drawable|drawable-[^/]*|color|menu|anim|font|xml)/|\.(vue|tsx|jsx|css|scss|sass|less|qml)$'

fail() { echo "⛔ [spec-gate] $*" >&2; exit 1; }
warn() { echo "⚠ [spec-gate] $*" >&2; }

if [ ! -d "$TASKFLOW_DIR" ]; then
  warn "$TASKFLOW_DIR 不存在（CI fresh checkout / 非 taskflow 项目）→ 门降级通过"
  exit 0
fi

# 项目原型真源存在性（活任务 + 归档任务的 design/ 都算——有原型 = 门生效的前提）
PROTOTYPES="$(find "$TASKFLOW_DIR" "$TASKFLOW_DIR/archive" -path '*/design/*.html' -type f 2>/dev/null || true)"
if [ -z "$PROTOTYPES" ]; then
  warn "项目无原型 HTML（${TASKFLOW_DIR}/*/design/）→ 门降级通过（无原型=无从提取）"
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

# 规格表 JSON 有效性：存在（repo 根/主仓库根/绝对路径三处解析）+ schema 头
valid_spec_json() {
  local p="$1"
  local f=""
  if [ -f "$ROOT/$p" ]; then f="$ROOT/$p"
  elif [ -f "$MAIN_ROOT/$p" ]; then f="$MAIN_ROOT/$p"
  elif [ -f "$p" ]; then f="$p"
  else return 1; fi
  grep -q '"schema"[[:space:]]*:[[:space:]]*"design-spec-extract/' "$f"
}

# ---- 模式二：spec 完备性（merge 阶段调用）----
if [ -n "$SPEC_ARG" ]; then
  [ -f "$SPEC_ARG" ] || fail "spec 不存在：${SPEC_ARG}"
  # 产物链节：原型行已拍板 → 必须挂规格表（无产物链节/未拍板 = PROTOTYPE_STALE 门管辖，本门不管）
  CHAIN="$(sed -n '/^## .*产物链/,/^## /p' "$SPEC_ARG")"
  if [ -z "$CHAIN" ] || ! printf '%s\n' "$CHAIN" | grep -E '^\|.*原型' | grep -q '已拍板'; then
    echo "✓ [spec-gate] spec 无已拍板原型（产物链缺失或未拍板）——本门不适用（PROTOTYPE_STALE 门管辖）"
    exit 0
  fi
  JSON_PATH="$(grep -oE "[^ ${BT}]+spec-extract[^ ${BT}]*\.json" "$SPEC_ARG" | head -1 || true)"
  if [ -z "$JSON_PATH" ]; then
    fail "spec 产物链「原型」已拍板，但全 spec 无 spec-extract*.json 挂链 → 跑 assets/design/extract-spec.js 提取（硬规则 19：结构+样式固化），路径写进产物链「原型规格表」行"
  fi
  valid_spec_json "$JSON_PATH" || fail "spec 挂链的规格表无效：${JSON_PATH}（不存在或缺 \"schema\": \"design-spec-extract/1\" 头——重新提取）"
  echo "✓ [spec-gate] spec 完备性通过（已拍板原型 ↔ ${JSON_PATH}）"
  exit 0
fi

# ---- 模式一：CHANGELOG 静态校验 ----
CHANGELOG="$ROOT/docs/CHANGELOG.md"
[ -f "$CHANGELOG" ] || fail "缺 docs/CHANGELOG.md（应由 mech install 建档；缺失=门未启用，跑 node tf.mjs mech install DESIGN_SPEC_EXTRACT）"

ANCHOR_LINE="$(grep -n "^## .*$GATE_ANCHOR" "$CHANGELOG" | tail -1 | cut -d: -f1)" || true
[ -n "$ANCHOR_LINE" ] || { warn "CHANGELOG 无锚点条目「${GATE_ANCHOR}」→ 门尚未启用（历史全豁免）"; exit 0; }
[ "$ANCHOR_LINE" -gt 1 ] || { echo "✓ [spec-gate] 锚点之上无条目（bootstrap 通过）"; exit 0; }

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
  spec_line="$(printf '%s\n' "$block" | tail -n +2 | grep -E '规格表\*{0,2}\s*[:：]' | head -1 || true)"
  if [ -z "$spec_line" ]; then
    echo "⛔ [spec-gate] $title — 涉及前端视觉资产但缺「规格表：」行 → 指向 spec-extract*.json 或「规格表：不适用——<理由>」" >&2
    exit 1
  fi
  # 廉价合法通道：不适用 + 理由（防静默绕闸：理由必填）
  if printf '%s' "$spec_line" | grep -qE '规格表\*{0,2}\s*[:：].{0,40}不适用.*(——|—).+' \
     || printf '%s' "$spec_line" | grep -qE '规格表\*{0,2}\s*[:：]\s*(无原型|不适用)(——|—).+'; then
    continue
  fi
  json_path="$(printf '%s' "$spec_line" | grep -oE "${BT}[^${BT}]+\.json${BT}" | tr -d "$BT" | head -1 || true)"
  [ -n "$json_path" ] || json_path="$(printf '%s' "$spec_line" | grep -oE '[^ 　]+\.json' | head -1 || true)"
  if [ -z "$json_path" ] || ! valid_spec_json "$json_path"; then
    echo "⛔ [spec-gate] $title — 「规格表：」行指向的 JSON 无效（${json_path}：不存在或缺 \"schema\": \"design-spec-extract/1\" 头）→ 用 assets/design/extract-spec.js 重新提取" >&2
    exit 1
  fi
done
echo "✓ [spec-gate] CHANGELOG 受管区全部合规（原型规格表门）"
