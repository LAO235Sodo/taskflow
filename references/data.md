# 数据结构与四层索引

## 四层

```
L0  ~/.config/opencode/taskflow/projects.json     全局：项目 → 注册信息
L1  <主仓库根>/.taskflow/index.json               项目 → 任务列表
L2  .taskflow/<task-id>/task.json                任务 → checkpoint 历史 + 子任务
L3  git 分支上的 checkpoint commits                真相源：diff、message
```

**L3 是唯一真相源。** L0-L2 只是导航索引；精确追溯一律用 git：

```bash
git log --all --follow -- <文件>            # 反向：这个文件被哪些任务/commit 改过
git show <checkpoint-sha>                   # 某次存档的具体改动
git diff main...task/<id>                   # 任务全量改动
```

## 不变量—— doctor 检查、resume/merge 修复的唯一 spec

> 行数与编号以本表为准，**任何其他文件禁复述范围**（禁改写清单由 lint 强制；反面实证：SKILL.md/README/脚本头注释曾四处各说一个范围数）。代码侧唯一登记处 = tf.mjs `INVARIANTS` 注册表，spec↔注册表↔实现三源一致性由 `node tf.mjs doctor --self` 机械强制——改任何一侧不同步另一侧，提交时刻红灯，不等审查发现。

`scripts/tf.mjs doctor`（只读）按此逐条检查，退出码 0=全绿 / 1=有差异；修复动作（回写/补登/重建/清理）由编排层落笔。脚本自身写入口限簿记命令（清单真相源 = tf.mjs 头注释「能力声明」），叙事与损坏 JSON 修复仍归编排层，绕不开确认门槛。

| # | 不变量 | 大白话 | 违反时的修复动作 |
| --- | --- | --- | --- |
| I1 | index 与 task.json 的 status / tier / sessionID / branch / worktree 一致（task.json 为准） | index 登记表和任务档案两处状态信息对得上，以任务档案为准 | 以 task.json 回写 index，禁止只改一处 |
| I2 | 分支 HEAD == 最后一条**非 merge** 条目的 commit；HEAD 领先 = 漏网 commit；落后/分叉 = 记录与代码不一致。`type: "merge"` 条目（合并事件标记）不参与 tip 对比，doctor 改校验其已存在于主分支历史 | 分支最新提交和档案里最后一条存档记录对得上，漏登记的提交会被点名补登 | 漏网 → 补登 checkpoint（前缀 `(补登,…)`）；不一致 → 列差异交用户取舍 |
| I3 | managed 任务 worktree 存在（attached 的 `worktree: null` 是正常态，不得误报丢失） | 登记为要用的独立工作副本（worktree）目录真实存在 | 报告并询问是否重建；verifying 期间尤其需要 |
| I4 | `.taskflow/` 不被 git 追踪（旧 `.opencode/tasks/` 同） | .taskflow/ 状态档案目录不被 git 追踪（状态文档永不进 git） | 补 `.git/info/exclude` + `git rm -r --cached` |
| I5 | merged 任务：分支保留（`-d` 非 `-D`）、managed worktree 已移除 | 已完结任务的分支保留、工作副本目录已移除 | 分支被删 / 目录残留 → 报告 |
| I6 | （仅 active/verifying）任务分支须包含基线与主干最新——落后即提示 rebase；merged/archived 跳过 | 进行中任务的分支包含基线分支与主干最新提交 | resume / merge 时提示 |
| I7 | （仅显式 `kind: "bugfix"` 的任务，缺省不打扰）任务分支 diff 必须含测试改动——defect→test 门禁：bug 必须固化为永久测试（testing.md §一/§六） | bug 修复任务的改动里必须包含测试 | diff 有改动无测试 → 补测试或显式豁免注记；diff 为空 → ℹ 提示无改动可判 |
| I8 | （提示级；独立于任务循环，**缺省体检必须可达**）已完结任务（merged/archived）必须住 archive/——死任务住根层 = 归档没做完（实证：某会话假归档——status=merged 就汇报完成，journal 平铺根层三天无人察觉） | 已完结任务住 archive/ 目录，不留在根层 | `node tf.mjs archive` 归层（journal 三件套顺手归位，merge.md 第 8 步） |
| I9 | activeLease 心跳新鲜（≤30 分钟）= 有会话在途 | 会话心跳新鲜=有会话在途，防止两个会话同时改一个任务 | ℹ 提示级：lease 活跃 → 「他会在途，续做前核对」；过期 → 可接管，接管经 `tf.mjs takeover`（resume.md 第 8 步） |
| I10 | active/verifying 任务的 worktree 有属主凭证：`.owner.json`（sessionID/pid/started_at 原子写）+ pid 活性 × started_at 单向判据（进程启动显著晚于凭证 = pid 复用嫌疑；进程先于凭证 = 长驻进程合法态，v2.29.0） | 工作副本有属主凭证文件，进程活着且凭证对得上 | ℹ 提示级：缺文件=无主 → 属主补写；pid 死 → 可接管（接管仪式经 `tf.mjs takeover`：改 sessionID + 重写 `.owner.json` + 刷新 lease + 打印清点清单）。清理三态：owned 可清 / **foreign 永不删** / unowned 问用户。隔离层硬拒由 `commit --session` 乐观锁承担（属主不符拒写），lease 是护栏不是锁 |
| I11 | （spec.md 存在且含「目标/验收标准」节的任务）spec 承重节现算 hash == task.json.goalHash——需求变更唯一合法写路径 = `tf.mjs req-confirm`（需求变更门落痕）；`[x]`/`[ ]` 勾选归一不参与比对 | spec 承重节指纹与档案一致，改需求必须过变更门留痕 | 红：跑 `tf.mjs req-confirm <id> --note "…"` 补确认或回退 spec；无 goalHash = pre-v2.23 档案 → ℹ 补锚；spec.md 缺失但 goalHash 在档 → 红（恢复文件或重锚） |
| I12 | spec「需求基线」节声明的 docs/prd 链接真实存在（文件可寻于 worktree 或主仓库 + 锚点文本在文件中）；「无 PRD」注记仅当 kind=bugfix 或含「拍板/豁免」留痕字样才合法（**新增需求禁豁免——原始需求必须可追溯**）；条目级锚（验收项逐条挂 PRD 条目 ID、基线外草案登记与升格）归 REQ_ANCHOR_GATE 管，本行仍管文件级链接 | spec 声明的 PRD 文档与锚点真实存在 | 红：修链接 / 补 PRD 条目 / 呈用户拍板豁免并补留痕字样（禁空节）；节缺失（pre-v2.23 档案）→ ℹ 续迭代时补 |
| I13 | （仅 merged/archived 且有 reqChanges）最后 reqChange 时刻 ≤ 基线节 PRD 文件最后 git 提交时刻 | 需求确认不能晚于 PRD 最后提交，晚=疑未回写 | ℹ：reqChanges 晚于 PRD 最后提交 → PRD 疑未回写，人工核对后补提交 |
| I14 | services.json 服务端口租约对账：schema 合法（services 数组、条目 port/service 必填）、端口不重复；pid 死 = stale、task 不在 index = orphan（svc ls 标注正交：orphan 为独立后缀，可与 pid 态复合，v2.29.0） | 服务端口登记表 schema 合法、端口不重复、进程活性可判 | ⚠ 红：schema 非法 / 端口重复；ℹ 提示级：stale/orphan 可回收/认领（claim 自动回收死租约须端口实测空闲；release 手动释放） |
| I15 | 根层幽灵目录对账：有内容、无 task.json、不在 index → 点名（提示级） | 根层有内容但没有档案的目录被点名，不静默 | ℹ：认领建档 / 移 archive/ / 确认无用后删除——禁静默无视 |
| I16 | verifying 敞口：`deploy` 在档且任务分支 ∉ main 超 24h → 红（线上跑分支包，任何 main 构建部署将静默滚回——双包事故实证） | 已部署未合并超 24 小时=滚回倒计时，必须收口 | 收口链：验收 `accept --pass` → merge main → main 重建替换包（`tf.mjs deploy --branch main`）；ls 待验收块同步 ⚠敞口 标记 |
| I17 | 线上实况对账（本地触点版）：live-state jar.md5 vs 服务器实际 jar md5（ssh 只读；前提 project.json deploy 配置；ssh 不通/无配置=信息级跳过；CI/CD 到位后被流水线替代——2026-10-08 拍板不上服务器侧） | 登记的部署指纹与服务器实际文件一致，手工换包必被点名 | 红=未登记部署/手工换包 → `deploy-preflight --record` 补账 |
| I18 | （提示级；仅 active 任务——参与资格以 isVerifying() 为准：顶层 + deploy 双源，等验收态不参与）账实对账：①分支已并入任一主 ref（与 accept --pass 前置同源集合，含 baseBranch；须有 checkpoint 才报——零提交新任务分支==基线 tip 的 identity 祖先恒真，不算漏收口）= 疑似漏收口；②lastActiveAt 距今 ≥14 天且 activeLease 过期 = 疑似搁置 | 分支已并入但状态还活着=疑似漏收口；长期没动静=疑似搁置 | ℹ：①呈报验收简报（accept 是验收拍板，不可代理）或恢复开发；②直接 `park <id> --reason` 留档（可逆低影响，事后报告，v2.60.2 档位）或刷新续做；确认仍活跃则保持并刷新 lease |

