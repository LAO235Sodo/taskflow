#!/usr/bin/env bash
# validate-data-model-gate.sh — 数据模型对照门（taskflow 硬规则 28 / 机制 DATA_MODEL_GATE 的机械执行体）
# 由 `node tf.mjs mech install DATA_MODEL_GATE` 生成（模板住技能仓库 assets/harness/——勿手改，重装覆盖）。
# 防的事故类：数据口径返工只靠事后 decisions/ 沉淀（七星第 7 位第 7 轮才落档；本仓 agent_workflow_run 一族
# DDL 双源漂移实证），设计侧既无产物步骤也无拍板门。本脚本把「动没动数据模型」从 agent 记性变成机械检查：
# 全任务分诊留痕（spec 一行）+ 涉者对照表拍板 + 收尾同步行（含 DDL 多源处置 + 真源刷新）。
# 双模式：
#   默认                          CHANGELOG 静态校验：锚点之上条目，凡反引号资产命中数据资产
#                                    （.sql / db migration 目录 / entity·po·model·domain·data 目录下代码文件【路径层】，
#                                     或文件内容含 @TableName/@Entity/@Table/CREATE TABLE/ALTER TABLE【内容层，抓
#                                     data/ 目录与服务内联 DDL 等路径漏网者】）→ 该条目须含「数据模型：」行：
#                                    · 数据模型：不适用——<理由>（廉价合法通道，防静默绕闸）
#                                    · 数据模型：<spec 对照表/提取 JSON 路径>；同步：<≥1 项同步动作>；真源：已刷新
#                                      （.json 挂链文件存在且含 "schema": "data-model-extract/ 头；真源行触发
#                                       docs/data-model/data-model-extract.json 存在性+schema 头复核）
#                                    · 涉 .sql 或内容层 CREATE/ALTER 命中 → 行内须再含 DDL：<其余定义处处置+迁移> 非空
#   --spec <spec.md>              merge 阶段三完备性（DATA_MODEL_GATE，涉数据资产任务）：
#                                    · 分诊行全员强制：spec 必含「数据模型分诊：涉及|不涉及——<理由>」行，缺=红
#                                    · 分诊涉及 / spec 反引号路径命中谓词 / spec 含已填对照表行 → 必有
#                                      「## 数据模型对照表」节，且每数据行现状列含证据锚（`路径` 或 文件:行号——锚指源码）、
#                                      拍板列非空（「豁免——<理由>」合法）
#                                    · 分诊不涉且无数据资产命中 = 过
# 降级通过：无 .taskflow（CI fresh checkout）/ CHANGELOG 无锚点（门未启用，历史祖父豁免）。
# 已知边界（v1，棘轮位）：「现状列是否列全 duplicates 全部源」由 merge 编排层对照提取器 .md「重复定义表」节
# 语义核对，本门不做 JSON 交叉；mismatch 处置注记核对同归 merge 编排层——攒第二次实证再机械化。
# 退出码：0 通过/降级；1 违规。兼容 macOS bash 3.2（无 mapfile/关联数组；NUL 分块读取；${var} 大括号纪律——
# bash3.2 UTF-8 下 $var（ 紧贴多字节字符会被并进变量名，2026-11-01 基线门三红实证）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
REPO="$ROOT"

COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
TASKFLOW_DIR=".taskflow"
MAIN_ROOT="$ROOT"
if [ -n "$COMMON_DIR" ]; then TASKFLOW_DIR="$(dirname "$COMMON_DIR")/.taskflow"; MAIN_ROOT="$(dirname "$COMMON_DIR")"; fi

GATE_ANCHOR="数据模型门落地"
BT='`'
# 数据资产判定·路径层：.sql 文件 / 迁移目录 / 常规实体目录下的代码文件（data/ 这类非 entity 命名目录由内容层兜住）
DATA_RE='\.sql$|(^|/)(db/migration|flyway|liquibase)/|(^|/)(entity|entities|po|pojo|model|domain|data)/[^/]*\.(java|kt|ts|js)$'
# 内容层：注解实体 / 内联 DDL（文档与不存在文件只走路径层——文档描述 DDL 不算改模型）
CONTENT_ENTITY_RE='@(TableName|Entity)\(|@Table\('
CONTENT_DDL_RE='CREATE TABLE |ALTER TABLE '

fail() { echo "⛔ [data-model-gate] $*" >&2; exit 1; }
warn() { echo "⚠ [data-model-gate] $*" >&2; }

