# 宿主防护层（TASKFLOW_GUARD）

> 机制定义（data.md 机制登记表 / MECH_PROSE）。本文件是细则唯一载体：功能清单（D–W+DP 十六项）、部署墙/编辑边界/状态翻转墙档位、零干扰边界、卸载。
> 防的事故类：taskflow 是技能，一切强制力都要经模型一次正确执行——`commit --files` 逗号坑连环踩、`deploy` 忘 `--web-only`、绕过部署入口、敞口无感知、压缩丢上下文、**派发凭记忆转述 spec、越界编辑**，全是"模型没记得/没做对"。omp extension 跑在宿主进程事件总线上，模型物理绕不过（2026-10-09 用户拍板，方案呈报 D→B→C→A 顺序；同日 F/G 拍板——split.md 纸面纪律升格宿主层）。

## 形态与安装

- 源模板住技能仓 `assets/guard/taskflow-guard.js`；`node tf.mjs mech install TASKFLOW_GUARD` 渲染到项目 **`.omp/hooks/pre/taskflow-guard.js`**——omp ambient 发现（pre/post 目录）自动加载，无需任何配置。
- 定位 `.taskflow/` 用 `git rev-parse --git-common-dir`——worktree 内会话正确回到主仓库档案。
- **零干扰边界**：项目无 `.taskflow/` 时全部功能静默（状态栏不显示、无拦截、无注入）——通用项目可装可不装。

## 功能清单（D–W+DP）

