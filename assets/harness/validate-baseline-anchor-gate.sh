#!/usr/bin/env bash
# validate-baseline-anchor-gate.sh — 需求基线对照门（taskflow 硬规则 27 / REQ_ANCHOR_GATE 的机械执行体）
# 由 `node tf.mjs mech install REQ_ANCHOR_GATE` 生成（模板住技能仓库 assets/harness/，assetExts 不适用本门——勿手改，重装覆盖）。
# 双模式：
#   默认                              CHANGELOG 静态校验（validate-changelog.sh 收尾串接，纯静态不依赖 git）：
#                                     C1「文档同步：」行列出的 PRD 条目 ID 必须真实存在；触及 docs/prd/** 的条目其「文档同步」行禁写「不适用」
#                                     C2「文档同步：」行引用 PRD 路径但全行无条目 ID = 红（格式强制：落到条目粒度）
#   --spec <spec.md> [--base <ref>]   merge 阶段一五检查（红=阻塞项，回 merge.md 第 3 步唯一修复循环）：
#                                     B1 锚存在性：验收标准节每条 - [ ] 行须有「基线：<条目ID>」尾缀（或「基线外：D-n」指向草案表行，
#                                        或豁免留痕行「基线：豁免——一句话理由」——对齐 I12 口径：新增需求类行为禁豁免）；锚 ID 查无 PRD 条目 = 红
#                                     B2 非法锚形态：「见方案稿/原型/见上/待补」不是合法锚（堵「引用方案稿当锚」绕过）
#                                     B3 草案升格：「基线外条目草案」表每行的预填 PRD 条目 ID 必须出现在分支 diff 新增行，或该行写「豁免+拍板」留痕
#                                     B4 PRD 反向留痕：分支 diff 触及的 PRD 条目，必须出现在 spec 锚 ∪ 草案去向 ∪ 文档同步行 ∪ task.json(reqChanges/note) 四者之一
#                                     B5 goalHash 一致：spec 承重节（目标+验收标准）现算 hash == task.json.goalHash（I11 同算法：[x] 归一/trim/去空行/sha1 前 12 位）
# diff base：优先 task.json.baseCommit（v2.59.0 任务基线锚——diff=本任务自身改动）；无则 --base；再缺省 origin/main。
# 延迟激活（对齐 DOC_SYNC_GATE / STYLE_SOURCE_GATE 先例）：项目无 PRD 根（docs/prd/，conventions.md「统一源」节可单点改址）
# 或 CHANGELOG 无锚点条目「基线对照门落地」→ 全部豁免仅 WARN 放行（存量项目升级零破坏；插锚点=显式接受强制）。
# 退出码：0 通过/降级；1 违规。兼容 macOS bash 3.2（无 mapfile/关联数组）。
# 已知边界（What the gate CANNOT catch，硬规则 27 防自欺声明）：锚的语义正确性（脚本只证「链在」，「链对不对」归 merge 阶段一
# 编排层语义核对）；PRD 条目自身写错（追溯走需求变更门）；不经 spec 的行为改动（MERGE_GATE 越界门+DOC_SYNC 收尾行覆盖）。
# B4 的 CHANGELOG 留痕证据取锚点「基线对照门落地」之上受管区（对齐组合门口径）；触及 PRD 的条目无「文档同步」行不归本门红
# （该面归 DOC_SYNC_GATE 的功能代码触发判定，本门只查「写了行但内容矛盾/粒度不够」）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ID_RE='[FU]S?-[A-Z]{2,8}-[0-9]+'
GATE_ANCHOR='基线对照门落地'
CHANGELOG="docs/CHANGELOG.md"

fail() { echo "⛔ [baseline-gate] $*" >&2; exit 1; }
warn() { echo "⚠ [baseline-gate] $*" >&2; }
sha1_12() { if command -v sha1sum >/dev/null 2>&1; then sha1sum | cut -c1-12; else shasum | cut -c1-12; fi; }