## index.json（L1）

> **checkpoints 条目可选字段**：

- `type` —— `"checkpoint"`（缺省，任务分支上的存档点）| `"merge"`（合并事件标记：merge commit 在 main 上而非任务分支，I2 不与任务分支 tip 对比，改校验其已在主分支历史）。合并时把 merge commit 记一条 `type: "merge"` 保持时间线叙事完整。

**唯一事实源规则补充**：任务元数据（status / tier / sessionID / branch / worktree / checkpoints / activeLease）以 **task.json 为准**，index.json 是派生导航缓存。两处冲突时以 task.json 为准回写 index（resume 对账步骤、checkpoint 刷新时执行），**禁止只改一处**——实测漂移（撤销误标 merged 只改了 task.json，index 留着 merged；tier 降档只改一处）就是这么来的。

**机械保证（v2.19.0）**：「写后必同步」收进脚本——tf.mjs 内任何 task.json 写路径（commit 回填 sessionID / `--deployed` 翻转等）落盘后必须调 `syncIndexRow()` 派生同步 index（原子写、保留行内未知字段，语义同 reconcile 回写）。漂移在写路径上不可能发生，reconcile 退化为兜底而非日常救济。

```json
{
  "tasks": [
    {
      "id": "auth-refactor-20260913",
      "title": "重构认证模块",
      "status": "active",
      "tier": "medium",
      "branch": "task/auth-refactor-20260913",
      "worktree": "/abs/path/to/repo-auth-refactor-20260913",
      "sessionID": "ses_xxx",
      "createdAt": "2026-09-13T10:00:00+08:00",
      "lastActiveAt": "2026-09-13T18:30:00+08:00",
      "lastCheckpointCommit": "a1b2c3"
    }
  ]
}
```

status 取值：`active` / `verifying` / `parked` / `merged` / `archived`。

- `verifying` = 部署/用户验收进行中；只有用户最终验收通过才落 `merged`（翻转只经 `tf.mjs accept <id> --pass`，见下方状态机节）。git 合并发生在 verifying 之前还是之后，**以 conventions.md 的合并时序为准**（默认顺序=先合并后部署验收；验收先行项目=部署→验收→合并→翻转——两条路径共用同一状态机，区别仅 verifying 悬置长短）
- `parked` = **搁置中**（「先放放」的正式语义）：档案与分支保留、不计入活任务盘点（G 门/doctor 缺省/stale 均按 status 排除）；恢复只经 `tf.mjs unpark`，状态机两行见下。park/unpark 为低影响可逆簿记：编排层可直接执行、事后报告（v2.60.2 拍板；对照 SKILL.md 确认档位——accept --pass 验收拍板不在此列）
- `merged` = **终态**：已合并 + 用户验收通过 + 归档清理完成
- `archived` 任务生命周期**不再使用**（保留枚举仅为兼容旧记录）；仅 adopt 用于标记备份类分支/历史工作

