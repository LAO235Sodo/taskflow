# Changelog — taskflow

版本号写在 SKILL.md frontmatter 的 `version` 字段。核对当前加载版本：

```bash
head -4 ~/.config/opencode/skills/taskflow/SKILL.md
# 或看服务端注册表（是否透出 version 取决于 OpenCode 版本）：
opencode api get /api/skill
```

## 2.3.0 — 2026-09-13

- **项目规矩双保险**：conventions.md 红线摘要同步至项目根 `AGENTS.md`（OpenCode 每个会话自动注入、运行中编辑实时热更新）——即使某次对话不经过 taskflow，项目规矩也在上下文里。初始化时自动创建/更新 AGENTS.md，不覆盖用户已有内容。
- 修复依赖：`instructions` 配置字段在 OpenCode V2 尚不生效（文档明示），故弃用该方案改走 AGENTS.md。

## 2.2.0 — 2026-09-13

- 新增**项目约定文档 conventions.md**（项目级、每个会话必读）：推送与部署 / 验证清单 / 完成定义 / 环境与端口注意事项 / 禁止事项——解决"新会话不知道要 push 到远程"。
- dod.md 并入 conventions.md（完成定义成为其中一节），消除双源；部署/验收约定单一事实源在此，decisions.md 只记历史与理由。
- 生成时机提前：项目初始化时引导问答生成（原为首次 merge 才生成）；读取时机：新建任务 / resume / merge / 完整版 checkpoint 四触点必读；口述新约定随时沉淀。
- templates/ 新增 conventions.md 模板。

## 2.1.0 — 2026-09-13

- **新任务一律建 worktree，从最新主分支拉起**（git fetch → origin/main；无 remote 依次 fallback 本地 main → master → 当前 HEAD）。移除"small 默认不建 worktree"与"非主分支默认挂靠"——挂靠降级为仅用户显式要求时使用（须提示并行风险）。
- 主仓库检出区定位改为**永远保持干净、仅作合并落点**：任何任务不在主仓库内直接改动，多并行不再互相占用主检出区。
- 新增**依赖目录符号链接**：worktree 创建后自动检测主仓库 gitignored 依赖目录（node_modules / .venv / vendor 等）链接进 worktree，缓解全新检出需重装依赖的代价。

## 2.0.0 — 2026-09-13

- **结构瘦身**：SKILL.md 从 ~500 行瘦身为 ~110 行路由器（铁律 / 定位项目 / 意图识别 / 归入判定 / 分档 / 动作路由表 / 硬规则），动作细节全部移入 `references/` 八个文件（data / new-task / checkpoint / resume / merge / adopt / split / domain），按动作按需加载——问 status 只载路由器，做 merge 才读 merge.md。
- **small 档裁剪**（治"小任务全额税"）：merge 审查由编排层自查（读 diff + 两阶段清单自查 + 跑验收，不派子代理）；checkpoint 区分完整版/轻量版（轻量版用于 small 全程与 medium/large 的主动触发）。
- 修复：硬规则"四个触发点"陈旧引用 → 改为引用 checkpoint.md 全部触发点。
- 修复：resume 事实核查对 attached 任务（worktree=null 属正常状态）不再误报"worktree 丢失"，核查改在主仓库当前分支执行；仅 managed 且 worktree 缺失才询问重建。
- 确认门槛补全：新增 adopt 收编登记、DoD 远程部署命令执行前展示完整命令清单。

## 1.6.1 — 2026-09-13

- §7 归档清理策略调整（面向大量并行任务）：`managed` 任务的 worktree 在 merge + 验收 + 归档全部通过后**自动移除、不再询问**；分支仍保留（`branch -d`）作追溯。git 拒绝移除（有未提交/未跟踪文件）时禁用 --force、报告原因交用户处理。并行子任务 worktree 同规则。

## 1.6.0 — 2026-09-13