| # | 功能 | 事件 | 行为 |
| --- | --- | --- | --- |
| D | 状态栏常显 | `session_start` / `turn_end` → `ctx.ui.setStatus('tf', …)` | `tf:进行中N 等你验收M ⚠K个已上线超24小时未合并`（v2.56.0 人话化，原 `N活 M待验收 ⚠敞口K`）——最后一项=verifying 已部署超 24h 未合并（I16 同口径），从"跑 ls 才见"变"常驻底栏" |
| B | 簿记校验 | `tool_call`（bash） | `--files a.md b.md` 空格分隔多文件 → **block**（逗号分隔才对，调用即红）；`tf.mjs deploy` 入口形态（v2.52.0 锚定：`tf.mjs deploy` 紧邻调用，deploy-preflight / lock deploy / grep 只读提及不触）缺 `--web-only` 且 project.json 配了 webCommands → additionalContext 提醒（jar-only 合法，不拦；`--dry-run` 演练豁免） |
| C | 压缩接力注入 | `session.compacting` 返回 `{ context }` | 压缩摘要自动携带活任务 id/状态/分支 + 恢复入口——铁律「先存档再跑」的宿主兜底 |
| A | 部署墙 | `tool_call`（bash） | rsync/scp 带 `/opt/`、`.jar`、`/web` 特征，或 ssh+systemctl restart/stop/reload → 疑似绕过部署唯一入口（DEPLOY_ENTRY）。**分段判定（v2.52.0）**：按 `&&`/`;`/换行 切段逐段查——段是 `tf.mjs deploy` 入口调用则放行该段，非入口段命中部署特征即警/拦（旧全串放行可被「入口调用 && rsync 夹带」整体绕过） |
| E | 输出规范注入 | `before_provider_request` | 每轮把「双层输出规范 + 项目词表」前置进请求（system 角色消息；Anthropic 形传输回落 payload.system）——非 taskflow 会话也有叙事体+结构化底线；**词表活读**（.taskflow/glossary.md 每轮现读），词条改写下一轮即生效 |
| F | 派发门 | `tool_call`（task） | 派发词引用 spec 路径（`.taskflow/<id>/subtasks/<n>/spec.md`）→ 校验必填节后 **`{input}` 机械注入 spec 全文 + worktree 路径 + 范围纪律 + 原派发词**——编排层凭记忆转述物理失效（split.md 自包含纪律）；引用了 spec 但文件缺失/必填节空 = **无条件 block**；未引用 spec = 提醒不拦（调研/审查类派发合法，三场景管制②③） |
| G | 编辑边界门 | `tool_call`（edit/write） | 编辑路径归属任务后对照声明清单（任务 spec「边界与影响面」+ 全部 subtasks「涉及文件」），越界默认警告 / `TF_BOUND=enforce` 硬拦——单一职责与爆炸半径的机械不变量 |
| H | 同类排查提醒 | `context`（v2.49.1 事件面重设计——活体实证 tool_result(task) 只有 spawn 回执，子代理报告以 task-result 消息进链） | 尾部消息（末 3 条）中「task-result 报告（v2.61.0 来源限定：信封标签带/不带属性均认，不判 role）含 blocker/阻塞/blocking/卡点 特征」→ 追加一条提醒消息（v2.56.x 人话化：开头声明「可能猜错，不拦任何操作」，三个问题=同类排查 CLASS_SWEEP_GATE 上游/下游/同类，术语带括号白话；报告说「无阻塞」或仅讨论词语本身可忽略）——**幂等**（尾部已有提醒标记跳过）、**只提醒不拦**；普通对话/工具图例/自家提醒不含该标签不触发（v2.61.0 切断自我喂养）；非 taskflow 项目静默 |
| I | 词表反馈沉淀 | `context`（检测）→ `before_provider_request`（注入）→ `tool_call`（消账）＋`session.compacting`（兜底） | user 角色消息命中强信号词（看不懂/没看懂/看不明白/读不懂/没明白/不明白/什么意思/说人话/讲人话/太术语；「人话」单词不单列——问原理也命中，2026-10-11 实证）→ 字符串 Set 去重计数；词表未改写（pending>0）则 E 通道逐轮注入沉淀指令，write/edit 落 `.taskflow/glossary.md` 即消账（宽松判定不校验内容）；压缩兜底一行——「反馈→沉淀」宿主闭环（v2.57.0；纯 advisory 可能猜错不拦操作；多项目会话计数为实例级合计，注记）；v2.69.0 起 E 注入尾部追加「taskflow 实况：活/等验收（部署短格式）/挂起」一行（collectLive 分桶，verifying 双源口径） |
| J | 状态翻转墙（v2.69.0） | `tool_call`（edit/write/bash） | task.json/index.json 的 status/deploy.status **手改 = 物理拦截**：edit/write 做「翻转前后」语义比对（磁盘内容字面替换模拟 edit；坏 JSON 视同违规；新建档案仅 status=active 放行），bash 重定向/tee/sed -i 触及任务档案且不含 tf.mjs 直接按档拦——翻转唯一合法写路径 = 扳机命令，档案修复唯一路径 `reconcile --fix` |
| K | 验收期 git 提醒（v2.69.0） | `tool_call`（bash） | 在档等验收任务（isVerifying 双源且顶层非 merged）存在时 `git push`/`git merge` → additionalContext 提醒核对 conventions.md 合并时序——**只提醒不拦**（部署服务器拉取 push 属合法流量；`TF_VERIFY_WARN=off` 关） |
| T | 技能加载埋点（v2.69.0） | `tool_call`（read） | `skill://` 显式读取计数入全局单文件（`TF_SKILL_USAGE` 或 `~/.omp/agent/skill-usage.jsonl`）——零内容仅计数（只记技能名与项目名），供 `tf.mjs skills --usage` 报表；**不受 guardOn 闸控**（全局能力地图数据），handler 整体吞错（omp hook fail-closed：抛错=阻断读取，埋点绝不能拦主流程） |
| U | 状态引导注入（v2.84.0） | `before_provider_request`（E 同通道追加） | 每轮把状态机「下一步动作+禁令」引导行（active=改动先 checkpoint、收尾走 merge 流程；verifying=验收只经 accept --pass、禁自行合并；parked=恢复只经 unpark，原因摘要换行/竖线折叠+20 字截断）+ active 任务未完成子任务清单（status≠done；in_progress 标注（进行中）；>8 项折叠为「…共 N 项未完成」）前置进请求（system 角色消息；Anthropic 形传输回落 payload.system；2.84.1 修复——旧 p.system 写入在真实 payload 无 system 键下被传输层丢弃=静默 no-op）——治长会话指令稀释（字段住懒加载 references 从未被读，2026-10-28 审计实证；注入只放浓缩指令，禁指路型提醒）。顺序 active→verifying→parked，桶空省略、三桶全空不输出；「，本会话」标注=task.json.sessionID 与会话文件名（去 .jsonl）整名相等或下划线后缀（uuid 段）相等——不匹配降级无标注（2.84.1 修复：旧精确相等在时间戳_uuid 文件名形态下恒不命中=标注永不亮）；内容逐字节稳定（cache warming byte-identical，禁每轮变化源）；`TF_STATE_INJECT=off` 关（保留实况行=回退 2.83.0 行为）；状态指纹（三桶 id→status 串）变化且同 id 两轮状态不同 → 写触发日志（gate=state-inject，每任务一行） |
| V | 档案删除告警（v2.71.0） | `tool_call`（bash） | rm 触及 .taskflow/ 档案 → 告警（`TF_RM_WARN`=enforce 硬拦/off 关，缺省 warn）——档案不可逆删除风险，触发写 gate=archive-rm |
| DP | deployment 落档校验（v2.89.0） | `tool_call`（edit/write） | 写 `project.json` 带 deployment 键 → 值出枚举/verify 占位 = **block**（三键须用户确认：禁默认值、禁照抄示例、未答不落盘；理由话术中的合法值由渲染期注入的 schema 枚举生成——单源=schema 真身，注入失败降级提醒不判值）；gate=deployment-profile |
| W | 牵连排查+数据边界提醒（v2.72.0） | `tool_call`（edit/write） | 主名整词命中 ≥`TF_IMPACT_THRESHOLD`→影响面清单提醒（`TF_J19_WARN`）；数据管道特征→真空失真枚举提醒（`TF_J20_WARN`）；gate=impact,data-boundary |

