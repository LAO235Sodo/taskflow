# 原型工作流（prototype）

> 定位：前端 UI 任务「产物链原型环节」的**串联页**。六步链 = taskflow 纵贯链（spec 产物链 → 实现呈报 → merge 审查）的显式化。
> 串联与指针为主；**新增规则仅限五处**：⓪现状基线提取、②对标引导、③制作纪律、④交付迭代与真源方向规则、⑤裁决回写动作序——其余一律指针，唯一事实源在触点文件，冲突以触点为准。
> 何时读：new-task 第 8 步（质询）命中前端 UI、第 10/11 步领域检测 = 前端 UI、domain.md「可视化呈报硬规则」触发、resume/反馈分类路由到原型类打回时。

## 链总览

```
⓪ 现状基线 ──→ ① 需求质询 ──→ ② 对标引导 ──→ ③ 制作 ──→ ④ 交付迭代 ──→ ⑤ 裁决回写
(APP_PAGE_BASELINE)  (new-task §8)   (本页 ②)     (spec 产物链)  (实现呈报回路)  (merge 审查钩子)
```

**small 档变体**：小档前端 UI 任务豁免独立 user-stories.md 与完整六步，但保留最小闭环——1-2 问收束故事骨架（写进 spec 即可）+ 布局类改动给文字线框确认；**纯样式微调（不产生新页面/交互流）全豁免**（产物链门禁对纯样式微调不适用；⓪ 现状基线不在此豁免列——改现有页必提，见 ⓪）。

## ⓪ 现状基线提取（APP_PAGE_BASELINE，改现有页面硬前置——硬规则 21）

- **触发**：任务触碰**已存在页面**（改功能/改样式/加区块）→ 原型制作之前必须机械提取现状基线；新增页面 = 产物链「现状基线」行写「不适用——新增页面」+ 从同类现状页取样（结构/组件/token 沿用）
- **提取**：Android 跑 `scripts/design/extract-app-baseline.js`（mech install 后住项目；**未装时用技能仓 `assets/design/extract-app-baseline.js` 同样可跑——安装只影响收尾门禁**，安装提醒见 new-task 第 8 步延迟初始化；`--mode device` = adb 截图 + uiautomator 结构树，可叠加 `--layouts/--values` 做静态 token 解析合并；`--mode static` = 纯离线布局 XML + values 解析）；web 项目用 `extract-spec.js` 打开**运行中的真实站点**提取（同一工具、换目标即基线提取器；产物 schema 仍为 design-spec-extract/1，落 `baseline/` 目录即基线——基线门两种 schema 头都认）
- **产物**：`.taskflow/<id>/design/baseline/baseline-<page>.json`（schema=app-baseline/1：结构树 + @color/@dimen/@string 解析值 + device 模式截图）——**只住任务档案，不建全局基线库**：App 代码是活的，快照库会重制造过时问题（2026-09-27 用户拍板「系统的页面才是最新的」）；现状永远立项现提
- **双源结构**：App 现状基线 = 「长什么样」唯一事实（主源）；已定稿原型/规格表（docs/ui/style-source/）= 「决定了什么」意图记录（可作输入起点）。冲突 = 呈报用户裁决：App 未留痕漂移 → 补 STYLE_SOURCE_GATE 门一拍板；原型过时 → 真源回写/重提取——细则 `references/style-source.md`「双源结构」
- **small 档**：同样必提——改现有页是「捏造感」高发区，无裁剪

## ① 需求质询（先故事后原型，硬前置）

- 指针：new-task.md 第 8 步「理解与决策质询」；问法 `interview-me`（一次一问、选择题优先、≤5 问）
- 产物：`docs/prd/<域>/user-stories.md`（角色×旅程×验收骨架）——**故事未拍板 = 原型不立项**（门禁 = PROTOTYPE_STALE，唯一住处 new-task §11 / merge §3 双设，本页不复述其判定）

## ② 对标引导（设计方向档位，立项问一次）

| 选项 | 何时选 | 载体 |
| --- | --- | --- |
| ⓪. App 现状基线 | **改现有页面任务的强制默认档**（硬规则 21）——先提基线（本页 ⓪），A/B/C 仅作 delta 区域的方向参考；不问自走 | `.taskflow/<id>/design/baseline/` |
| A. 沿用本仓样式约定 | 新页面/新域的默认推荐——项目有样式库文档（conventions 有约定，如 docs/ui/styleguide.md）时一致性免费 | 项目样式库文档 |
| B. 对标具体产品/开源 admin | 用户报名字 → `librarian` 检索其布局/交互范式做参考（真正用上 GitHub 检索的场景） | librarian |
| C. ui-ux-pro-max 本地风格库 | 方向未定、想先看风格菜单（79 风格/192 色板/74 字体对可搜） | ui-ux-pro-max |