if [ ! -d "$TASKFLOW_DIR" ]; then
  warn "$TASKFLOW_DIR 不存在（CI fresh checkout / 非 taskflow 项目）→ 门降级通过"
  exit 0
fi

# ---- 参数解析 ----
SPEC_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) SPEC_ARG="${2:?--spec 需要路径}"; shift 2 ;;
    --repo) REPO="$(cd "${2:?--repo 需要路径}" && pwd)"; shift 2 ;;
    *) fail "未知参数 ${1}（用法见脚本头注释）" ;;
  esac
done

resolve_file() { # $1=路径 → 存在则 echo 绝对路径，否则空
  local p="$1"
  if [ -f "$REPO/$p" ]; then echo "$REPO/$p"
  elif [ -f "$ROOT/$p" ]; then echo "$ROOT/$p"
  elif [ -f "$MAIN_ROOT/$p" ]; then echo "$MAIN_ROOT/$p"
  elif [ -f "$p" ]; then echo "$p"
  else echo ""; fi
}
valid_extract_json() { grep -qE '"schema"[[:space:]]*:[[:space:]]*"data-model-extract/' "$1"; }
# ---- 模式二：--spec 完备性（merge 阶段三调用）----
if [ -n "$SPEC_ARG" ]; then
  [ -f "$SPEC_ARG" ] || fail "spec 不存在：${SPEC_ARG}"
  # ① 分诊行全员强制（这就是「每个任务先过数据模型这一关」的机械面）
  TRIAGE="$(grep -E '数据模型分诊[：:][[:space:]]*(涉及|不涉及)[[:space:]]*(——|—)' "$SPEC_ARG" | head -1 || true)"
  if [ -z "$TRIAGE" ]; then
    fail "spec 缺「数据模型分诊：涉及|不涉及——<理由>」行（全员必答——动不动数据模型，判定留痕；分诊漏判由收尾谓词兜底）"
  fi
  # ② 涉及判定：分诊涉及 / spec 反引号路径命中谓词 / 已填对照表行
  INVOLVED=0
  echo "$TRIAGE" | grep -q '不涉及' || INVOLVED=1
  if [ "$INVOLVED" -eq 0 ]; then
    for tok in $(grep -oE "${BT}[^${BT}]+${BT}" "$SPEC_ARG" | tr -d "$BT"); do
      if echo "$tok" | grep -qE "$DATA_RE"; then
        warn "分诊写「不涉及」但 spec 反引号路径命中数据资产：${tok}——以收尾谓词为准（双保险），对照表必须补"
        INVOLVED=1; break
      fi
      f="$(resolve_file "$tok")"
      if [ -n "$f" ] && echo "$tok" | grep -qE '\.(java|kt|ts|js|py|go|rs)$' && grep -qE "$CONTENT_ENTITY_RE|$CONTENT_DDL_RE" "$f" 2>/dev/null; then
        warn "分诊写「不涉及」但 spec 反引号路径内容层命中（实体注解/内联 DDL）：${tok}——以收尾谓词为准，对照表必须补"
        INVOLVED=1; break
      fi
    done
  fi
  # 已填对照表行也触发（分诊漏判兜底之二）
  if [ "$INVOLVED" -eq 0 ] && grep -E '^data-model-extract|^## .*数据模型对照表' "$SPEC_ARG" >/dev/null 2>&1; then :; fi
  if [ "$INVOLVED" -eq 0 ]; then
    SEC="$(awk '/^##[ \t]/{h=$0;cur=(h ~ /数据模型对照表/)?1:0;next} cur{print}' "$SPEC_ARG")"
    if printf '%s' "$SEC" | grep -E '^\|' | grep -qvE '^\|[ :|-]*$|表或实体|<'; then INVOLVED=1; fi
  fi
  if [ "$INVOLVED" -eq 0 ]; then
    echo "✓ [data-model-gate] spec 分诊不涉及且无数据资产命中——本门不适用（一行理由在 spec）"
    exit 0
  fi
  # ③ 对照表节 + 行级检查（现状列证据锚指源码；拍板列非空）
  if ! grep -qE '^## .*数据模型对照表' "$SPEC_ARG"; then
    fail "涉数据模型但 spec 无「## 数据模型对照表」节——跑 scripts/design/extract-data-model.js 刷新真源（docs/data-model/），现状列只认提取产物+源码锚（禁凭记忆转述，硬规则 28②）"
  fi
  ROWS="$(awk '/^##[ \t]/{h=$0;cur=(h ~ /数据模型对照表/)?1:0;next} cur && /^\|/ {print}' "$SPEC_ARG" | grep -vE '^\|[ :|-]*$' | grep -v '表或实体' || true)"
  [ -n "$ROWS" ] || fail "「数据模型对照表」节无数据行（涉及=至少一行现状对照；模板占位行不算）"
  N=0
  while IFS= read -r row; do
    echo "$row" | grep -q '<' && continue # 模板占位行
    N=$((N+1))
    CUR="$(printf '%s' "$row" | awk -F'|' '{v=$4; gsub(/^[ \t]+|[ \t]+$/, "", v); print v}')"
    DEC="$(printf '%s' "$row" | awk -F'|' '{v=$(NF-1); gsub(/^[ \t]+|[ \t]+$/, "", v); print v}')"
    if [ -z "$CUR" ]; then
      fail "对照表第 ${N} 行现状列为空——现状只认提取器产物 + 源码锚（\`文件:行号\`，多源表列全 duplicates 全部定义处）"
    fi
    if ! printf '%s' "$CUR" | grep -qE "${BT}[^${BT}]+${BT}|[A-Za-z0-9_/.-]+\.[A-Za-z0-9]+:[0-9]+"; then
      fail "对照表第 ${N} 行现状列缺证据锚（\`路径\` 或 文件:行号——锚指源码，真源 JSON 仅作盘点索引）"
    fi
    if [ -z "$DEC" ]; then
      fail "对照表第 ${N} 行拍板列为空——拍板未填禁动工（PROTOTYPE_STALE 同款双设：new-task 第 11 步 + merge 阶段三）"
    fi
  done <<< "$ROWS"
  echo "✓ [data-model-gate] spec 完备性通过（分诊在链，对照表 ${N} 行均有证据锚+拍板）"
  exit 0
