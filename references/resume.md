# list & resume（恢复）

1. 定位项目，读 index.json。
2. **0 个 active / verifying** → 告知无进行中任务，问是否新建（new-task.md）。
3. **1 个** → 展示任务卡片，确认是否继续。
4. **多个** → 列表（标题、id、tier、状态——`verifying` 显示为"等部署验收"、最后活跃时间、分支），让用户选。
5. **事实核查**（不可跳）：
   - 执行位置：anchor=managed 且 worktree 存在 → 在 worktree 里执行；**anchor=attached 的任务 `worktree` 字段为 null 是正常状态**（挂靠在用户分支上）——核查在主仓库当前分支执行，**不得误报"worktree 丢失"或询问重建**；仅 anchor=managed 且 worktree 目录缺失时才报告并询问是否重建。

   ```bash
   git status --short                # 有无未提交改动
   git log --oneline -10             # 最近提交
   git rev-parse HEAD                # 与 task.json 最后 checkpoint 的 commit 比对
   ```

   - 一致且工作区干净 → 报告"记录与代码一致"。
   - 有差异 → **明确列出差异**（多了哪些 commit、哪些未提交文件），让用户决定以哪边为准；不得自行取舍。
   - **漏网检测**：差异中存在 checkpoints[] 未登记的 commit → 提示补一条 checkpoint 记录（保追溯链完整）；当前分支有工作但完全无任务档案 → 提示收编为新任务（adopt.md）。只提示，不擅自登记。
6. 读 `.opencode/tasks/conventions.md`（项目约定，必读）+ spec.md、handoff.md、findings.md、decisions.md（项目决策库 decisions/ 如相关也读）。
7. 输出恢复摘要：**目标 / 当前在哪 / 下一步（具体命令）/ 未决风险**。
8. 用户确认后继续工作；续做时把 task.json 与 index.json 的 sessionID 更新为当前会话。
9. **verifying 任务的恢复**：跳过开发流程，直接从 merge.md 第 9 步（推送与部署）继续验收闭环。