- **改现有页判定**：任务触碰已存在页面 → ⓪ 基线不问自走（对标引导不再选档）；新页面 → ⓪ 记「不适用——新增页面」+ 同类现状页取样，A/B/C 照旧
- **新域判定**：该域在 `docs/prd/` 下无既有 user-stories/原型产物、且项目样式库未覆盖 = 新域 → **必问一次**；非新域默认 A 不再问
- **重触发例外**：续迭代/实现中途的方向变更若要换设计方向（含改现有页任务 delta 区域的方向），呈报时显式问一次 ②（不受「不再重复问」限制）

## ③ 制作纪律

- **基线优先（APP_PAGE_BASELINE，硬规则 21）**：改现有页面的原型 = **基线 + 显式 delta**——未改区域复刻基线（结构/顺序/token 值），呈报以基线截图为 before、原型为 after；**禁止从零重画整页**（「捏造感」的直接来源——模型先验回退）
- **页挂 story id**：锚定规则唯一住处 = `templates/spec.md` 产物链节（「原型（每页挂 story id）」），本页不另述
- **标注层**：业务注释随交互可见（受众=非技术同事时必备）
- **样式同源**：项目有样式库文档（② A）→ 样式只从其取（token 唯一取色处）；项目无 → 本步裁决在 ⑤ 回写建档
- **业务语言**：按项目 conventions「UI 语言」类约定全文自查（grep 工程词残留）；无该项目约定的按其等价规矩
- 载体选档与门禁：指针 domain.md「可视化呈报硬规则」；呈报前自查指针 `references/prototype-selfcheck.md`
- 形态先例：单文件 HTML（零依赖、离线、双击即开）适合非技术评审

## ④ 交付与迭代回路

- **真源住址**：拍板版原型真源 = `.taskflow/<id>/design/`（data.md「产物住址约定」）；投递镜像（如 Windows 共享）按项目 conventions「交付物」节——**镜像可漂移、真源不挪**；md5 记入 spec 产物链行「用户确认记录」格
- 回路：用户实测 → 指认具体位置 → 修复 + **同类问题全文排查**（指认 N 处 ≠ 只改 N 处）→ 截图佐证 → md5 比对同步 → 用户复验。**3 轮打回仍不收敛 → STUCK升级门**（merge.md 第 3 步：换对标/换实现方案，请用户拍板，禁续迭代空转）
- **真源方向规则**：PRD/用户故事 = 唯一真源，原型 = 可视化投影。**判定标准**：改动触碰 user-stories 验收语句 = 行为语义 → 回写故事；仅观感 = 纯样式 → 只需合样式约定，不回写；**文案措辞两边都算**（回写故事 + 样式库术语辖域）；**拿不准 → 回写**（宁可多写）。同步靠锚点 + 纪律，不上自动同步机制

## ⑤ 裁决回写（固定动作序；merge 审查对照项目 conventions 检查）

原型获用户拍板后**当场依次执行**（不等 merge）：

1. 项目样式库写变更记录 **+ decisions.md**——辖域完全按项目 conventions「样式库流程钩子」原文执行，本页不裁剪
2. spec 产物链表状态改「已拍板」+ 确认记录（时间/会话/md5）
3. PRD/用户故事同步（按 ④ 真源方向规则判定）
4. 重大方向决策沉淀任务 decisions.md——**晋升时机遵循 checkpoint 完整版第 0 步（当场完成，不等 merge；merge §8 仅校验）**
5. **规格表提取（DESIGN_SPEC_EXTRACT，硬规则 19）**：拍板版原型当场跑 `assets/design/extract-spec.js`（mech install 后住项目 `scripts/design/extract-spec.js`）逐元素提取 → `.taskflow/<id>/design/spec-extract.json` + `spec-extract.md` 结构树摘要——结构（DOM 树/布局语义）与样式同固化；此后实现/派发/验收只认规格表，原型 HTML 改动 = 重新提取（真源快照随拍板冻结）

## 实证锚

- 正：智慧门店管理后台原型（2026-09-22/23，v1→v3.2）——五步全跑通、非技术评审好评、styleguide 首版即其裁决沉淀。**此为先例，非全称证明**——推广依据是链路与 taskflow 产物链/门禁的咬合，不是单案例成功
- 反：纯文字 UI 方案可被打回——实证见 domain.md「可视化呈报硬规则」节

> **定稿迁移（STYLE_SOURCE_GATE）**：原型获用户拍板定稿后，定稿稿 + spec-extract*.json 规格表迁入 `docs/ui/style-source/`（全局真源）；后续任何修改过门一（大白话拍板，references/style-source.md）。
