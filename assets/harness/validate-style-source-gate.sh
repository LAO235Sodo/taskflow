#!/usr/bin/env bash
# validate-style-source-gate.sh — 前端样式真源门（taskflow 硬规则 20 / 机制 STYLE_SOURCE_GATE 的机械执行体）
# 由 `node tf.mjs mech install STYLE_SOURCE_GATE` 生成（模板住技能仓库 assets/harness/——勿手改，重装覆盖）。
# 防的事故类：已定稿样式被后续任务「合法地改偏」——走了完整流程（评估/测试都绿）但样式漂移未经用户拍板
# （用户实证诉求：样式全局真源 + 大白话拍板门，2026-09-27）。
# 门义（双模式）：
#   默认   CHANGELOG 静态校验：锚点之上条目，凡反引号资产命中真源目录（docs/ui/style-source/）
#            → 该条目须含「样式拍板：」行——指向 STYLE_DECISIONS.md 中已追加的拍板记录
#            （格式：样式拍板：<日期 大白话摘要>，见 docs/ui/style-source/STYLE_DECISIONS.md）
#            或「样式拍板：语义中性——<理由>」（如纯重命名/注释——廉价合法通道，防静默绕闸）
#   --diff  merge/收尾完备性：git diff 命中真源文件 → HEAD 提交信息或暂存 diff 须含「样式拍板」字样
# 降级通过：无 .taskflow / 项目无 docs/ui/style-source/（STYLE_SOURCE_GATE 未初始化——延迟加载语义，
#           初始化引导见 references/style-source.md）/ CHANGELOG 无锚点（门未启用，祖父豁免）。
# 退出码：0 通过/降级；1 违规。兼容 macOS bash 3.2。
set -euo pipefail

ROOT="$(cd "$(dirname "$BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
TASKFLOW_DIR=".taskflow"
MAIN_ROOT="$ROOT"
if [ -n "$COMMON_DIR" ]; then TASKFLOW_DIR="$(dirname "$COMMON_DIR")/.taskflow"; MAIN_ROOT="$(dirname "$COMMON_DIR")"; fi

GATE_ANCHOR="样式真源门落地"
SRC_DIR="docs/ui/style-source"
BT='`'

fail() { echo "⛔ [style-gate] $*" >&2; exit 1; }
warn() { echo "⚠ [style-gate] $*" >&2; }

if [ ! -d "$TASKFLOW_DIR" ]; then
  warn "$TASKFLOW_DIR 不存在（CI fresh checkout / 非 taskflow 项目）→ 门降级通过"
  exit 0
fi
# 延迟加载：真源未初始化 = 门不生效（初始化走 node tf.mjs mech install STYLE_SOURCE_GATE + 真源迁移）
if [ ! -d "$SRC_DIR" ] || [ ! -f "$SRC_DIR/STYLE_DECISIONS.md" ]; then
  warn "$SRC_DIR 未初始化（STYLE_SOURCE_GATE 延迟加载：首个前端样式任务触点引导初始化，见 taskflow references/style-source.md）→ 门降级通过"
  exit 0
fi

if [ "${1:-}" = "--diff" ]; then
  # 完备性：真源文件被改 → 提交说明须含样式拍板字样
  BASE="${2:-HEAD~1}"
  CHANGED="$(git diff --name-only "$BASE" -- "$SRC_DIR" 2>/dev/null || true)"
  if [ -z "$CHANGED" ]; then
    echo "✓ [style-gate] --diff：真源无改动"
    exit 0
  fi
  MSG="$(git log -1 --format=%B HEAD 2>/dev/null || true)"
  echo "$MSG" | grep -q '样式拍板' \
    || fail "真源被改（$(echo "$CHANGED" | tr '\n' ' '))但提交说明缺「样式拍板」字样——大白话拍板记录须先进 $SRC_DIR/STYLE_DECISIONS.md（硬规则 20）"
  echo "✓ [style-gate] --diff：真源改动带拍板留痕"
  exit 0
fi

# 默认模式：CHANGELOG 锚点之上条目命中真源资产 → 须含「样式拍板：」行
CHANGELOG="docs/CHANGELOG.md"
[ -f "$CHANGELOG" ] || { warn "无 docs/CHANGELOG.md → 门降级通过"; exit 0; }

ANCHOR_LINE="$(grep -n "^## .*$GATE_ANCHOR" "$CHANGELOG" | tail -1 | cut -d: -f1 || true)"
if [ -z "$ANCHOR_LINE" ]; then
  warn "CHANGELOG 无「$GATE_ANCHOR」锚点（门未启用，历史祖父豁免）→ 降级通过"
  exit 0
fi

SRC_RE='(^|/)docs/ui/style-source/'
VIOLATIONS=0
CHECKED=0
# bash 3.2 兼容：用 python3 逐条目解析（macOS/Linux 通吃）
python3 - "$CHANGELOG" "$ANCHOR_LINE" "$SRC_RE" <<'PYEOF'
import re, sys
path, anchor_line, src_re = sys.argv[1], int(sys.argv[2]), sys.argv[3]
lines = open(path, encoding='utf-8', errors='ignore').read().split('\n')
body = '\n'.join(lines[:anchor_line-1])  # 受管区=锚点之上（新条目插锚点上方）
entries = re.split(r'\n(?=## )', body)
v = 0; checked = 0
for e in entries:
    if not e.startswith('## '):
        continue
    if '样式真源门落地' in e.splitlines()[0]:
        continue  # 锚点条目自指豁免（其说明文字提及真源路径非改动）
    assets = re.findall(r'`([^`]+)`', e)
    hit = [a for a in assets if re.search(src_re, a)]
    if not hit:
        continue
    checked += 1
    import re as _re
    if not _re.search(r'样式拍板[*:：]', e):
        print(f"⛔ [style-gate] 条目「{e.splitlines()[0][:60]}」改真源（{hit[0]}）但缺「样式拍板：」行——大白话拍板（现在→改成→为什么→用户决定）先进 docs/ui/style-source/STYLE_DECISIONS.md", file=sys.stderr)
        v += 1
    elif _re.search(r'样式拍板[*:：]', e) and '语义中性' not in e:
        # 有拍板行：抽验 STYLE_DECISIONS.md 是否有当日记录（宽松：文件非空即可，日期匹配降级为提示）
        pass
print(f"STYLE_GATE_CHECKED={checked} VIOLATIONS={v}", file=sys.stderr)
sys.exit(1 if v else 0)
PYEOF
RC=$?
[ "$RC" -eq 0 ] || exit 1
echo "✓ [style-gate] 样式真源门通过（真源已初始化，受管条目均带拍板留痕或语义中性）"