# ---- PRD 根定位：conventions.md「统一源」节单点声明（DOC_SYNC 读侧既有登记），缺省 docs/prd ----
PRD_DIR="docs/prd"
CONV=".taskflow/conventions.md"
if [ -f "$CONV" ]; then
  FOUND="$(sed -n '/统一源/,/^## /p' "$CONV" | grep -oE '[^ `|]*prd[^ `|]*' | head -1 || true)"
  [ -n "$FOUND" ] && PRD_DIR="${FOUND%/}"
fi

# ---- 延迟激活闸（两模式共用）----
if [ ! -d "$PRD_DIR" ]; then
  warn "项目无 ${PRD_DIR}/（conventions「统一源」未登记 PRD 根）→ 需求基线对照门未激活，仅 WARN 放行"
  exit 0
fi
if [ ! -f "$CHANGELOG" ] || ! grep -q "^## .*${GATE_ANCHOR}" "$CHANGELOG"; then
  warn "CHANGELOG 无锚点条目「${GATE_ANCHOR}」→ 需求基线对照门未激活，仅 WARN 放行（顶部插入锚点条目=显式接受强制）"
  exit 0
fi
ANCHOR_LINE="$(grep -n "^## .*${GATE_ANCHOR}" "$CHANGELOG" | tail -1 | cut -d: -f1)"

# PRD 条目标题 ID 全集（^#{2,4} + 条目 ID 开头才认——正文引用不算条目存在）
PRD_IDS_FILE="$(mktemp)"
AC_LINES_FILE="$(mktemp)"
trap 'rm -f "$PRD_IDS_FILE" "$AC_LINES_FILE"' EXIT
grep -rhoE "^#{2,4}[ \t]+${ID_RE}" "$PRD_DIR" 2>/dev/null | grep -oE "${ID_RE}" | sort -u > "$PRD_IDS_FILE" || true
prd_has_id() { grep -qx "$1" "$PRD_IDS_FILE"; }

# ---- 参数解析 ----
SPEC_ARG=""
BASE_FLAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) SPEC_ARG="${2:?--spec 需要路径}"; shift 2 ;;
    --base) BASE_FLAG="${2:?--base 需要 ref}"; shift 2 ;;
    *) fail "未知参数 $1" ;;
  esac
done

VIOL=0
red() { echo "⛔ [baseline-gate] $*" >&2; VIOL=$((VIOL+1)); }

if [ -z "$SPEC_ARG" ]; then
  # ---- 模式一：CHANGELOG 收尾校验（C1/C2）——受管区按 ^## 切块（整块读，先例：组合门 NUL 分隔）----
  head -n $((ANCHOR_LINE - 1)) "$CHANGELOG" | awk '
    /^## / { if (buf != "") { printf "%s%c", buf, 0; buf = "" } }
    { buf = buf $0 "\n" }
    END { if (buf != "") printf "%s%c", buf, 0 }
  ' | while IFS= read -r -d '' block; do
    title="$(printf '%s\n' "$block" | grep -m1 '^## ' || true)"
    [ -n "$title" ] || continue
    body="$(printf '%s\n' "$block" | tail -n +2)"
    doc_line="$(printf '%s\n' "$body" | grep -m1 '文档同步[：:]' || true)"
    [ -n "$doc_line" ] || continue
    c_ids="$(printf '%s\n' "$doc_line" | grep -oE "${ID_RE}" | sort -u || true)"
    for id in $c_ids; do
      if ! prd_has_id "$id"; then
        echo "⛔ [baseline-gate] $title — 「文档同步：」行列出的条目 ID 查无 PRD 条目：$id（C1——条目 ID 必须真实存在）" >&2
        exit 1
      fi
    done
    # C1 附属：触及 docs/prd/** 的条目禁写「不适用」（PRD 被改却宣称文档零变更=自相矛盾）
    if printf '%s\n' "$body" | grep -qF "$PRD_DIR" && printf '%s\n' "$doc_line" | grep -q '不适用'; then
      echo "⛔ [baseline-gate] $title — 触及 ${PRD_DIR}/** 的条目「文档同步」行禁写「不适用」（C1）——列明更新的条目 ID" >&2
      exit 1
    fi
    # C2：引用 PRD 路径却无条目 ID = 格式不达标（须落到条目粒度）
    if printf '%s\n' "$doc_line" | grep -qF "$PRD_DIR" && [ -z "$c_ids" ]; then
      echo "⛔ [baseline-gate] $title — 「文档同步：」行引用 PRD 路径但无条目 ID（C2）——须落到条目粒度（如 F-XX-NN）" >&2
      exit 1
    fi
  done
  echo "✓ [baseline-gate] CHANGELOG 受管区条目 ID 留痕合规"
  exit 0
