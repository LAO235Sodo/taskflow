# list & resume（恢复）

1. 定位项目。
2. **扫描"最近活跃工作"**（统一视图，登记 + 游离一起列）：
   - **登记任务**：index.json 中 active/verifying 任务，按 lastActiveAt 倒序（`verifying` 显示"等部署验收"）
   - **游离工作**（未登记但最近活跃的信号）：
     * `git worktree list` 中未被登记任务占用的 worktree
     * 近期活跃分支（`git branch --sort=-committerdate` 前几名；排除主分支与 备份/稳定/*-bak 类）
     * 各自的未提交改动概要（`git status --short`）
3. **呈现列表，第一个问题 = "继续哪个？"**：
   - 登记任务 → 直接继续（按各自流程走）
   - 游离工作 → 三个出口：**继续（先按 adopt.md 收编补档案）** / 仅收编建档 / 忽略并记住（adopt-ignore.json）
   - 游离工作被选"继续"时，收编登记完成即无缝进入该工作（例如接着画设计稿），不重新开题
4. **无一可继续**（无登记任务、无游离 worktree/近期分支、无未提交改动）→ 告知无可继续的工作，问是否新建（new-task.md），或呈现完整状态盘点。
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
