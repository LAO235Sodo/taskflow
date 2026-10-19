# checkpoint（存档）

## 触发点（硬规则，动作前必须先存档）

- 派发任何子代理之前（**例外**：merge 流程内的审查子代理由 merge 第 1 步的存档覆盖——若其后至派发前产生了新改动，先补一次轻量存档再派）
- 高风险/实验性改动之前（重构、依赖升级、批量删除、大规模生成）。**连续系列操作**（如依次升级多个依赖）：首前完整版，其间轻量版
- merge 之前
- 长命令 / 批量自动化之前（轻量版）
- 用户要求中断、会话过长、准备转新会话时

**主动触发（无需用户指示）**：任务执行过程中，每完成 spec 的一个验收点、一个子任务，或一批改动通过验证时，自动做一次**轻量 checkpoint** 并向用户报一句结果。不要攒到最后。完成一轮**诊断/走查/审查并产出结论**时，先把结论落 `findings.md`（轻量）再继续——结论只活在对话里，会话一关修复还得重查（实证：snap-ai-patrol-20260921 五分钟走查未落档）。

## 形态选择（矩阵——每格必有取值，无空格）

| 场景 | small | medium / large |
| --- | --- | --- |
| 中断存档 / merge 前 / 高风险首前 / 阶段完成 | **轻量**（SKILL.md small 裁剪：全程轻量；merge 前若 handoff「下一步」已陈旧可顺手刷新该节，非强制） | 完整 |
| 主动触发 / 长命令前 / 高风险系列其间 | 轻量 | 轻量 |

## 基线管道（两版共享，只声明一次）

轻量版 = 管道第 1-4 步。完整版 = 第 0 步文档更新 + 管道第 1-4 步。

## 完整版流程

0. **更新文档（完整版专属；有变化才写）**：
   - `handoff.md`：已完成项打勾、刷新"下一步"（**必须具体到文件和命令**）、新决策进"已定决策"表、被放弃的方案进"被否决的方案"表（**必须写否决原因**）。
   - `findings.md`：新结论、新踩坑。
   - `progress.md`：顶部追加本次日志（时间、会话、做了什么、验收结果、遗留）。
   - `conventions.md`（项目级）：核对推送/部署节奏是否按约定执行；用户口述新约定立即写入对应小节，**并同步更新项目根 AGENTS.md 的红线摘要**。
   - **决策晋升（当场完成，不等 merge）**：本任务新固化的项目级决策，每条当场写一份 `.taskflow/decisions/YYYY-MM-DD-<slug>.md`（背景 / 决策 / 被否决方案及原因 / 影响范围），并在 `decisions.md` 对应条目加文件名回链——两处记录永远可互达。部署/验收类约定只住 conventions.md，不进决策库。
1. 定位项目；确定当前任务（sessionID 只是"最近活跃会话"的定位提示，优先按它匹配；不匹配则列 active 任务让用户确认，**不得凭 sessionID 独断**）。
2. **git 存档**（git=false 时跳过——该标志由 project.json 的 git 字段定义，见 data.md）：

   ```bash
   git add -A && git commit -m "checkpoint: <一句话摘要>"   # 无代码改动则跳过 commit
   ```

   独占任务 worktree 内可用 `-A`；**挂靠任务（attached）或不得不在主仓库检出区时禁止 -A**，改用 `node scripts/tf.mjs commit -m "checkpoint: <摘要>" --files <路径…> --session <本会话ID>` 声明范围并带乐观锁（attached 必带 `--session`——属主不符拒写，是双会话同桌的唯一硬闸）。**managed 独占 worktree 裸 git commit 即可**（物理隔离即护栏）。跨会话接手先走接管仪式（resume.md 第 8 步），清点完成前禁 commit。推送按 conventions.md 约定（如约定"每 checkpoint 后 push"则在 commit 后 push）。
3. **更新 task.json**：`checkpoints[]` 追加一条——`commit`（本次 sha；无 commit 则 `null`）、`files`（`git diff --name-only <上次checkpoint的commit>..HEAD`；首次用 `git diff --name-only "$(git merge-base <main> HEAD)"..HEAD`）、`summary`、`ts`。
4. **原子簿记（task.json → index.json + L0，一并完成）**：刷新 lastActiveAt、lastCheckpointCommit、sessionID；**有 `activeLease` 时刷新 `heartbeatAt`（LEASE 心跳——doctor I9 靠它判断「他会在途」，不刷 = 租约名存实亡）**；**刷新即对账**——以 task.json 为准核对 status/tier/sessionID/branch/worktree，冲突即回写并报告（禁止只改一处）。**轻量版同样执行对账**（对账是幂等读改写，无额外成本）。
5. 向用户输出一行确认：`已存档 <sha|无代码改动> —— <摘要>（改动 N 个文件）`（轻量版可并入主动触发的那一句报告）。

---

**附注（非流程步骤）**：若 `git status` 出现任务数据目录（`.taskflow/`），说明 exclude 失效——**立即**补上（`.git/info/exclude` 加 `.taskflow/`）并 `git rm -r --cached .taskflow`，然后继续主流程。