## 部署墙两档模式（A）

- **默认警告**（additionalContext 注入提醒）：零误伤观察期——先跑稳，收集误报再收紧。
- **`TF_WALL=enforce`**：硬拦 `{ block: true }`——项目确认观察稳定后写入 conventions（服务器 .env 或会话环境）。
- **`TF_WALL=off`**：单次跳过（人工回滚/特殊运维），事后须留痕（progress.md 记一行）。

## 编辑边界两档模式（G）

- **默认警告**（additionalContext）：清单是 best-effort 解析（spec bullet 约定），漏写文件的误报先观察。
- **`TF_BOUND=enforce`**：硬拦——观察稳定后写入 conventions。
- **`TF_BOUND=off`**：单次跳过，事后 progress.md 记一行。

## 状态翻转墙三档模式（J，TF_STATUS，v2.69.0）

- **缺省 enforce**：手改 status 无合法场景（data.md 状态机表：翻转唯一写路径 = `commit --deployed` / `accept --pass` / `park` / `unpark` / `archive`），档案修复唯一路径 `node tf.mjs reconcile --fix`。
- **`TF_STATUS=warn`**：警告放行（additionalContext）。
- **`TF_STATUS=off`**：单次豁免。
- 判定细则：edit 用「磁盘内容字面替换模拟」取新值（替换不命中 = 新内容 = 旧内容 = 放行）；顶层 status 或 deploy.status 任一变化即翻转；新建档案仅 status=active（且不带 verifying 部署态）放行。机器快照 STATE_SNAPSHOT 与 `scripts/taskflow-state-machine.mjs`、data.md 状态机表三处同源——改状态机三处同步，版本漂移由 mech check 兜底。bash 通道无法做语义比对（整文件覆盖），触及任务档案即按档处理。