fi

# ---- 模式一：CHANGELOG 静态校验 ----
CHANGELOG="$ROOT/docs/CHANGELOG.md"
[ -f "$CHANGELOG" ] || fail "缺 docs/CHANGELOG.md（应由 mech install 建档；缺失=门未启用，跑 node tf.mjs mech install DATA_MODEL_GATE）"

ANCHOR_LINE="$(grep -n "^## .*$GATE_ANCHOR" "$CHANGELOG" | head -1 | cut -d: -f1)" || true # head -1=最新锚点（锚点迁移史下 tail -1 受管区过扩，validate-changelog.sh 三度事故同款防御）
[ -n "$ANCHOR_LINE" ] || { warn "CHANGELOG 无锚点条目「${GATE_ANCHOR}」→ 门尚未启用（历史全豁免）"; exit 0; }
[ "$ANCHOR_LINE" -gt 1 ] || { echo "✓ [data-model-gate] 锚点之上无条目（bootstrap 通过）"; exit 0; }

# 受管区按 ^## 切块（awk 聚合后以 NUL 分隔输出，bash read -d '' 整块读取——逐行 read 会拆散块，先例基线门 B1 实证）
head -n $((ANCHOR_LINE - 1)) "$CHANGELOG" | awk '
  /^## / { if (buf != "") { printf "%s%c", buf, 0; buf = "" } }
  { buf = buf $0 "\n" }
  END { if (buf != "") printf "%s%c", buf, 0 }