fi

# ---- 模式二：--spec 五检查 ----
[ -f "$SPEC_ARG" ] || fail "spec 不存在：$SPEC_ARG"
SPEC_ARG="$(cd "$(dirname "$SPEC_ARG")" && pwd)/$(basename "$SPEC_ARG")"
TASKDIR="$(dirname "$SPEC_ARG")"
TASKJSON="$TASKDIR/task.json"

# diff base 解析：task.json.baseCommit 优先（任务基线锚）→ --base → origin/main
BASE=""
if [ -f "$TASKJSON" ]; then
  BC="$(grep -oE '"baseCommit"[[:space:]]*:[[:space:]]*"[^"]+"' "$TASKJSON" | sed -E 's/.*"([^"]+)"$/\1/' | tail -1 || true)"
  if [ -n "$BC" ] && git rev-parse --verify -q "$BC" >/dev/null 2>&1; then BASE="$BC"; fi
fi
if [ -z "$BASE" ]; then
  BASE="${BASE_FLAG:-origin/main}"
  git rev-parse --verify -q "$BASE" >/dev/null 2>&1 || fail "base ref 不存在：${BASE}（配错 base=零输入假绿，禁放行）"
fi

DIFF_PATCH="$(git diff "${BASE}...HEAD" 2>/dev/null || git diff "${BASE}..HEAD" 2>/dev/null || true)"
PRD_PATCH="$(git diff "${BASE}...HEAD" -- "$PRD_DIR" 2>/dev/null || git diff "${BASE}..HEAD" -- "$PRD_DIR" 2>/dev/null || true)"

# ---- B3 前置：解析「基线外条目草案」表（D-n → 预填去向）----
DRAFT_SECTION="$(awk '
  /^##[ \t]/ {
    h = $0; sub(/^##[ \t]+/, "", h); sub(/[ \t]+$/, "", h)
    cur = (h == "基线外条目草案") ? 1 : 0
    next
  }
  cur { print }
