---
name: taskflow
version: 2.3.0
description: "[v2.3.0] 长任务跨会话的存档/恢复/合并管理，自动识别意图、无需用户指定动作词。触发场景：用户描述任何要做的需求或改动（加功能/修 bug/重构）、表达中断或会话过长（先到这/明天继续）、新会话想继续之前的工作、任务完成要收尾合并、询问任务进度、要求收编/整合现有分支或 worktree（统一到 taskflow）。技能内部自动盘点项目任务状态并结合用户语义路由到：新任务建档 / checkpoint 存档 / resume 恢复 / merge 强制审查合并 / status / adopt 收编。管理：git worktree 隔离、任务拆分与子代理派发、四层索引、项目决策沉淀库、既有工作收编（anchor 挂靠）。"
---

# taskflow — 长任务存档 / 恢复 / 合并

> 本文件是路由器。确定动作后，**先读 `references/<对应文件>.md` 再执行**；写任务文件前查 `references/data.md` 的 schema。

**三条铁律（一切动作的底线）：**
1. **代码存 git 分支，叙事存 markdown** —— 状态文档（`.opencode/tasks/`）永不进 git
2. **先存档，再跑** —— 有风险的执行动作之前必须先 checkpoint
3. **不审查，不合并；不验收，不归档** —— 归档只发生在用户最终验收通过之后

---

## 第一步（所有动作前）：定位项目

不依赖当前目录，用 git 结构定位主仓库：

```bash
git rev-parse --path-format=absolute --git-common-dir   # 主仓库 .git（主仓库与所有 worktree 结果相同）
```

- 主仓库根 = 该路径的上级目录；任务数据固定在 `<主仓库根>/.opencode/tasks/`，**不在当前 worktree**
- **主仓库检出区永远保持干净，仅作合并落点**——所有任务（不分大小）一律住 worktree，任何任务不在主仓库内直接改动
- 项目 key：`git remote get-url origin` 规范化（去掉协议前缀 https:// ssh:// git@、结尾 .git、':' → '/'）；无 remote 用主仓库绝对路径
- 非 git 目录：以 cwd 为项目根，project.json 标 `"git": false`，禁用 worktree/分支/commit 能力，只留文档存档
- 身份核对：读 `<主仓库根>/.opencode/tasks/project.json`，key 一致即同一项目；跨项目查 `~/.config/opencode/taskflow/projects.json`
- **项目约定**：`.opencode/tasks/conventions.md` 存在即读（推送/部署/验证清单/完成定义/禁忌，跨会话生效）；不存在则在初始化时引导生成，新约定随时沉淀

## 意图自动识别

**CRITICAL — 绝不问用户"你要存档还是合并"。** 先静默盘点，再按语义路由。

**静默盘点**：定位项目 → 读 index.json（active/verifying 任务数、sessionID 绑定）→ git 快照（worktree 在否、HEAD vs 最后 checkpoint、未提交改动）。

| 用户话语信号 | 状态信号 | 判定动作 |
| --- | --- | --- |
| 在描述一件要做的事（"帮我加/改/修 X"、"实现 X"） | 无 active 任务 | → 新任务 |
| 在描述一件要做的事 | 有 active 任务 | → 按下方"归入 vs 另开"判定 |
| 中断语义（"先到这/太长了/明天继续/保存一下"） | 有 active 任务 | → checkpoint |
| 新会话："继续/接着弄/上次那个"，或无新需求直接开干 | 有 active 任务 | → resume，先给恢复摘要 |
| 完成语义（"做完了/验收一下/合进去/收尾"） | 有 active 任务 | → merge |
| 询问进度/状态/有哪些任务 | 任意 | → status |
| 要求拆分 / 派子代理 | 有 active 任务 | → 拆分派发 |
| 收编 / 纳入管理 / 整合现有分支、worktree / 统一到 taskflow | 任意 | → adopt |

**外显**：判定后说一句 `识别为〈动作〉——〈依据〉`，供用户随时纠正。

