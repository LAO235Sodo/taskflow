# 前端样式真源门（STYLE_SOURCE_GATE）

> 机制定义（SKILL.md 硬规则 20 / data.md 机制登记表）。本文件是流程细则的唯一载体——真源结构、双源结构、双门、大白话模板、延迟初始化与迁移指引。防的事故类：已定稿样式被后续任务「合法地改偏」（走了完整流程但视觉漂移未经用户拍板；用户实证诉求，2026-09-27）。

## 1. 真源结构（全局唯一样式口径，进 git）

```
docs/ui/style-source/
├── prototype/          # 定稿原型库：HTML/CSS/JS（design-v2.html 等；只进「已拍板」稿，迭代稿住任务 design/）
├── spec-*.json         # 规格表：DOM computed styles 机械提取（DESIGN_SPEC_EXTRACT 产物迁入/复用）
└── STYLE_DECISIONS.md  # 样式拍板日志：日期 / 大白话摘要（现在→改成→为什么）/ 用户拍板留痕 / 涉及文件
```

真源与任务档案的分工：**迭代过程稿**住 `.taskflow/<id>/design/`（不进 git）；**定稿**（用户拍板「就这个」后）迁入真源。规格表随定稿一起进真源——真源规格表是 App 样式实现的验收准绳。

## 2. 双源结构（现状事实 × 拍板意图，APP_PAGE_BASELINE——硬规则 21）

- **App 现状基线 = 「长什么样」的唯一事实（主源）**：改现有页面的原型任务立项时机械提取（Android `scripts/design/extract-app-baseline.js` 产 schema=app-baseline/1 + 截图 / web `extract-spec.js` 指向运行中的真实站点，产物 schema=design-spec-extract/1），产物落 `.taskflow/<id>/design/baseline/`（基线门两种 schema 头都认）——**只住任务档案，不迁入真源、不建全局基线库**：App 代码是活的，快照库会重制造过时问题（2026-09-27 用户拍板「系统的页面才是最新的，原型可作输入源」）；现状永远立项现提
- **真源（prototype/ + spec-*.json + STYLE_DECISIONS.md）= 「决定了什么」的意图记录（辅源）**：允许作为原型制作的输入源（设计意图起点），但不是现状权威——原型可能残留旧问题
- **双源冲突 = 信号，禁止自动裁决**：呈报用户二选一——App 未留痕漂移 → 补门一大白话拍板 + STYLE_DECISIONS 留痕；原型过时 → 真源回写/重新提取。冲突清单 = 「原型残留问题」检测器（分歧点逐个暴露，不默默继承）
- **与门二的关系**：门二（merge 阶段三实现↔真源规格表对照）管**变更控制**不变；本节管**原型制作的现状输入**——正交并联

## 3. 双门

### 门一：改真源文件 → 大白话拍板（用户决定）

任何任务要修改/删除/新增真源文件（prototype/、spec-*.json、STYLE_DECISIONS.md 自身的拍板记录）：

1. **呈报大白话对照**（禁止术语化呈报——用户要能一眼看懂）：

   > **现在**：历史页「复用」按钮是白底蓝边描边（截图）
   > **改成**：蓝色实底白字胶囊（截图）
   > **为什么**：参照图 v3 里是实底，描边档视觉太轻
   > **改不改？**

2. 用户拍板 → 拍板记录**追加** `STYLE_DECISIONS.md`（格式见文件头注释）→ 同 commit 改真源
3. CHANGELOG 条目带 **「样式拍板：」行**（指向 STYLE_DECISIONS.md 当日记录；纯重命名/注释类写「样式拍板：语义中性——理由」）
4. 机械强制：`validate-style-source-gate.sh`（默认模式查 CHANGELOG / `--diff` 查提交说明），并入 `validate-changelog.sh` 收尾必跑

### 门二：App 样式实现偏离规格表 → 阻塞

merge 阶段三（产物一致性）以**真源规格表**为准绳：App 实现的样式属性（token 值/字号/圆角/内距/结构）逐项对照 spec-*.json——偏离必须被某条已拍板的 STYLE_DECISIONS 记录覆盖（即「偏离是被拍过板的新决定，真源还没跟上」→ 先补门一再改），**未拍板的偏离 = 阻塞项**。

## 4. 延迟初始化（全局技能、按项目启用）

门脚本对未初始化项目**降级通过**（不强制所有项目落地）。初始化时机 = 首个前端样式任务触点：

- **new-task 第 8 步**：任务涉及前端样式资产 → 检查 `docs/ui/style-source/` 不存在 → 呈报用户「本项目可启用样式真源门（防后续任务改偏已定稿样式），是否初始化？」→ 同意则 `node tf.mjs mech install STYLE_SOURCE_GATE` + 真源迁移（把现有定稿原型/规格表搬入）
- **merge 阶段三**：审查发现样式实现无真源准绳（视觉验收只能靠人工目测）→ 同上引导

## 5. 初始化与迁移指引

```bash
node tf.mjs mech install STYLE_SOURCE_GATE   # 渲染门脚本 + conventions/AGENTS 补记 + 采纳登记
mkdir -p docs/ui/style-source/prototype
cp .taskflow/<定稿任务id>/design/<定稿稿>.html docs/ui/style-source/prototype/
cp .taskflow/<定稿任务id>/design/spec-extract*.json docs/ui/style-source/
# 建 STYLE_DECISIONS.md（首条 = 迁移时的定稿拍板留痕）
```

## 6. 与既有机制的关系

- **DESIGN_SPEC_EXTRACT（硬规则 19）**：管「原型→规格表」提取——定稿前；真源门管「定稿后的变更控制」——定稿后。规格表产物同一份，两个生命周期阶段。
- **APP_PAGE_BASELINE（硬规则 21）**：管「App 现状→基线」提取与原型现状输入——制作前；真源门管「定稿后的变更控制」——定稿后。双源冲突呈报裁决（本文件 §2）。
- **决策组合门（硬规则 16①）**：组合门查「新改动 × 既有决策」的可达状态打架；真源门查「样式漂移是否被拍板」——正交，双门并联跑。
- **req-confirm / 需求变更门**：需求口径变更走 req-confirm；样式口径变更走 STYLE_DECISIONS.md——同为「变更留痕」家族。
