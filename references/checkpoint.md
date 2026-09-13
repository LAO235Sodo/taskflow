# checkpoint（存档）

## 触发点（硬规则，动作前必须先存档）

- 派发任何子代理之前
- 高风险/实验性改动之前（重构、依赖升级、批量删除、大规模生成）
- merge 之前
- 长命令 / 批量自动化之前
- 用户要求中断、会话过长、准备转新会话时

**主动触发（无需用户指示）**：任务执行过程中，每完成 spec 的一个验收点、一个子任务，或一批改动通过验证时，自动做一次**轻量 checkpoint** 并向用户报一句结果。不要攒到最后。

## 两种形态

- **完整版**——用于：中断存档、merge 前、高风险动作前、阶段完成。更新全部文档（见流程第 2 步）。
- **轻量版**——用于：small 任务全程；medium/large 的主动触发。只做：`progress.md` 顶部追加一行 + git commit + task.json checkpoints[] 追加 + 刷新 index.json。跳过 handoff/findings/decisions（无实质变化本就不用写）。

## 完整版流程

1. 定位项目；确定当前任务（优先匹配 index/task.json 中记录的 sessionID；不匹配则列 active 任务让用户确认）。
2. **更新文档**（有变化才写）：
   - `handoff.md`：已完成项打勾、刷新"下一步"（**必须具体到文件和命令**）、新决策进"已定决策"表、被放弃的方案进"被否决的方案"表（**必须写否决原因**）。
   - `findings.md`：新结论、新踩坑。
   - `progress.md`：顶部追加本次日志（时间、会话、做了什么、验收结果、遗留）。
   - `decisions.md`：架构/接口/约束类固化决策。
   - `conventions.md`（项目级）：完整版 checkpoint 时核对推送/部署节奏是否按约定执行；用户口述新约定立即写入对应小节，**并同步更新项目根 AGENTS.md 的红线摘要**（保持两处一致，AGENTS.md 才是每会话必达的那份）。
3. **git 存档**（git=false 跳过）：

   ```bash
   git add -A && git commit -m "checkpoint: <一句话摘要>"   # 无代码改动则跳过 commit
   ```

   推送按 conventions.md 的约定执行（如约定"每 checkpoint 后 push"则在 commit 后 push）。
   挂靠任务（anchor=attached）：commit 打在用户现有分支上，规则相同。
   若 `git status` 出现 `.opencode/tasks/`，说明 exclude 失效：**立即**补上（`.git/info/exclude` 加 `.opencode/tasks/`）并从暂存区移除（`git rm -r --cached .opencode/tasks`）。

4. **更新 task.json**：checkpoints[] 追加一条：
   - `commit`：本次 commit sha；无 commit 则 `null`
   - `files`：`git diff --name-only <上次checkpoint的commit>..HEAD`；首次 checkpoint 用 `git diff --name-only "$(git merge-base main HEAD)"..HEAD`
   - `summary`、`ts`
5. 刷新 index.json（lastActiveAt、lastCheckpointCommit、sessionID）与 L0 注册表。
6. 向用户输出一行确认：`已存档 <sha|无代码改动> —— <摘要>（改动 N 个文件）`。