**确认门槛（高影响动作，须复述将要做的事并获用户确认）**：新建任务/建 worktree、merge、adopt 收编登记、**执行 conventions.md 约定的远程部署命令之前（先展示完整命令清单）**、归档清理。低影响动作（status、checkpoint）直接做、事后报告。

**兜底**：信号冲突或无法判断 → 不猜。呈现状态盘点结果（active/verifying 任务列表 + 各自进度）和可选动作，让用户选。

## 归入 vs 另开（有 active 任务且来的是新需求）

| 信号 | 判定 |
| --- | --- |
| 需求是当前任务目标的组成部分/自然衍生 | 归入：更新 spec.md 验收项，不新建 |
| 会改当前任务正在改的同一批文件，或依赖其未合并产物 | 归入（避免合并顺序纠缠） |
| 独立可交付、有独立验收标准，与当前任务目标正交 | 另开新任务 |
| 会推翻当前任务已固化的决策（decisions.md） | 另开，或先收窄当前任务；禁止混档 |

拿不准 → 把"归入/另开"两个选项及理由一起呈现给用户，不自行取舍。

## 规模分档（新任务建档时与用户确认，档位决定流程轻重）

所有档位**一律建 worktree**（从最新主分支拉起，见 references/new-task.md），档位只影响其余流程轻重：

- **small**：单文件或目标极明确，一次会话完成 → 不拆子任务
- **medium**：多文件、多个关注点 → 按需拆分
- **large**：新项目/架构级 → spec.md 须经用户确认后才允许拆分派发

**small 裁剪**（治"小任务全额税"）：merge 审查由编排层自查（亲自读 diff + 按两阶段清单自查 + 跑验收），**不派子代理**；checkpoint 用轻量版。medium/large 全流程。

## 动作路由（判定后先读对应文件再执行）

| 判定动作 | 详情文件（先读再执行） |
| --- | --- |
| 新任务 | `references/new-task.md` |
| checkpoint | `references/checkpoint.md` |
| resume | `references/resume.md` |
| merge | `references/merge.md` |
| adopt | `references/adopt.md` |
| 拆分派发（new-task 中触发） | `references/split.md` |
| 领域技能联动（spec 阶段与 merge 审查时） | `references/domain.md` |
| 数据结构 / schema（写任务文件前） | `references/data.md` |

**status（内联，无需读文件）**：读 index.json + 各 task.json，输出表：标题 / id / 状态 / tier / 子任务进度（done/total）/ 最后活跃 / 最后 checkpoint 摘要。状态为 `verifying` 时显示"等部署验收"。不改任何状态。

项目级注意事项 `.opencode/tasks/conventions.md`：新建任务 / resume / merge / 完整版 checkpoint 四个触点**必读**；不存在则初始化时引导生成，口述新约定随时写入。

## 硬规则（违反任何一条：立即停止并向用户报告）

1. 禁止：`git reset --hard`、`git checkout -- .`、`git clean -f`、任何 force push、`git branch -D`。冲突只能通过编辑文件解决。
2. **不审查，不合并；不验收，不归档**——归档只发生在用户最终验收通过之后（见 references/merge.md 第 10 步）。
3. **先存档，再跑**——checkpoint.md 列出的全部触发点之前必须 checkpoint。
4. 只操作当前任务自己的 worktree、分支和 `.opencode/tasks/<task-id>/` 目录；**绝不触碰其他任务的工作区**。
5. merge 前必须先同步主分支（防止覆盖他人新代码）。
6. resume 时记录与代码不一致：只报告，不擅自取舍，交给用户决定。
7. `.opencode/tasks/` 出现在 git status → 立即修复 exclude 并从暂存区移除。
8. **adopt 评审阶段全程只读**：未经用户逐个确认，不写任何任务文件。

## 模板

`templates/` 下五个模板：`handoff.md`、`findings.md`、`progress.md`、`spec.md`、`subtask-spec.md`。复制后替换 `<占位符>`；无内容的节保留标题并写"（暂无）"，不要删节。
