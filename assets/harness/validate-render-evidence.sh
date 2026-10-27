#!/usr/bin/env bash
# validate-render-evidence.sh — 渲染证据哨兵（RENDER_EVIDENCE_GATE，2026-10-27 看板字体失调两次打回沉淀）
# 行为:任务 diff 触及前端样式载体(.vue 的 <style> 段变更/新增 @media/styles 目录)→ 强制要求
# .taskflow/<task-id>/attachments/ 存在渲染证据产物(截图 png/jpg/jpeg/webp,或 md/json 含「截图|量测|render」)。
# 缺=退出 1(阻塞)。无样式 diff=通过(N/A)。用途=把「UI 改动必须附真实渲染证据」从模型自判变机械判断。
# 用法:validate-render-evidence.sh [--task <id>] [--repo <path>] [--base <ref>]
#   --task 缺省=当前分支名(task/<id>)推导;--base 缺省=main。归档后重放按 --base 指定历史基线。
set -euo pipefail

fail() { echo "⛔ [render-evidence] $*" >&2; exit 1; }
pass() { echo "✓ [render-evidence] $*"; }

REPO=""
TASK=""
BASE="main"
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK="${2:?--task 需要任务 id}"; shift 2 ;;
    --repo) REPO="${2:?--repo 需要路径}"; shift 2 ;;
    --base) BASE="${2:?--base 需要 ref}"; shift 2 ;;
    *) fail "未知参数 $1" ;;
  esac
done
[ -n "$REPO" ] || REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

# 任务 id 推导:当前分支 task/<id> → <id>;非任务上下文(main 检出/无 --task)=N/A 放行
# (强制执行点=任务 worktree 内的合并审查运行;主仓库收尾链运行不阻塞)
if [ -z "$TASK" ]; then
  BR="$(git branch --show-current)"
  case "$BR" in
    task/*) TASK="${BR#task/}" ;;
    *) pass "N/A——非任务上下文(任务分支运行时强制)"; exit 0 ;;
  esac
fi

# 1) 样式载体命中检测(diff 内容级,非仅路径名——样式段内的增删行才算)
STYLE_HITS="$(git diff "$BASE"...HEAD -- '*.vue' 2>/dev/null | grep -cE '^[+-].*(<style|@media)' || true)"
STYLE_FILES="$(git diff --name-only "$BASE"...HEAD -- 'frontend/src/styles' 2>/dev/null | wc -l || true)"
TOTAL=$((STYLE_HITS + STYLE_FILES))
if [ "$TOTAL" -eq 0 ]; then
  pass "N/A——diff 无样式载体改动(基线 $BASE)"
  exit 0
fi

# 2) 渲染证据产物检测
ATT="$REPO/.taskflow/$TASK/attachments"
[ -d "$ATT" ] || fail "样式载体改动 $TOTAL 处命中(基线 $BASE)但任务档案无 attachments/ 渲染证据目录"
IMG_N="$(find "$ATT" -maxdepth 2 -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' \) 2>/dev/null | wc -l || true)"
TXT_N="$(grep -rilE '截图|量测|render' "$ATT" --include='*.md' --include='*.json' 2>/dev/null | wc -l || true)"
if [ "$IMG_N" -eq 0 ] && [ "$TXT_N" -eq 0 ]; then
  fail "样式载体改动 $TOTAL 处命中(基线 $BASE)但 attachments/ 无渲染证据(截图图片或含「截图/量测/render」的记录)"
fi
pass "样式载体改动 $TOTAL 处,渲染证据在位(图片 $IMG_N / 记录 $TXT_N)"