## 状态机（唯一事实源；状态翻转只经脚本命令，**禁手改 status**）

> 散文禁独立描述状态变化，只允许引用本表行/命令名（lint 闸门把关）。反面实证：verify-first 曾散文宣称「中间无 verifying」，而 --deployed 机械扳机在部署时刻必翻 verifying——散文与扳机打架（2026-09-23 审查发现）。

| from | 事件（唯一写命令） | to | 前置 | 撤销路径 |
| --- | --- | --- | --- | --- |
| （无） | new-task 建档 | active | 用户确认标题/目标/档位 | 无产出 → 删分支+worktree+档案即撤 |
| active | 部署落定 `tf.mjs commit --deployed` | verifying | — | 分支未进 main：删分支即撤（分支含未合并提交，`-d` 会拒——撤销自家任务分支属**用户确认后**的 `-D` 例外，红线禁 `-D` 针对共享/他人分支）；已进 main：`git revert -m 1 <merge-commit>` |
| active | 验收通过（无部署约定项目）`tf.mjs accept <id> --pass` | merged | 任务分支已并入主分支（脚本 isAnc 强制） | `git revert -m 1 <merge-commit>` + 档案记 unmergedAt |
| active | 搁置 `tf.mjs park <id> --reason "<原因>"` | parked | status=active 且非等验收（isVerifying 双源：顶层 verifying 或 deploy.status=verifying 均拒——线上敞口须先收口，防 I16 语义冲突）；--reason 必填（非空白；--reason 后跟 flag = 缺值拒） | `tf.mjs unpark <id>` 即撤 |
| parked | 恢复 `tf.mjs unpark <id>` | active | status=parked | 再 park 即撤 |
| verifying | 验收通过 `tf.mjs accept <id> --pass` | merged | 任务分支已并入主分支（verify-first 先完成 merge.md §5 合并再翻转，脚本强制） | `git revert -m 1 <merge-commit>` + 档案记 unmergedAt |
| merged | `tf.mjs archive <id>` | 物理归层 archive/ | decisions 无未晋升条目 | 终态；续迭代走 resume.md 第 10 步（不复活旧任务） |

- **合并回退的合规路径**：硬规则 1 禁 reset --hard/force push → 撤回已合并代码只能 `git revert -m 1 <merge-commit>`（--no-ff 保证可 revert），档案保持 merged 终态叙事 + unmergedAt 注记；下一轮走 resume.md 第 10 步新任务，**禁手改 status 回 active**（merged→active 是状态倒退）。
- 翻转命令三源对照：active→verifying = `commit --deployed`；*→merged = `accept --pass`；归层 = `archive`。手改 task.json/index.json 的 status 字段 = 违规（I1 漂移根因，v2.18.2/v2.19.0 两次实证）。
- 机器可读源：scripts/taskflow-state-machine.mjs（v2.69.0——本表 7 行的代码镜像，tf.test.mjs 对账两者一致；宿主守门 J 墙快照同源，漂移由 mech check 兜底）。

## task.json（L2）

```json
{
  "id": "auth-refactor-20260913",
  "title": "重构认证模块",
  "goal": "一句话目标",
  "tier": "medium",
  "anchor": "managed",
  "status": "active",
  "branch": "task/auth-refactor-20260913",
  "worktree": "/abs/path",
  "createdAt": "...",
  "sessionID": "ses_xxx",
  "checkpoints": [
    {
      "ts": "2026-09-13T18:30:00+08:00",
      "commit": "a1b2c3",
      "summary": "完成登录表单校验",
      "files": ["src/auth/login.ts", "src/auth/types.ts"]
    },
    {
      "ts": "2026-09-14T10:00:00+08:00",
      "commit": "d4e5f6",
      "type": "merge",
      "summary": "merge: 任务合入 main（merge commit 标记）",
      "files": []
    }
  ],
  "subtasks": [
    {
      "id": "1-validate-form",
      "title": "表单校验",
      "status": "pending",
      "spec": "subtasks/1-validate-form/spec.md",
      "worktree": null,
      "branch": null
    }
  ]
}
```

**可选字段**（按需写入 task.json——不要只写 index.json，那里是缓存）：