## F/G 判定细则

- **F 必填节**：subtask spec = 背景（含「背景（一句话）」变体）/目标/验收/涉及文件/约束与禁止，五节非空（注释与 `<占位符>` bullet 不算内容）；任务级 spec = 目标/验收标准两节（整任务派发场景轻校验）。spec 路径解析：绝对路径原样，相对路径先按主仓库根（`.taskflow/` 所在）再按会话 cwd。
- **G 归属判定**：worktree 前缀匹配；兄弟子任务 worktree（`<task-worktree>-<n>-<slug>`，数字段收紧防 `-backup` 类同名误归因）→ base 取**子 worktree 根**（base 取任务 worktree 会让相对路径恒以 `..` 开头、被守卫放行成死路——审查实证）；worktree 事实源=task.json（index 缺字段兜底读档，I1 纪律）。主仓库内编辑且仅一个活任务 → 归它；**多活任务×主仓库编辑 = 并集比对**（v2.49.1 活体热修——旧「归属不明放行」在 status 悬挂脏数据下变成主路径永久静默：TeslaCamView 两个已合并任务未翻 merged 令 G 全灭；现命中任一活任务清单放行、全不命中警告点名全部活任务）。`.taskflow/`、`.omp/`、`.owner.json` 簿记白名单；无声明清单（未落 spec 的旧任务）→ 零干扰。
- **G 清单解析**（v2.49.1 加固）：bullet 首 token 是 bold 标签（`**xxx**`）= 模板小节标签非路径，跳过；**声明语义行**（含 改动文件/涉及文件/正向清单/文件集合/声明 关键词）的行内反引号路径全部收集（治冒号截断——「改动文件集合声明**：`a.swift`、`b.swift`」的路径原本全丢）；**负面清单行**（明确不做/禁止）的反引号路径**不**入清单（入=放行禁改文件）。仍 best-effort：非反引号裸路径在冒号后的仍取不到（写清单请用反引号）。
- **H 判定**：事件面 = `context`（v2.49.1——活体实证子代理报告不走 tool_result；探针取 omp 事件真值后重设计）；**触发源（v2.61.0 收紧）**=尾部 3 条消息中「含 task-result 信封标签（带/不带属性形态均认；不判 role——spawn 回执自动投递与链内嵌两投递路径均稳健）且命中特征词」的消息——旧版全文特征扫描把编排模型自述/工具图例（⛔/⚠）/H 自家提醒都当触发源，逐轮自我喂养（两会话连续 8~10 轮实证，本版切断）；特征词 = `blockers?` / `blocking` / `阻塞` / `卡点`（大小写不敏感；string 或 chunk 数组 content 均扫）；**幂等**=尾部已有 H 提醒标记则跳过（追加消息形态无法靠宿主去重，自查）；提醒以 user 消息追加（context 契约只可返回 messages）。**已知边界（v2.61.0 收窄后）**：仅 task-result 报告内否定语境（如报告写「无 blockers」）才可能误提醒——频率低（只限真实子代理报告），提醒内自我声明兜底（提醒不拦）；变体仍追不全（必修/must-fix/P0/严重 未收——按实测迭代）。强制力在流程门（merge.md 修复循环）与机械门（validate-changelog.sh），H 是可达性兜底。
- **已知边界**：G 不拦 bash 写文件（heredoc/管道/脚本间接写特征不可靠）——best-effort 层；F 对派发词里引用的**任何** spec 路径都会校验并注入首个（背景资料性引用会让 prompt 变长，行为无害）。极端归因：任务 B 的 worktree 恰好形如 `<任务A的worktree>-<n>-<slug>` 且 A 在 index 靠前时会归 A 按 A 清单比对（前缀命中的理论边角，实测误报再收）——归因顺序按 index 活任务序。**影响面地图写成 bullet 形态时**（模板是表格）——「上游依赖：`src/x.ts`」这类 bullet 的冒号后路径**不会**进 G 的声明清单（解析在冒号截断）→ 该文件编辑会误报**警告**（warn 档不拦）；按模板用表格即无此问题（对抗实证 v2.49.0）。

