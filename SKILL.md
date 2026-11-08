---
name: taskflow
version: 3.0.1
description: 长任务跨会话账本：建档、checkpoint、恢复、合并、验收。触发：描述需求/继续之前的活/中断存档/验收打回/问进度
---

# taskflow — 长任务存档/恢复/合并

跨会话的任务账本与流程骨架：代码进 git 分支，叙事进 markdown，验收拍板归人。

**三条铁律（一切动作的底线）：**
1. **代码存 git 分支，叙事存 markdown**——`.taskflow/` 状态目录永不进 git；
2. **先存档，再跑**——有风险的执行动作之前必须 checkpoint；
3. **不审查，不合并；不验收，不归档**——归档只发生在用户最终验收通过之后。

**定位项目**：`git rev-parse --path-format=absolute --git-common-dir` 定主仓库根，任务数据在 `<主仓库根>/.taskflow/`（隐藏目录，glob 需 `hidden:true`）；非 git 目录用 `tf.mjs init --no-git` 走档案模式；项目身份=remote 规范化或绝对路径，全局注册表住 `$TF_TASKFLOW_HOME`（缺省 `~/.local/state/taskflow`）。


**意图路由**：任何输入先读 `references/entry-routes.md` 按语义路由到对应入口与 references 文件（唯一路由表）；多意图逐个分解按依赖排序。

**通用纪律（A 类一行化，共 15 条）**：①禁 reset --hard/checkout --/clean -f/force push/共享分支 -D；②不审查不合并、不验收不归档；③先存档再跑；④只碰本任务工作区；⑤merge 前同步主分支；⑥恢复见不一致只报告；⑦`.taskflow/` 不进 git；⑧adopt 只读；⑨修过的 bug 复发先查为何复发（`scout <症状词>` 判回归）；⑩术语多义先对口径；⑪问答先回显理解再答；⑫记录用标准术语+根因+修法；⑬渲染产物 fixture 必须真执行；⑭多维状态正交并列；⑮变更影响盘点：动手前列消费方清单（文件:行号+消费性质），修复前扫同类（同模式 grep），载体技能按 profile 降级注记一次。

**确认原则**：高影响门（新建任务/worktree、merge、adopt 登记、远程部署命令执行、归档清理、large 拆分派发）逐条确认；档位与门清单由 conventions「确认档位」+ profile 决定，缺省 detailed，模型禁自改；一次确认=一个可懂问题，禁机制代号入确认文案。

**外部依赖**：触点需要的技能/包先检测（`tf.mjs packs list`/`skills`）；缺=首触达一次拍板落 profile，不再逐任务问。

**输出**：结论先行 ≤5 行摘要，明细按需（`ls --full`）；状态词中文；呈报文风细则在 briefing 包。

**兜底**：信号冲突不猜，列状态与选项请用户点名。

事故与教训沉淀在项目 `.taskflow/decisions/` 与 `meta/recurrence.json`；技能自身规则住各包，本文件只做路由。