- §7 闭环补全：merge 后不再直接归档——**推送与部署（按 DoD）→ 用户最终验收 → 才归档**；任一环失败保持 `verifying`，中断后恢复直接从验收段续。
- 新增**项目完成定义（DoD）**：`.opencode/tasks/dod.md`（部署方式、验证清单、完成标准），首次 merge 引导问答生成，跨任务复用。
- 状态机新增 **verifying**（git 已合并、部署/验收中）：§2 schema、§6 resume（verifying 直接续验收段）、§8 状态面板同步。
- §11 硬规则扩展："不审查不合并，**不验收不归档**"。

## 1.5.0 — 2026-09-13

- 新增 §4.5 **adopt 收编动作**：扫描分支/worktree → 规则分类 → 三板块收编评审卡（它是什么 / 与体系关系 / 收编后影响——证据前置）→ 用户逐个确认才写入；忽略即记忆（adopt-ignore.json）。
- 新增 **anchor 资产归属**：`managed`（taskflow 新建，全生命周期）/ `attached`（挂靠用户现有分支，不迁移不改名不自动清理）。
- §4 新任务接入**分支策略判定**：非主分支上可挂靠，跳过建 task/<id> 与 worktree。
- §6 resume 新增**漏网检测**：发现未登记 commit / 无档案工作 → 提示补存档或收编。
- §7 merge 归档按 anchor 差异化：attached 资产绝不自动删除。
- §2 task.json schema 增加 anchor 字段；§11 硬规则新增 adopt 只读约束。

## 1.4.0 — 2026-09-13

- §10 从"仅前端"扩展为**通用领域联动**：新增领域检测表（前端 UI / 后端 API / 测试 / Java / Kotlin / Node / Python）与领域→技能映射表，接入已安装的 `api-design-principles`、`java-springboot`、`kotlin-springboot`、`nodejs-backend-patterns`、`python-testing-patterns`、`webapp-testing`。
- §7 merge 专项审查从仅 UI 扩展为按领域叠加（API / 各栈 / 测试）。

## 1.3.0 — 2026-09-13

- 新增 §10 **领域技能联动**：spec 阶段检测前端 UI（需求关键词 + 文件类型），实现阶段把 `frontend-design` 设计要求注入 spec/子任务约束，merge 审查追加**阶段三：界面规范合规**（`web-design-guidelines`）；子代理无技能能力时由编排层摘录注入。
- §7 merge 审查、§9 子任务 spec 接入上述联动点；原 §10/§11 顺延为 §11/§12。

## 1.2.0 — 2026-09-13

- §0 新增**"归入当前任务 vs 另开新任务"判定标准表**：目标衍生/文件重叠/依赖未合并产物 → 归入；独立可交付 → 另开；推翻已固化决策 → 另开或收窄；拿不准呈现选项给用户。修补 1.1.0 只"问用户"不给依据的模糊点。

## 1.1.0 — 2026-09-13

- §0 从"关键词动作路由"重写为**意图自动识别**：加载后先静默盘点项目任务状态，结合用户话语语义自动路由到新任务/存档/恢复/合并/状态，不再要求用户喊口令。
- 新增识别结果外显规则（"识别为〈动作〉——〈依据〉"）与确认门槛（低影响直接做，高影响先确认）。
- checkpoint 新增**主动触发**：完成验收点/子任务/一批验证通过的改动后自动轻量存档，不等用户指示。
- frontmatter description 重写：覆盖"用户描述任何需求"的场景，提升自动加载命中率。

## 1.0.0 — 2026-09-13

- 初版：项目定位（git-common-dir + remote key）、四层索引、轻重分档、
  新任务 / checkpoint / resume / merge / status 五动作、
  拆分与子代理派发（worktree 判定表、两阶段审查）、
  硬规则（先存档再跑、不审查不合并、禁丢弃式 git 操作）、
  决策沉淀库、templates/ 五模板。