## 卸载

删 `.omp/hooks/pre/taskflow-guard.js` + 清 `project.json.mechanisms.TASKFLOW_GUARD`（否则 doctor 采纳对账点名产物缺失）。

## 词表活更新（E 的数据契约）

注入的是**活文件**不是安装快照：`.taskflow/glossary.md` 改动后下一轮请求自动用新内容，无需重装 extension。配套纪律（2026-10-09 用户拍板）：**用户明确说「看不懂」→ 当场改写——新词登记新条目；已登记词条的白话仍看不懂 → 改写该词条的白话和锚词，换到用户能理解的风格为止**（不是另开同词条），改完下一轮生效。I 号机制（v2.57.0）把本纪律升级为宿主闭环：检测到「看不懂」类反馈即计数，词表改写前逐轮注入沉淀指令（write/edit 落本文件即消账），压缩时兜底——漏执行不再丢。

## fixture

tf.test.mjs TASKFLOW_GUARD 节：mock pi 真执行渲染产物（硬规则 17——import 模块、调注册的处理器）——状态栏超24小时未合并计数 / `--files` 空格硬拦 / deploy 缺 web-only 提醒 / 压缩注入含任务 id / 部署墙默认警告→enforce 硬拦两档 / 正常命令放行 / E 注入（字符串+数组 system 形态、非 taskflow 项目零注入、括号大白话口径锚）/ F1 合法 spec 机械注入（spec 全文+worktree+原派发词保留、input 其余字段不动）/ F2 缺文件与缺必填节两分支 block / F3 未引用 spec 提醒 + 非 taskflow 放行 / G1 越界默认警告→enforce 硬拦（含单 ⚠ 锚）/ G2 off 放行 + 清单内 + 簿记白名单 + 非 taskflow 放行 / 审查修复回归：非 taskflow 项目派发词引用 spec 路径放行（F 零干扰守卫）+ 兄弟 worktree 越界警告与清单内放行（G base 取子 worktree 根）/ H：task-result 报告含 blocker 特征 → 人话三问提醒注入（可能猜错声明+grep 括号白话锚），普通对话含「阻塞」/工具图例/自家提醒/无特征/非 taskflow → 全静默（v2.61.0 来源限定+自我喂养切断，CLASS_SWEEP_GATE 宿主面）。

I 段夹具（v2.57.0）：user「看不懂」反馈 → E 通道注入沉淀指令（计数/重放去重/累计）；write/edit 落词表消账；assistant 信号词与无信号词不注入；非 taskflow 零干扰；压缩兜底两路（pending>0 有行/消账后无行）；渲染源锚×3（guard 头注释 / taskflow-guard.md / MECH_PROSE 含「词表反馈沉淀」——v2.56.2 渲染源漂移防复发）。

J/K/T 段夹具（v2.69.0）：J 墙伪造 edit/write/bash 事件——手改 status block（enforce 缺省）/ off 放行 / warn 警告 / 纯 note 字段放行 / 新建档案 status=active 放行 / 新建 verifying 拦 / 坏 JSON 拦 / edit 字面替换检出翻转 block / bash sed·重定向无 tf.mjs 拦 / tf.mjs 命令零干扰 / deploy.status 单独变化也拦；K 等验收期 push/merge 提醒（点名任务）与 TF_VERIFY_WARN=off 关闭；E 实况行（活/等验收+部署短格式注入 system）；T skill:// 计数（非 skill 路径不记、技能名截去子路径、项目名取 cwd basename）；skills --usage 报表（计数/近 30 天/零加载标注/口径尾行/无埋点文件 exit 0）；状态机模块纯函数直测 + data.md 表逐行对账。