- `activeLease` —— **会话租约（并发护栏）**：`{ "sessionID": "ses_xxx", "acquiredAt": "ISO8601", "heartbeatAt": "ISO8601" }`。语义：会话开始操作某任务时写入/每次 checkpoint 或实质动作时刷新 heartbeatAt；心跳超 30 分钟视为过期，其他会话**可接管，接管须在对话中报告**（「检测到 lease 属于会话 X，N 分钟前心跳，已过期/活跃，接管」）。它不是锁——最终裁决在对话确认，lease 只让「他会在途」可见。
- `note` —— 一句话备忘（谁在做、deviation、坑）；长叙事进 progress.md
- `kind` —— 任务性质标记（可选）：`"bugfix"` = bug 修复任务，merge 审查与 doctor I7 触发 defect→test 门禁（分支 diff 必须含测试改动）
- `scope_note` —— 范围收缩/移出记录（移出了什么、为什么）
- `baseBranch` —— worktree 基线分支，默认 `origin/main`；依赖另一任务未合并产物时 = `task/<id>`（见 new-task.md 第 5 步）
- `derivedFrom` —— **派生来源任务 id**（v2.41.0）：会话内从既有任务派生新任务时落档（话题衍生、验收中冒出的问题、链式基线开工、归档续迭代、adopt 收编可辨来源均算）。与 `dependencies` 分工：derivedFrom=叙事溯源（谁生的，ls 双列层级：一级列=簇头、二级列=派生，孤儿簇头自带源标注——v2.45.1）；dependencies=产物依赖说明（merge/rebase 顺序约束，doctor depHint 消费）。链式任务（baseBranch=task/*）两者都落，id 后缀 ⛓<src> 标记约束。
- `lastCheckpointCommit` —— 最新 checkpoint sha（与 index 同步刷新）
- `mergeSnapshot` —— **合并快照（MERGE_GATE 门一数据源，v2.58.0）**：`{ "commit": "<main HEAD 全哈希>", "ts": "ISO8601", "mainRef": "main" }`。写入扳机：`tf.mjs snapshot <task-id>`（审查呈报落稿后跑）；消费方：`tf.mjs mergegate <task-id>` 比对现值——不一致=红（他人已合入，回 merge.md 第 1 步同步重审）；无快照在档=红（fail-closed，v2.81.0——lock merge 授锁路径现场重算本门，缺档不再放行）。MVCC 事务 ID 类比：快照=审查时的读版本，比对=提交前确认没人插队。
- `baseCommit` —— **任务基线锚（STALE_CHECK 数据源，v2.59.0）**：`"<基线 commit 全哈希>"`（首个 tf.mjs commit 自动锚定 `git merge-base <基线ref> <任务分支>` 全哈希，已锚定不覆盖——与 goalHash 首锚同款模式；MVCC 事务开局 Read View 类比：任务开工时的 main 读版本）。消费方：`tf.mjs stale <task-id>` 影响面漂移检查（main 自基线改动 × 本任务读写集求交）。缺省 = 存量任务，stale 跳过并 ℹ 注记；基线 ref 解析序 = `baseBranch` ?? main/master/origin/main（本地优先，与 snapshotCmd 同源）。main 曾在首个 commit 前合入任务分支 → 锚点落在 merge 点（可接受：最早机械锚点，差集只会更小）
- `parkedReason` / `parkedAt` —— **搁置留痕（v2.60.0）**：park 命令写入的原因与时刻（原因写入时净化表格不安全字符：竖线/换行折叠为空格——ls 状态列渲染安全）；unpark 时两字段删除（叙事归 progress.md，编排层）。消费方：doctor I18 与 G 门/stale 天然排除（按 status 过滤）；ls 渲染原因摘要。
- `mergedAt` / `archivedAt` —— 状态落定时间戳
- `unmergedAt` —— 合并被 `git revert -m 1` 撤回后的注记时间戳（状态机撤销路径用；档案保持 merged 终态叙事，禁手改 status 回 active）
- `deploy` —— verifying 期间的部署状态，验收通过后随 merged 固化（此前只能塞 index 野字段）。**写入扳机（v2.19.0）**：`tf.mjs commit --deployed [注记]` 部署存档时机械写入——active→verifying 翻转 + deploy 落档 + index 同步一步完成，verifying 下重复调用仅更新注记（deployedAt 不重置），非 active 拒绝翻转：

```json
"deploy": {
  "status": "verifying",
  "deployedAt": "<ISO8601，部署完成时刻——ls 待你验收块与挂起天数的优先数据源，缺省回退 lastActiveAt>",
  "note": "<部署注记：版本/冒烟/回滚点一行速记>",
  "version": "1.2.1",
  "jarMd5": "…",
  "rollbackPoint": "app.jar.bak-<ts>",
  "smoke": "6/6",
  "coversTasks": ["example-task-20260915"]
}
```

- `goalHash` / `goalHashAt` —— **需求承重节锚定（REQ_BASELINE 对账数据，v2.23.0）**：spec「目标」+「验收标准」两节的规范化 hash（`[x]`/`[ ]` 归一、strip 空行）与锚定时刻。锚定 = 首个 `tf.mjs commit` 自动落档（已锚定不覆盖）；刷新唯一途径 = `tf.mjs req-confirm <task-id> --note "<需求变更门拍板记录>"`。doctor I11：spec 现算 hash ≠ goalHash → 红 = 存在未经变更门的需求修改
- `reqChanges[]` —— 需求变更确认记录（v2.23.0）：`[{ "ts", "hash", "note" }]`，每次经需求变更门拍板后由 req-confirm 落笔；I13 用最后一条对比 PRD 文件最后提交时刻（晚于 → ℹ PRD 疑未回写）

**老化分档（v2.19.0）**：挂起类信号（等验收 / active 无进展 / 游离工作）统一三档——`info ≤3 天 / warn ≤7 天 / action >7 天`（I6 按落后提交数 ≤5 / 6-15 / >15 分档，冲突税比日历更贴害处）。action 级条目由 ls 收拢进「⛔ 需你决策」块逐项点名拍板；分档只改呈现，不触发任何自动动作。

  `coversTasks`：多任务并集部署/合并验收时列出覆盖的全部任务 id，验收结果对齐生效，各任务 progress.md 互相引用留痕。

`sessionID` 语义 = **最近活跃会话**（定位提示，不是归属权证明）：多会话接力时随 resume 更新；完整接力史在 progress.md。匹配失败时列出任务让用户确认，**不得凭 sessionID 独断任务归属**（实测：一个会话跨两个任务时单值绑定直接错位）。

anchor 取值：
- `managed`：taskflow 新建（task/<id> 分支 + worktree），生命周期全管，归档时自动移除 worktree
- `attached`：挂靠用户现有分支/worktree——不迁移、不改名、**绝不自动清理**，merge 后资产归用户

subtask status 取值：`pending` / `in_progress` / `done` / `blocked`。

## services.json（L1，服务端口租约）

> 服务端口占用登记：跨任务/跨会话可见「哪个端口被谁占着」。**探测让位纪律**：启动 dev 服务前先 `tf.mjs svc claim`——被占（其他任务在测服务 / 旧项目遗留进程）→ 按脚本建议让位换端口，**绝不 kill 抢占**；测试完成 → 编排层停服 + `svc release` 释放（停服动作归编排层，脚本只簿记——读写边界）。文件与 index.json 同层（主仓库根 `.taskflow/`，worktree 经 locate() 共享主仓库注册表）；doctor I14 对账。

```json
{
  "services": [
    {
      "port": 9080,
      "service": "backend",
      "task": "service-port-lease-20260926",
      "session": "ses_xxx",
      "pid": null,
      "startedAt": "<ISO8601 claim 时刻>",
      "note": "<一句话注记>",
      "reclaimedFrom": "<仅回收死租约时写：原 pid>"
    }
  ]
}
```

- `pid` —— claim 时服务通常未启动，null = 预留位（ls 标注 `pid未登记`）；服务启动后补登：同 task 同端口重跑 `svc claim --pid <pid>` 即更新。pid 死 = `stale`（claim 端口实测空闲才自动回收）；task 不在 index = `orphan`（认领或 release）

## 任务目录布局

```
.taskflow/<task-id>/
├── task.json
├── spec.md          # 任务规格：目标/验收/约束
├── handoff.md       # 交接：目标、决策(含否决方案)、已完成、下一步
├── findings.md      # 研究结论、踩坑
├── progress.md      # 会话日志（每次 checkpoint 追加）
├── decisions.md     # 本任务固化决策（归档时沉淀到项目决策库）
└── subtasks/<n>-<slug>/spec.md
```

## 项目级文件

- `project.json` —— 项目身份（key、repoRoot、remote、git、createdAt、lastActiveAt）；v2.29.0 增 `assetExts`（'vue|ts|js' 竖线分隔的资产扩展名——mech install 渲染门脚本时注入；缺省按 git ls-files 探测 top6，可手工改）与 `mechanisms`（`{ "<机制token>": { "adoptedAt": ISO, "version": "x.y.z", "assetExts": "…" } }`——采纳登记，doctor 采纳对账据此核对产物存在性）

- `project.json` `deploy` 节 —— **部署唯一入口的命令配置（v2.42.0 四件套①）**：`{ server, statePath, jarPath, commands[], webCommands[]?, procProbe? }`。`tf.mjs deploy --branch <B>` 读此配置执行：lock deploy 互斥 → deploy-preflight 门禁（红=拒绝）→ 逐条执行 commands（`--web-only` 时执行 webCommands）→ ssh 实测新包 md5 自动 `--record` 登记。命令序列须自带备份步骤（`app.jar.bak-<ts>` 回滚点）。`procProbe` 可选=进程/容器清点探针命令（v2.62.0，透传 preflight `--proc-probe`，行协议见 deploy-gate.md；无配置=信息级跳过——探针命令属项目侧事实）。无此配置 deploy 入口拒绝执行并打印配置模板——各项目部署命令异构，全部收敛进配置（通用性：新项目配一次即用）。
- `project.json` `deployment` 节 —— **项目部署形态元数据（v2.88.0 建档，载体=new-task.md 首次初始化提问检查单）**：`{ tier, environments, verify }` 三键。**三键必须经用户确认后落盘，禁默认值、禁替用户选、未答不落盘**（deployment 节整体缺省合法——未问答的存量项目与小项目）。**schema 真身=references/schemas/project.schema.json（v2.89.0，DEPLOYMENT_PROFILE）**——三键枚举/minLength/已知节白名单/验证分级注解唯一出处，doctor 校验与 lock merge/deploy 验证分级行同源消费，此处不复述枚举值防第二份抄写漂移；消费场景=验证/部署方案分级（①文档配置直接合 ②共享测试套 ③临时实例+干净数据副本 ④任务级完全隔离缓做，枚举→分级映射住 schema 文件 `x-deployment-grades` 注解）。
- `adopt-ignore.json` —— 收编忽略清单：用户选择忽略的分支/worktree 及原因；**支持前缀模式**（如 `superdx--*`，一条忽略其他工具批量 worktree）；adopt **与 resume 游离扫描**都跳过清单内条目
- `conventions.md` —— **项目约定（唯一事实源）**：推送与部署、验证清单、完成定义、环境与端口注意事项、禁止事项。跨任务存活；项目初始化时引导生成，口述新约定随时写入；红线摘要同步至项目根 `AGENTS.md`（OpenCode 每会话自动注入，双保险）
- `decisions/` —— **项目决策库**（`YYYY-MM-DD-<slug>.md`）。任务会结束，决策留在项目——**改类似功能之前先查这里**。注意：部署/验收类约定只住 conventions.md，不要重复记入决策库
- **产物住址约定**（v2.16.0）：已拍板的 PRD/用户故事住 `docs/prd/<域>/`、设计文档住 `docs/design/<域>/`——**进 git**（团队共享拍板产物）；任务内设计稿/原型住 `.taskflow/<id>/design/`（**主仓库根相对路径**——审查子代理在任务 worktree 工作，读取时按主仓库根解析）或独立 clone——不进 git。决策库（`.taskflow/decisions/`）进 git 的开关机制属专项待办，未实现前维持本地

## 机制登记表（触点可达性——lint「死规则」检查的数据源）

> 每个机制一个唯一 token。**触点列为空、或 token 未字面出现在触点文件 = 死规则 = lint 红**（反面实证：LEASE 与 `.owner.json` 曾有 schema 定义 + doctor 检查、零流程触点——写入口/刷新点/接管仪式无一处接线，机制等于不存在，2026-09-23 审查发现后补线）。**新机制 = 登记行 + 触点接线同一变更交付**（DoD 见 induction.md）。

| token | 定义处 | 触点（token 须字面出现在文件内） | 采纳产物（mech install 生成，doctor 采纳对账的谓词） | fixture 落痕（tf.test.mjs / I<N> / —<理由>，lint 检查） | 检测 | 大白话（解释人工抄写源，lint 非空检查——不自动进门脚本词表，2026-10-10 对齐实现） |
| --- | --- | --- | --- | --- | --- | --- |
| PROTOTYPE_STALE | templates/spec.md 产物链节 | new-task.md, merge.md, templates/spec.md, prototype.md | — | —（实现/派发门禁，prose 触点；无 CLI 断言面） | 实现/派发门禁（双设） | 原型没有用户确认记录就往下做实现——流程直接拒绝，防止做完才发现方向早错了 |
| --deployed | data.md deploy 字段 | merge.md | — | tf.test.mjs | commit --deployed（状态机唯一翻转命令） | 把「代码已部署到线上」写进任务档案的动作，任务状态同时翻到「等验收」 |
| LEASE | data.md activeLease 字段 | checkpoint.md, resume.md | — | I9 | doctor I9 | 会话之间的「我正在用这个任务」登记，防止两个会话同时改一个任务 |
| PARK | data.md 状态机表 parked 两行 + parkedReason/parkedAt 字段行 | resume.md, tf.mjs, tf.test.mjs | —（技能内命令，无项目侧渲染产物） | tf.test.mjs | tf.mjs park/unpark（簿记写入口，状态翻转+syncIndexRow） | 给「先放放」带原因的正式状态：G 门/体检/stale 不再空跑悬挂任务，且搁置与遗忘可区分 |
| .owner.json | data.md I10 行 | new-task.md, resume.md | — | I10 | doctor I10（pid+started_at 双判据，v2.29.0） | worktree 属主凭证文件，记录哪个进程在哪个目录干活 |
| 接管仪式 | resume.md 第 8 步 | resume.md, checkpoint.md | — | tf.test.mjs | takeover 命令 | 原属主进程已死时，新会话接手任务前的一套登记动作：改属主、刷新登记、清点桌面 |
| STUCK升级门 | merge.md 第 3 步 | merge.md, split.md, prototype.md | — | —（merge 门禁，prose 触点；打转保护无 CLI 断言面） | 硬门（第 3 轮强制升级，打转保护） | 同一个问题修 3 轮还不过，强制停下来让用户拍板换路，不许默默试第 4 轮 |
| MERGE_LOCK | merge.md 第 5 步 | merge.md | — | —（由 lock 命令测试承载，token 本身无断言面） | tf.mjs lock（排队锁，ttl 120s 陈旧强占） | 合并动作的排队锁：两个会话同时要合并时一个排队，防止互相踩 |
| REQ_BASELINE | templates/spec.md「需求基线」节 | new-task.md, resume.md, merge.md, templates/spec.md | — | I12 | doctor I12 + merge 阶段一三链核对 | spec 里必须写清需求出自哪份 PRD 文档哪条，防止需求来源失传 |
| req-confirm | data.md goalHash/reqChanges 字段 | SKILL.md, resume.md, merge.md | — | tf.test.mjs | tf.mjs req-confirm（写入口）+ doctor I11 | 需求口径变更的登记命令：把「谁拍板改了什么」写进档案，刷新需求指纹 |
| 问答管线 | references/qa.md | SKILL.md, qa.md, domain.md | — | —（会话行为管线；机械面=lint 触点可达，真实会话审计承载） | lint 触点可达（意图识别表路由 + 硬规则 15） | 用户问代码/领域问题时，先复述「我理解你在问什么」再探索作答的固定流程 |
| services.json | data.md「services.json」节（服务端口租约） | new-task.md, resume.md, merge.md, templates/conventions.md | — | I14 | doctor I14 + tf.mjs svc（claim/release 簿记写入口） | 本地服务端口租约表：防止两个会话的开发服务抢同一个端口 |
| 需求变更门 | SKILL.md 反馈分类（隐性升级行） | SKILL.md, merge.md | — | —（SKILL 拍板门；落痕由 req-confirm/reqChanges fixture 承载） | 拍板后 PRD+spec 同步改 + req-confirm 落痕 | 验收标准和 PRD 原口径冲突时，必须先呈报「原口径→新口径」让用户拍板才许动工 |
| STYLE_SOURCE_GATE | references/style-source.md（真源结构/双门/大白话模板/延迟初始化） | new-task.md, merge.md, prototype.md, templates/conventions.md, SKILL.md 硬规则 20 | scripts/harness/validate-style-source-gate.sh | tf.test.mjs | validate-changelog 并联门 + mech install + doctor 采纳对账 | 样式真源门：已定稿的样式要改之前，必须用大白话呈报「现在→改成→为什么」让用户拍板并留痕 |
| 决策组合门 | SKILL.md 硬规则 16① | SKILL.md, new-task.md, merge.md, templates/conventions.md, assets/harness/ | scripts/harness/validate-decision-combo-gate.sh、scripts/harness/validate-changelog.sh | tf.test.mjs | tf.mjs mech install（生成式安装）+ doctor 采纳对账 + 项目侧收尾必跑 | 新改动和既有拍板决策拼在一起可能产生没人解释过的界面状态，这道门强制逐条评估这些组合 |
| 感知层验收 | SKILL.md 硬规则 16② | SKILL.md, merge.md, prototype-selfcheck.md, templates/conventions.md | — | —（自查维度 prose；项目侧测试断言承载） | 不可解释状态（开放类）自查维度 + 验收项解释载体断言（项目镜像 AGENTS.md 测试规范表） | 界面行为验收不能只测数据对不对，还要测每个状态用户能不能看到解释它的文案 |
| DESIGN_SPEC_EXTRACT | SKILL.md 硬规则 19 | SKILL.md, prototype.md, new-task.md, split.md, merge.md, prototype-selfcheck.md, domain.md, templates/spec.md, templates/subtask-spec.md | scripts/harness/validate-design-spec-gate.sh、scripts/harness/validate-changelog.sh、scripts/design/extract-spec.js | tf.test.mjs | tf.mjs mech install（生成式安装）+ doctor 采纳对账 + validate-changelog 串接收尾必跑 | 原型定稿后机器逐元素提取规格表（位置/颜色/间距），实现只认规格表、禁止凭记忆转述原型 |
| DEP_ASK_GATE | SKILL.md 硬规则 22 | SKILL.md, new-task.md, domain.md | — | —（问答门 prose 触点；检测面 = tf.mjs skills exit code 承载） | lint 触点可达 + tf.mjs skills（exit 1 = 有缺）+ 采纳版本对账（统一谓词单点 v2.65.0：mech check / mech ls / doctor 采纳对账三口同源点名陈旧快照，2026-09-30 拍板；mech install 幂等早退带版本门——落后必刷回，漂移刷新/整文件覆盖已有文件过 --yes 确认闸） | 外部依赖先检测再用：缺了必须列清单问用户装不装，禁止默默降级照跑 |
| APP_PAGE_BASELINE | SKILL.md 硬规则 21 | SKILL.md, prototype.md, new-task.md, prototype-selfcheck.md, style-source.md, merge.md, templates/spec.md, templates/subtask-spec.md | scripts/harness/validate-app-baseline-gate.sh、scripts/design/extract-app-baseline.js | tf.test.mjs | mech install + doctor 采纳对账 + validate-changelog 串接收尾必跑 | 改现有页面前先机器提取线上现状快照，原型必须基于现状做增量，禁止从零重画整页 |
| DEPLOY_GATE | references/deploy-gate.md（细则唯一载体：预检/基线登记/租约/让位/验收即合并；v2.42.0 四件套=部署唯一入口 deploy+conventions 接线+I16 敞口+I17 实况对账） | SKILL.md, merge.md, deploy-gate.md, tf.mjs deploy（分发区） | scripts/harness/deploy-preflight.mjs、scripts/harness/credential-probe.mjs | tf.test.mjs | mech install + doctor 采纳对账 + `tf.mjs deploy`（门禁内嵌唯一入口）+ doctor I16/I17（敞口/实况对账） | 部署协调门：防止两个任务互相覆盖部署的一组检查（线上现行版本已包含、等验收者让位、事后对账） |
| DEPLOY_ENTRY | SKILL.md 硬规则 23（v2.42.0 四件套①：部署唯一入口） | SKILL.md, merge.md, data.md, tf.mjs deploy（分发区） | —（deploy 命令住技能本体 tf.mjs；项目侧只需 project.json deploy 配置） | tf.test.mjs | mech install（conventions/AGENTS 补记「部署必经入口」条款）+ `tf.mjs deploy` 门禁内嵌 + doctor I16/I17 | 部署唯一入口命令：所有部署必须从它走，绕过它等于没登记，对账检查必红 |
| DEPLOYMENT_PROFILE | references/schemas/project.schema.json（project.json JSON Schema 真身：已知节白名单+deployment 三键枚举+verify minLength+x-deployment-grades 分级注解，v2.89.0） | merge.md, deploy-gate.md, new-task.md | —（技能内门：schema 真身与解释器住技能本体；guard 弹脸的枚举经 mech install 渲染期注入渲染副本） | tf.test.mjs | doctor project.json schema 校验（未注册节/出枚举/verify 占位=红，节缺省=ℹ 可建档补问）+ lock merge 授锁路径与 deploy 门禁「验证分级」行（映射读 schema x-deployment-grades） | project.json 的配置字典只有一个出处：哪些节合法、deployment 三键怎么填、什么形态对应什么验证档次都照它说话——改枚举只改 schema 一处，doctor 和两道门同时变 |
| PLAIN_SPEECH_GATE | SKILL.md 硬规则 24 + references/plain-speech.md（双层要求/骨架选型/呈报稿模板唯一载体） | SKILL.md, qa.md, resume.md, merge.md, deploy-gate.md, new-task.md, induction.md, plain-speech.md, glossary.md | —（技能内门：门脚本住技能仓 assets/harness/，呈报稿住项目 `.taskflow/<id>/briefing-*.md`，无项目侧渲染产物；项目词表 `.taskflow/glossary.md` 为可选增强层，v2.43.1） | tf.test.mjs | validate-plain-speech.mjs（行话裸奔/代号裸奔/超长句；词表=glossary.md+登记表 token 列+项目 .taskflow/glossary.md 自动发现合并）+ lint 本表「大白话」列非空 | 面向用户输出门：正式呈报先落稿过「说人话」检测，行话没解释或句子太长机器打回，绿了才给人看 |
| TASKFLOW_GUARD | references/taskflow-guard.md（细则唯一载体：十五功能/部署墙+编辑边界两套档位/零干扰边界/卸载） | taskflow-guard.md, deploy-gate.md, split.md | .omp/hooks/pre/taskflow-guard.js | tf.test.mjs | mech install 渲染（产物=omp extension）+ mock pi 真执行夹具（硬规则 17）+ doctor 采纳对账 + V 渲染证据提醒夹具（TF_V_WARN=off 关，提醒不拦） | 宿主防护层：把 taskflow 关键规则从「模型记得做」降到 omp extension 宿主层——状态栏常显进行中/等你验收/已上线超24小时未合并（v2.56.0 人话化）、簿记参数调用即红、压缩摘要自动带接力线索、每轮注入输出规范（术语首现后跟括号大白话+项目词表）、部署特征命令拦截、派发 spec 机械注入（凭记忆转述失效）、越界编辑拦截、子代理报告（task-result）含阻塞/blocker/卡点字样返回人话三问提醒（v2.61.0 来源限定：普通对话/图例/自家提醒不触发；声明可能猜错、不拦操作）、词表反馈沉淀（检测「看不懂」类反馈计数、词表改写消账、逐轮催+压缩兜底，v2.57.0） |
| CLASS_SWEEP_GATE | SKILL.md 硬规则 25 + references/testing.md §十（扩散三问/触发点/产出契约/与 §八分工——细则唯一载体） | SKILL.md, merge.md, testing.md, taskflow-guard.md, new-task.md | —（机械检查内嵌 validate-changelog.sh：修复类条目【触发词十三式 修复的bug/修复 bug/修复了/缺陷修复/修复缺陷/修 bug/bug 修复/bugfix/bug-fix/fix(es) 带宾语/fixed 带宾语(英文搭配)/热修/hotfix，大小写不敏感，含标题行——标题触发检查，行级满足检查只扫条目正文】条目块内须含「同类排查：」+「出现次数」，仅检锚点之上受管区——随决策组合门 mech install 交付；宿主提醒走 TASKFLOW_GUARD H） | tf.test.mjs | validate-changelog.sh 同类排查条目级检查（收尾必跑）+ TASKFLOW_GUARD H 宿主提醒 + merge.md 第 3 步修复循环核对（扩散面清单缺 = 阻塞项） | 同类排查门：修一个 bug 前先答三问——上游输入干净吗、下游要不要同步、同类还有几处；答完留痕才许动手修 |
| MERGE_GATE | references/merge.md 第 5 步（快照门+越界门+渲染证据门接线，细则唯一载体）+ tf.mjs snapshot/mergegate 命令（门一文件级分类：黄=免重审/红=命中读写集逐文件重审，v2.59.0；无快照 fail-closed v2.81.0） | merge.md, tf.mjs, tf.test.mjs | —（技能内门：命令住 tf.mjs，无项目侧渲染产物） | tf.test.mjs | mergegate 三门（快照比对+文件级分类 matchPath+diff 对照声明集+渲染证据 v2.81.0）+ merge.md 第 5 步接线（mergegate → lock merge 授锁路径现场重算三门纯函数（快照 fail-closed/越界/渲染证据——零消费落盘门状态，.gate-state 落盘校验随 2.81.0 移除）→ merge） | 合并三门：①main 在你审查后动过没——动过但没碰你的读写集=只同步+刷新快照（免重审），碰了=逐文件重审再合，没拍快照=红（缺档不放行）；②你的改动超出声明的文件范围=红；③改了样式却没交渲染证据=红 |
| STALE_CHECK | merge.md 第 5 步（合并落定后全量扫接线）+ resume.md 第 5 步（接管/resume 对账接线，细则唯一载体）+ tf.mjs stale 命令 | merge.md, resume.md, tf.mjs, tf.test.mjs | —（技能内命令，无项目侧渲染产物） | tf.test.mjs | tf.mjs stale（main 自 baseCommit 改动 × 任务读写集求交，只读不改任何状态；无基线锚/分支已并入/无机读声明均 ℹ 降级，git diff 失败按 ⚠ 不判新鲜） | 在途任务的影响面体检：主线改过的文件和你在做的任务有没有重叠，重叠=你的假设过期了，先重验再动工 |
| DISPATCH_OVERLAP | split.md 隔离判定表（场景① 并行前置预检，细则唯一载体）+ tf.mjs overlap 命令 | split.md, tf.mjs, tf.test.mjs | —（技能内命令，无项目侧渲染产物） | tf.test.mjs | tf.mjs overlap（子任务 spec「## 涉及文件」反引号路径两两 matchPath 求交，只读） | 并行开工前的地盘检查：两个子任务要改同一批文件就不许并行，先查出来再派活 |
| 可行性门 | references/new-task.md 第 3 步（三问+红线清单，细则唯一载体） | new-task.md, stages.md | —（prose 门：判定归编排层，无项目侧渲染产物） | —（prose 门无脚本；lint 触点可达承载） | lint 触点可达（本表触点列） | 开工前三问：需求有没有着落、改动能不能本仓库闭环、依赖齐不齐——把注定卡死的需求拦在建工作目录之前 |
| 找茬自审 | references/domain.md「找茬自审」段（三类高危决策+自答三问，细则唯一载体） | domain.md, new-task.md, stages.md | —（prose 门：判定归编排层，无项目侧渲染产物） | —（prose 门无脚本；lint 触点可达承载） | lint 触点可达（本表触点列） | 高危决策（跨模块/并发幂等不变量/不可逆）确认前自己挑自己的错：最可能错在哪、没说出口的假设、没管的边界 |
| 施工纪律 | references/split.md「施工纪律」块（粒度红线/依赖图排序/垂直切片/验证锚点+内聚豁免，细则唯一载体） | split.md, new-task.md, templates/subtask-spec.md, stages.md | —（prose 门：判定归编排层，无项目侧渲染产物） | —（prose 门无脚本；lint 触点可达承载） | lint 触点可达（本表触点列） | 写实现步骤的四条规矩：别一步摊太大、先地基后楼层、每步做完系统都能跑、隔几步设个验证点 |
| DOC_SYNC_GATE | SKILL.md 硬规则 26 + qa.md 第 2 段统一源路由（写侧读侧细则） | SKILL.md, merge.md, qa.md | —（机械检查内嵌 validate-changelog.sh：涉及功能代码条目须含「文档同步：」行，延迟激活=锚点「文档同步门落地」，随决策组合门 mech install 交付） | tf.test.mjs | validate-changelog.sh 文档同步行检查（条目级，收尾必跑链）+ qa.md 读侧路由 | 功能代码改了，收尾必须回答「文档跟了吗」——更新了哪条写哪条，确实没变写一句理由，缺了收尾红灯；边界问题先查项目功能地图，没有的查完代码补上 |
| REQ_ANCHOR_GATE | SKILL.md 硬规则 27 + references/merge.md 第 3 步（--spec 五检查+门红分流表，细则唯一载体）+ templates/spec.md「基线外条目草案」节 | SKILL.md, new-task.md, merge.md, templates/spec.md, templates/subtask-spec.md | scripts/harness/validate-baseline-anchor-gate.sh、scripts/harness/validate-changelog.sh | tf.test.mjs | validate-baseline-anchor-gate.sh 双模式（--spec 五检查挂 merge 阶段一，红=阻塞项；默认两检查随 validate-changelog 收尾必跑串接）+ mech install 延迟激活（锚点「基线对照门落地」+ PRD 根住址）+ doctor 采纳对账 | 每条验收都要回答出自 PRD 哪一条，答不出就先问用户要不要新增 PRD 条目，不许默默做了不留档 |
| RENDER_EVIDENCE_GATE | SKILL.md 硬规则 11（视觉变更判定不由模型自判段，2026-10-27 看板字体失调两次打回沉淀） | merge.md, validate-changelog.sh, tf.mjs, tf.test.mjs | scripts/harness/validate-render-evidence.sh | tf.test.mjs | 三路径夹具（样式 diff 无证据=红/无样式 diff=绿/非任务上下文=绿）+ lock merge 现场重算门例（无快照拒/三门绿授锁/伪造落盘零消费/证据门无证据拒/补 png 授锁，v2.81.0 升授锁硬门） | 渲染证据哨兵：改了样式就必须在任务档案交真实渲染的截图或量测记录，防「几何指标全绿但页面没人看过」 |
| RELEASE_CHAIN | tf.mjs release 命令（发版十步链单入口：前置 fail-fast/版本双点自动改/lint/回归/commit/push/六路径同步/HEAD 对账/机制刷新/审计提示，managed-skills/taskflow-release-sync 配方固化，v2.90.0） | README.md, tf.mjs, tf.test.mjs | —（技能内命令，无项目侧渲染产物） | tf.test.mjs | tf.mjs release（--dry-run 计划零执行+幂等断点续跑；Windows 侧 bundle 配方（pull/fetch 直连三死路）、WSL 实体仓 fetch+ff-only；push 败重试一次+ls-remote 远端哈希确认；机制清单读 project.json.mechanisms 非硬编码） | 发版十步打包成一条链：改完代码写好 CHANGELOG 条目后一条命令完成版本双点、校验、提交推送、四实体仓同步与项目侧机制刷新——漏步靠机器不靠记性（同步欠账实证：chore 提交跳过六副本同步，靠发版后审计才抓到） |