' "$SPEC_ARG")"
DRAFT_IDS=" "
DRAFT_TARGETS=" "
while IFS= read -r row; do
  [ -n "$row" ] || continue
  printf '%s' "$row" | grep -qE '^\|' || continue
  printf '%s' "$row" | grep -qE '^\|[ :|-]*$' && continue
  printf '%s' "$row" | grep -q '草案 ID' && continue
  printf '%s' "$row" | grep -q '<D-' && continue
  d_id="$(printf '%s' "$row" | awk -F'|' '{ v=$2; gsub(/^[ \t]+|[ \t]+$/, "", v); print v }')"
  d_target="$(printf '%s' "$row" | awk -F'|' '{ v=$(NF-1); gsub(/^[ \t]+|[ \t]+$/, "", v); print v }')"
  case "$d_id" in
    D-[0-9]*) ;;
    *) red "草案行 ID 非法（须 D-n）：$row"; continue ;;
  esac
  DRAFT_IDS="$DRAFT_IDS$d_id "
  # 豁免通道：行写「豁免+拍板」留痕（对齐拍板豁免口径——缺任一字样不豁免）
  if printf '%s' "$row" | grep -q '豁免' && printf '%s' "$row" | grep -q '拍板'; then
    continue
  fi
  t_id="$(printf '%s' "$d_target" | grep -oE "${ID_RE}" | head -1 || true)"
  if [ -z "$t_id" ]; then
    red "草案 $d_id 无预填 PRD 去向（B3）——须预填目标条目 ID（该域下一个空号）或行写「豁免——拍板留痕」"
    continue
  fi
  DRAFT_TARGETS="$DRAFT_TARGETS$t_id "
  # 升格判定：预填 ID 出现在分支 diff 新增行（登记时预填空号，升格检查因此完全机械）
  if printf '%s\n' "$DIFF_PATCH" | grep '^+' | grep -qF "$t_id"; then
    :
  else
    red "草案 $d_id 未升格（B3）——分支 diff 新增行无预填条目 $t_id（补 PRD 正式条目含出处 iter-comment，或用户拍板豁免留痕）"
  fi
done <<< "$DRAFT_SECTION"

# ---- B1/B2：验收标准节逐行查锚 ----
awk '
  /^##[ \t]/ {
    h = $0; sub(/^##[ \t]+/, "", h); sub(/[ \t]+$/, "", h)
    cur = (h == "验收标准" || h == "验收") ? 1 : 0
    next
  }
  cur && /^- \[[xX ]\]/ { print }
' "$SPEC_ARG" > "$AC_LINES_FILE"
AC_N=0
ANCHORED_IDS=" "
while IFS= read -r line; do
  [ -n "$line" ] || continue
  AC_N=$((AC_N+1))
  if printf '%s' "$line" | grep -qE '^- \[[xX ]\] <'; then continue; fi  # 模板占位行（未填的 <标准 N>）不检
  if printf '%s' "$line" | grep -q '基线[：:]'; then
    anchor_tail="$(printf '%s' "$line" | sed 's/^.*基线[：:]//')"
    ids="$(printf '%s' "$anchor_tail" | grep -oE "${ID_RE}" | sort -u || true)"
    if [ -n "$ids" ]; then
      for id in $ids; do
        ANCHORED_IDS="$ANCHORED_IDS$id "
        if ! prd_has_id "$id"; then
          red "锚 ID 查无 PRD 条目（B1）：$id——行：$line"
        fi
      done
    elif printf '%s' "$anchor_tail" | grep -q '豁免'; then
      reason="$(printf '%s' "$anchor_tail" | sed 's/^.*豁免//')"
      while [ -n "$reason" ] && { [ "${reason#—}" != "$reason" ] || [ "${reason#-}" != "$reason" ]; }; do
        reason="${reason#—}"
        reason="${reason#-}"
      done
      if [ "${#reason}" -lt 6 ]; then
        red "豁免行理由过短（须一句话理由留痕，≥6 字符）：$line"
      fi
    elif printf '%s' "$anchor_tail" | grep -qE '方案稿|原型|见上|待补'; then
      red "非法锚形态（B2）——「见方案稿/原型/见上/待补」不是合法锚，须 PRD 条目 ID：$line"
    else
      red "基线：尾缀既非条目 ID 也非豁免留痕（B1）：$line"
    fi
  elif printf '%s' "$line" | grep -q '基线外[：:]'; then
    d_ref="$(printf '%s' "$line" | grep -oE 'D-[0-9]+' | head -1 || true)"
    if [ -z "$d_ref" ]; then
      red "基线外锚缺草案 ID（须 D-n 指向「基线外条目草案」表行）：$line"
    else
      case " $DRAFT_IDS " in
        *" $d_ref "*) ;;
        *) red "基线外锚 $d_ref 在「基线外条目草案」表无对应行（草案须先登记并经用户确认）：$line" ;;
      esac
    fi
  else
    red "无锚验收行（B1）——每条验收须挂 PRD 条目锚（基线：F-XX-NN）；挂不上=PRD 静默区，登记「基线外条目草案」并经用户确认：$line"
  fi