' | while IFS= read -r -d '' block; do
  title="$(printf '%s\n' "$block" | grep -m1 '^## ' || true)"
  [ -n "$title" ] || continue
  body="$(printf '%s\n' "$block" | tail -n +2)"
  tokens="$(printf '%s\n' "$body" | grep -oE "${BT}[^${BT}]+${BT}" | tr -d "$BT" || true)"
  [ -n "$tokens" ] || continue
  HIT=0; DDL_HIT=0
  for tok in $tokens; do
    if echo "$tok" | grep -qE "$DATA_RE"; then HIT=1; fi
    echo "$tok" | grep -qE '\.sql$' && DDL_HIT=1
    f="$(resolve_file "$tok")"
    if [ -n "$f" ] && echo "$tok" | grep -qE '\.(java|kt|ts|js|py|go|rs)$'; then
      if grep -qE "$CONTENT_ENTITY_RE" "$f" 2>/dev/null; then HIT=1; fi
      if grep -qE "$CONTENT_DDL_RE" "$f" 2>/dev/null; then HIT=1; DDL_HIT=1; fi
    fi
  done
  [ "$HIT" -eq 1 ] || continue
  dm_line="$(printf '%s\n' "$body" | grep -E '数据模型\*{0,2}[[:space:]]*[:：]' | head -1 || true)"
  if [ -z "$dm_line" ]; then
    echo "⛔ [data-model-gate] $title — 涉及数据资产（实体/DDL）但缺「数据模型：」行 → 跑 scripts/design/extract-data-model.js 刷新真源后写「数据模型：<对照表/JSON 路径>；同步：<迁移/契约/消费方/DDL 其余定义处>；真源：已刷新」或「数据模型：不适用——<理由>」" >&2
    exit 1
  fi
  # 廉价合法通道：不适用 + 理由（防静默绕闸：理由必填）
  if printf '%s' "$dm_line" | grep -qE '数据模型\*{0,2}[[:space:]]*[:：].{0,40}不适用.*(——|—).+'; then
    continue
  fi
  # 挂链：行内 .json 路径须存在且 schema 头合法；.md 路径须存在
  json_path="$(printf '%s' "$dm_line" | grep -oE "[^ ${BT}]+\.json" | head -1 || true)"
  if [ -n "$json_path" ]; then
    jf="$(resolve_file "$json_path")"
    if [ -z "$jf" ] || ! valid_extract_json "$jf"; then
      echo "⛔ [data-model-gate] $title — 「数据模型：」行挂链 JSON 无效（${json_path}：不存在或缺 \"schema\": \"data-model-extract/ 头）→ 重跑 scripts/design/extract-data-model.js" >&2
      exit 1
    fi
  else
    md_path="$(printf '%s' "$dm_line" | grep -oE "[^ ${BT}]+\.md" | head -1 || true)"
    if [ -n "$md_path" ] && [ -z "$(resolve_file "$md_path")" ]; then
      echo "⛔ [data-model-gate] $title — 「数据模型：」行挂链的 spec 路径不存在：${md_path}" >&2
      exit 1
    fi
    if [ -z "$md_path" ]; then
      echo "⛔ [data-model-gate] $title — 「数据模型：」行须挂链提取 JSON 或 spec 对照表路径" >&2
      exit 1
    fi
  fi
  # 同步：非空（迁移/契约/消费方/DDL 其余定义处 ≥1 项）
  seg_after() { local m="$1"; printf '%s' "$dm_line" | grep -q "${m}[：:]" || { echo ''; return; }; printf '%s' "$dm_line" | sed -E "s/^.*${m}[：:]//" | sed -E 's/[;；].*$//' | tr -d '[:space:]'; }
  if [ -z "$(seg_after 同步)" ]; then
    echo "⛔ [data-model-gate] $title — 「数据模型：」行缺「同步：<≥1 项同步动作>」（迁移脚本/契约更新/消费方同步/DDL 其余定义处处置——列不出来说明没同步）" >&2
    exit 1
  fi
  # 真源：已刷新 → docs/data-model/data-model-extract.json 存在且 schema 头合法
  if printf '%s' "$dm_line" | grep -q '真源：已刷新\|真源:已刷新'; then
    src="$(resolve_file "docs/data-model/data-model-extract.json")"
    if [ -z "$src" ] || ! valid_extract_json "$src"; then
      echo "⛔ [data-model-gate] $title — 声称「真源：已刷新」但 docs/data-model/data-model-extract.json 缺失或缺 schema 头 → 重跑 scripts/design/extract-data-model.js --root <扫描根> --out docs/data-model" >&2
      exit 1
    fi
  else
    echo "⛔ [data-model-gate] $title — 「数据模型：」行缺「真源：已刷新」（DDL/实体变更收尾必须刷新 docs/data-model/ 真源——lock-file，只能提取器再生）" >&2
    exit 1
  fi
  # DDL 追加段：涉 .sql 或内容层 CREATE/ALTER → 行内须交代其余定义处处置 + 迁移
  if [ "$DDL_HIT" -eq 1 ]; then
    if [ -z "$(seg_after DDL)" ]; then
      echo "⛔ [data-model-gate] $title — 涉 DDL（.sql/内联 CREATE·ALTER）但「数据模型：」行缺「DDL：<其余定义处处置+迁移>」子段（同表多源清单见提取器 duplicates——其余定义处逐处交代）" >&2
      exit 1
    fi
  fi
done
echo "✓ [data-model-gate] CHANGELOG 受管区全部合规（数据模型门）"