done < "$AC_LINES_FILE"

# ---- B4：PRD 反向留痕（diff 触及的条目 ID 须有四路留痕之一）----
TOUCHED="$(printf '%s\n' "$PRD_PATCH" | awk '
  {
    if (match($0, /^[ +]#{2,4}[ \t]+[FU]S?-[A-Z]{2,8}-[0-9]+/)) {
      h = substr($0, RSTART, RLENGTH)
      sub(/^[ +]#{2,4}[ \t]+/, "", h)
      cur = h
    }
    if (substr($0, 1, 1) == "+" && length($0) > 1 && cur != "") print cur
  }
' | sort -u || true)"
if [ -n "$TOUCHED" ]; then
  DOC_LINES="$(head -n $((ANCHOR_LINE - 1)) "$CHANGELOG" | grep -E '文档同步[：:]' || true)"
  TASKTEXT=""
  [ -f "$TASKJSON" ] && TASKTEXT="$(cat "$TASKJSON")"
  EVIDENCE="$ANCHORED_IDS $DRAFT_TARGETS"
  for id in $TOUCHED; do
    hit=""
    case " $EVIDENCE " in
      *" $id "*) hit="spec锚/草案去向" ;;
    esac
    if [ -z "$hit" ] && printf '%s' "$DOC_LINES" | grep -qF "$id"; then hit="文档同步行"; fi
    if [ -z "$hit" ] && [ -n "$TASKTEXT" ] && printf '%s' "$TASKTEXT" | grep -qF "$id"; then hit="reqChanges/note"; fi
    if [ -z "$hit" ]; then
      red "PRD 反向留痕缺失（B4）——条目 $id 被分支改动，但 spec 锚/草案去向/文档同步行/reqChanges 四路皆无（PRD 被静默改写嫌疑）"
    fi
  done
fi

# ---- B5：goalHash 一致（I11 同算法：目标+验收标准，[x] 归一、trim、去空行，sha1 前 12 位）----
if [ -f "$TASKJSON" ] && grep -q '"goalHash"' "$TASKJSON"; then
  GH="$(grep -oE '"goalHash"[[:space:]]*:[[:space:]]*"[^"]+"' "$TASKJSON" | sed -E 's/.*"([^"]+)"$/\1/' | tail -1)"
  NORM="$(awk '
    /^##[ \t]/ {
      h = $0; sub(/^##[ \t]+/, "", h); sub(/[ \t]+$/, "", h)
      cur = (h == "目标" || h == "验收标准") ? 1 : 0
      next
    }
    cur {
      line = $0
      gsub(/\[(x|X| )\]/, "[ ]", line)
      sub(/^[ \t]+/, "", line)
      sub(/[ \t]+$/, "", line)
      if (line != "") print line
    }
  ' "$SPEC_ARG")"
  if [ -n "$NORM" ]; then
    NOW_HASH="$(printf '%s' "$NORM" | sha1_12)"
    if [ "$NOW_HASH" != "$GH" ]; then
      red "goalHash 不一致（B5）——spec 承重节被改未经需求变更门：现算 $NOW_HASH ≠ 档案 $GH（跑 tf.mjs req-confirm 补确认或回退 spec）"
    fi
  fi
fi

if [ "$VIOL" -gt 0 ]; then
  echo "⛔ [baseline-gate] 共 $VIOL 处违规（红=阻塞项，回 merge.md 第 3 步唯一修复循环；分流表见 references/merge.md）" >&2
  exit 1
fi
echo "✓ [baseline-gate] spec 五检查通过（验收项 $AC_N 条，base=${BASE:0:12}）"
exit 0
