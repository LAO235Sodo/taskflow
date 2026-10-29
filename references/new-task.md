# 新任务

## 首次初始化（每个项目一次，检测到 `<主仓库根>/.taskflow/` 不存在时）

1. `mkdir -p` 任务目录 + `decisions/`。
2. 写 `project.json`。**初始化提问检查单（deployment 三键，v2.88.0）**：写盘前向用户提问项目部署形态——`tier`（middleware-shared=统一中间件外部 PG/MinIO ｜ self-contained=自带库容器小应用）、`environments`（dual=测试+正式两套 ｜ single=单环境）、`verify`（验证方式一句话，如「8082 测试套」「临时实例+克隆库」「none」）。**三键必须经用户确认后落盘：禁默认值、禁替用户选，未答不落盘**（deployment 节整体缺省合法）——形态分级是项目元数据不是实现细节，后续验证/部署方案分级（①文档配置直接合 ②共享测试套 ③临时实例+干净数据副本 ④任务级完全隔离缓做）以此为准。

```json
{
  "key": "<规范化 key>",
  "name": "<目录名>",
  "repoRoot": "<主仓库根绝对路径>",
  "remote": "<原始 remote url 或 null>",
  "git": true,
  "createdAt": "<ISO8601>",
  "lastActiveAt": "<ISO8601>",
  "deployment": { "tier": "<middleware-shared|self-contained>", "environments": "<dual|single>", "verify": "<一句话，未答不落盘>" }
}
```

3. **gitignore 任务状态**（不污染 tracked 的 .gitignore，且对主仓库和所有 worktree 同时生效）：

```bash
grep -qx '.taskflow/' <主仓库根>/.git/info/exclude 2>/dev/null \
  || echo '.taskflow/' >> <主仓库根>/.git/info/exclude
```

4. 更新 L0 注册表 `~/.config/opencode/taskflow/projects.json`。
5. **生成项目约定**：读 `templates/conventions.md`，引导问答生成 `.taskflow/conventions.md`（推送/部署节奏、验证清单、完成定义、**确认档位**（detailed 缺省 / batch 低影响合并组末确认——高影响门永不豁免）、环境端口注意、禁止事项；用户答不全的小节保留占位，后续随时补）。已存在则跳过。
6. **同步红线摘要到项目根 AGENTS.md**：从 conventions.md 提炼红线（推送/部署/端口/禁忌各一两条）写入项目根 `AGENTS.md` 的「项目运行约定」节——AGENTS.md 会被 OpenCode 自动注入每个会话，保证不看文档也不忘规矩。AGENTS.md 已存在则追加/更新该节，**不覆盖用户已有内容**；不存在则创建。
7. 告知用户：已完成初始化（AGENTS.md 建议提交进 git，团队共享同一套规矩）。

之后每次任何动作结束时刷新 `project.json.lastActiveAt` 和 L0 注册表。

## 新任务流程

1. 定位项目 + 初始化（如上）。
2. **先读项目约定与决策库**：读 `.taskflow/conventions.md`（推送/部署/禁忌，全程遵守）；`ls .taskflow/decisions/`，凡与本次任务领域相关的决策文件读入上下文——避免重复踩坑、保持设计一致。**建档前防滚回扫描**：`node <skill目录>/scripts/tf.mjs doctor` 全局体检——发现「领先主分支且已部署（task.json deploy 记录/签名册在册）的未合并任务分支」→ 暂停建档，呈用户三选一拍板：①先合并它再建新任务 ②以它为基线链式开工（第 5 步 baseBranch）③确认搁置（留痕落点：项目 findings.md 一行「日期+分支+搁置原因」——此阶段新任务 spec 未建；搁置分支后续如被引用，引用任务的 spec 风险与红线拍板留痕节补记）。未合并的已部署分支继续从主分支开工 = 后续部署静默滚回（实证：某修复滞留任务分支未合并，后续任务从 main 部署逐次覆盖）。
3. 与用户确认：**标题、一句话目标、规模分档**（small / medium / large 定义见 SKILL.md；分档决定流程轻重，small 有裁剪）；判定为 bug 修复/排查/工程工具类 → task.json 落 `kind: "bugfix"`（I7 defect→test 门的数据前提——kind 缺省则 I7 永不检查，对抗审查实证不可达）。
   **方案三源对照（功能实现类方案呈报前必查，v2.83.0——治「方案偏纯推理，不查仓内先例/业内做法/现成库能力」）**：依次查三源，结论写进方案稿——
   - **①仓内既有实现**：grep 同类功能/可复用模式/相似先例（函数/组件/工具方法/既有机制），命中先例 → 复用或说明与先例的差异，禁重造轮子；
   - **②业内做法**：新功能面且仓内无同类先例 → web_search 官方文档与成熟方案（外部事实按既有外部事实断言纪律带来源 URL），禁凭印象断言「业界通行做法」；
   - **③现成能力核对**：拟手写的逻辑逐项核对依赖库/框架/平台是否内置（日期计算/重试/防抖/导出/加密等常见能力先查文档再手写）。
   - **触发判据与豁免**：新功能面且仓内无同类先例 → ② 必做；复用仓内既有模式的小改动 → 可跳 ②③，方案稿注明「仓内先例复用（<文件:行>），未另调研」。
   **可行性门（开工前三问，任一不过停在呈报，不进第 5 步建 worktree——v2.51.0，OK 平台可行性评估七维的红旗化）**：
   - **问一 需求锚**——需求能否链到 docs/prd **条目**（条目级，REQ_ANCHOR_GATE——不是文件级链接：spec 每条验收标准将挂条目 ID；口径无条目可挂 = PRD 静默区，走「基线外条目草案」登记+确认回路）；链不上 → **当场**按第 8 步同口径三选一（①补用户故事文档 ②从 decisions/归档推断初稿、拍板后落 docs/prd ③豁免——仅限 bug 修复/排查/工程工具类且注记拍板留痕；**新增需求禁 ③**），补不动 = 回需求侧，不进入本流程（不在「走第 8 步」字面下先建 worktree 再补锚——锚未决先进场违背门头）。
   - **问二 闭环锚**——改动是否本仓库闭环。红线清单命中任一 = 不默默开工，呈用户拍板人工主导或先拆解：跨仓库/跨服务联动、接入新中间件、**审批级数据库 schema 或数据破坏性变更**（判据：删列/改列型/约束收紧/批量删除重写数据/大表建索引 = 审批级；纯新增可空列与普通小表索引 = 日常）、涉资金或核心安全链路、需数据迁移或灰度发布的交付形态。拍板结果留痕 spec「风险与红线拍板留痕」节（templates/spec.md 占位；拍板内容 + 日期——resume/审查凭该节可见这是拍板过的红线任务；此阶段 spec 未建时先记会话待办，第 7 步建档即落节）。
   - **问三 依赖锚**——`node <skill目录>/scripts/tf.mjs skills [领域词]` exit 1 = 缺失清单呈用户勾选（DEP_ASK_GATE，硬规则 22，第 8 步展开），不装 = 后续审查如实注记；**检测结果按领域词缓存**——仅当第 8/10 步领域词与已测词完全一致才免重跑，出现新领域词必须补测补呈报（防「会话缓存」整包误读）。
   - 红旗映射注记：清晰度→问一；改动范围/技术复杂度/外部依赖/风险等级/交付形态→问二红线；仓库匹配度→单仓天然满足。加权打分制不采纳——个人语境退化为仪式，红旗制可判定。
   **范围与容量评估（评估先于实现；可行性门三问之后、建档派发之前）**：
   - **改动面（变更范围界定，change scope enumeration）枚举**：需求实现前枚举改动面——涉及页面清单 → 逐页面接口面（API 调用面；抓取法同页面取证全量抓取：运行时网络清单优先，无运行环境 grep 组件/路由 API 调用兜底，testing.md §十二）→ 涉及文件清单；呈报必含「**改动面：N 页面/M 接口/K 文件（清单）**」，禁「先做着看」式无面开工。
   - **规模与容量评估**：按改动面估代码面规模（预计改动行数/文件数）对照单会话上下文容量（综述类长文生成任务尤须对照——cacheRead 40 万 token 形态实证：超容量硬塞=中途丢上下文返工重来）；**参照锚（非硬界）：预计需全量读入的大文件（≥500 行）≥3 个，或产出以长文为主（综述/报告类）→ 至少按『接近』档处置（评估结论落呈报）**；**超限或接近 → 显式走拆分（split.md，写集不相交）或 wayfinder 决策地图，禁硬塞**；评估结论写进呈报，并落 spec 实现计划或 progress.md 一行留痕（同施工纪律自查留痕口径）。
   - **与牵连排查衔接**：改动面清单同时是牵连排查影响面盘点的输入（改哪个接口→其消费方清单）——一次枚举两处复用，不重复盘点。
   - **技能引导**：范围评估分析由 scope-assessment（范围评估）技能引导——缺失跑 `node <skill目录>/scripts/tf.mjs skills 范围评估` 检测，按硬规则 22 呈用户选装；等待期间按本节清单手工执行不停摆。
4. 生成 id：`<slug>-YYYYMMDD`（slug 取标题 2-3 个关键词，小写 kebab-case）。
5. **一律建 worktree（从最新主分支拉起）**——新任务默认托管模式（`anchor: "managed"`）。仅当用户**显式要求**"就在当前分支/目录做"时才用挂靠模式（`anchor: "attached"`，复用当前分支，须提示并行风险）。默认路径：

   ```bash
   # 1) 拉最新（有 remote 时）；2) 从 origin/main 建任务分支 + worktree
   git fetch origin
   git worktree add ../<repo名>-<task-id> -b task/<task-id> origin/main
   # 无 remote → 依次 fallback：本地 main → master → 当前 HEAD
   ```

   主仓库检出区因此永远保持干净、只作合并落点；任何任务不在主仓库内直接改动。
   **worktree 位置规则**：默认 `../<repo名>-<task-id>`；但**主仓库本身位于 agent 技能扫描目录内**（如 `~/.config/opencode/skills/`）时，必须放到扫描目录之外（如 `~/.config/opencode/worktrees/<repo名>-<task-id>`）——否则完整 checkout 会被 agent 当成第二份技能重复注入（实证：taskflow 仓库自建 worktree 生成幽灵技能，2026-09-19）。
   **基线分支（baseBranch）**：默认 `origin/main`。任务依赖另一**未合并**任务的产物时，经用户确认可以该任务分支为基线：`git worktree add ../<repo名>-<task-id> -b task/<task-id> task/<基线任务id>`，task.json 记 `"baseBranch": "task/<id>"`，handoff.md 注明 deviation 与 rebase 责任。此后 resume/merge 检测到基线分支已合入 main → 提示本任务分支需 rebase。
   **派生来源（derivedFrom，v2.41.0）**：会话内从既有任务派生新任务（任务 A 进行中/刚收尾，同会话又立任务 B——用户提出新需求、验收中冒出问题、链式基线开工均算）时，task.json 落 `"derivedFrom": "<源任务id>"`。与 baseBranch 分工：链式（依赖未合并产物）两者都落；纯话题衍生（从 main 直接拉）只落 derivedFrom。ls 双列层级（v2.45.1）：一级任务列=簇头（孤儿自带源标注）、二级任务列=派生；`⛓<src>` 后缀=链式（有 rebase/并集部署约束）。
   **依赖目录链接**（缓解全新检出无依赖的代价）：worktree 创建后，检测主仓库的 gitignored 依赖目录（node_modules / .venv / vendor / 构建缓存等），逐个符号链接进 worktree（`ln -s`）；链接不可行时提示用户按项目方式安装依赖。
   **服务端口租约**：实现期启动项目 dev 服务（本地验证）前，先 `node <skill目录>/scripts/tf.mjs svc claim <service> --port <约定端口>` 登记 services.json 租约——被占（其他任务在测服务/旧项目遗留进程）→ 按输出建议**让位换端口，绝不 kill 抢占**；项目端口带（如 9 开头归属）住项目 conventions.md「环境与端口」节；测试完成停服后 `svc release` 释放。**环境/依赖/端口类报障信号（装不上/被占/版本过期）→ 先查本节 + `svc ls` 租约占用，再进假设排序——环境查本地，运行时查代码，两类排查方向不同（判定点环境类故障分流）**。
   **属主凭证（建档即写，OWNER_JSON）**：managed worktree 创建后原子写 `<worktree>/.owner.json`（`{sessionID, pid, started_at}`——doctor I10 数据源）并初始化 task.json `activeLease`（LEASE，checkpoint 第 4 步持续刷新心跳）；attached 挂靠**不自动写**（用户目录零打扰原则），跨会话接管时经 `tf.mjs takeover` 补写。

6. 会话迁移：若主代理具备会话工作目录迁移能力（如 OpenCode 的 `tools.opencode.session_move`），把当前会话迁入 worktree；不具备则明确告知用户后续应在 worktree 目录下工作，并提示路径。
7. 从 `templates/` 复制初始化：`spec.md`（向用户收集验收标准 + **需求基线节**（REQ_BASELINE，全档位必填：链到 docs/prd 条目，无 PRD 域走第 8 步三选一，禁空节）+ **基线外条目草案**节（REQ_ANCHOR_GATE：验收项挂不上条目的口径登记草案——口径原文/出处血缘/PRD 去向预填空号，经用户确认后才动工）+ **影响面地图**（CLASS_SWEEP_GATE 立项面，硬规则 25：上游依赖/下游消费方/同类资产三行 grep 实证填，禁凭记忆——把「上下游靠脑记」变成「立项时落表」）+ **产物链节**——前端 UI 任务与 large 档必填：用户故事骨架先于原型，规则见模板节内注释；large/medium 触发「关键决策」质询，见第 8 步）、`handoff.md`、`findings.md`、`progress.md`、`decisions.md`（空骨架）、`task.json`（schema 见 data.md）。
8. **理解与决策质询**（large 必跑；medium 对含糊项、多解读决策与**三类高危决策**（找茬自审触发面）；small 跳过——但 small 含三类高危决策仍须单独跑找茬自审，见 SKILL.md small 裁剪注记）——**需求启发、缺口确认、决策拍板三类问题进同一个队列**：一次一问、选择题优先（2-3 候选+权衡）、推荐项置顶给理由、单会话 ≤5 问，**理解类优先于决策类**（不知道做什么就选不了栈），全局按影响×不确定性排序，答完即写回 spec：
   - **需求启发**：目标含糊/产物链故事骨架推不出 → `interview-me` 问法引导（目的/约束/成功标准，一次一问），收束产出 `docs/prd/<域>/user-stories.md`（复制 `templates/prd-user-stories.md`），状态回填 spec 产物链节；**无 PRD 域（呈用户决定，模型禁自选降级，2026-09-24 拍板）**：① confirming-requirements 补写用户故事 ② 从 decisions/归档叙事推断初稿、用户拍板后落 docs/prd ③ 豁免——仅限 bug 修复/排查/工程工具类，且注记必须写明「用户拍板豁免 <日期>：<原因>」；**新增需求（新功能/行为变更）禁用 ③——没有文档就先补（①/②），原始需求必须可追溯**（doctor I12 机械核对拍板留痕）；
   - **缺口确认**：记录推不出、需口头确认的待确认点（同纪律：一次一问，禁整批抛开放问句）；任务涉及前端样式资产且项目未初始化 `docs/ui/style-source/` → 呈报「本项目可启用样式真源门 STYLE_SOURCE_GATE（防后续任务改偏已定稿样式），是否初始化？」（延迟加载细则 references/style-source.md）；
   - **静默区草案确认（REQ_ANCHOR_GATE，硬规则 27）**：验收项挂不上任何 PRD 条目（PRD 静默区）→ 先登记草案（spec「基线外条目草案」节：口径原文/出处血缘/PRD 去向预填该域下一个空号）再并入本队列呈报——呈报三要素：原口径引文（PRD 最接近条目文本，或明写「PRD 未定义」）/ 新口径（草案原文一句话，升格后的条目正文就按这句写）/ 影响（消费方清单一行，引用硬规则 14 盘点结论）；用户答「登记并动工」→ 草案行落用户确认列后才能动工；答「改口径/放弃」→ 改完重新进队列；mid-task 增补走 spec 变更 → goalHash 变 → `req-confirm` 落痕（既有扳机承接）；拍板前禁按草案口径动工（与需求变更门同语义）；
   - **外部依赖强制问答门（DEP_ASK_GATE，硬规则 22——缺口确认统一入口）**：①领域检测信号（见第 10 步前置词表）命中后先跑 `node <skill目录>/scripts/tf.mjs skills [领域词]`——**exit 1 = 有缺 → 缺失清单呈用户勾选装哪些**（含安装源；不装 = 后续审查如实注记「未经 XX 审查」）；②机制产物/项目初始化（mech install 渲染、真源迁移、任何往项目 repo 落盘的安装脚本）——检测存在（mech ls 已装/产物路径在）= 静默用不再问；缺 = 呈报一次、拍板前不跑；③只读检测/提取不问直接跑；
   - **改现有页面前端 UI 任务 → 现状基线硬前置（APP_PAGE_BASELINE，硬规则 21）**：立项时按 `references/prototype.md` ⓪ 机械提取 App 现状基线（Android `scripts/design/extract-app-baseline.js` / web `extract-spec.js` 指向运行中的真实站点）落 `.taskflow/<id>/design/baseline/`——缺 = 原型制作与派发门禁拒绝；新增页面 = 产物链「不适用——新增页面」+ 同类现状页取样；**延迟初始化（其他项目提醒安装，对齐 STYLE_SOURCE_GATE 模式）**：项目侧 `scripts/design/extract-app-baseline.js` 不存在（机制未装）→ 呈报一次「本项目可启用现状基线门 APP_PAGE_BASELINE（防原型凭先验捏造、现状漂移无门可拦），是否 `node tf.mjs mech install APP_PAGE_BASELINE`？」——同意即装（渲染门+提取器+锚点+约定补记）；未同意先用技能仓 `assets/design/extract-app-baseline.js` 提取（工具照跑，仅收尾门不生效），下一改现有页触点再呈报；
   - **决策拍板**：关键决策节「逐项拍板」档的项（2-3 候选+权衡+推荐）。**决策组合门（硬规则 16）**：改动文件类名 grep decisions/ 命中 ≥1 份决策文档即触发（无 ≥2 阈值）——spec 增「决策组合评估」表（列：决策文档 × 组合后可达状态（含默认隐藏/折叠/抽屉态）→ 新增验收项/语义中性豁免），命中决策须全量入表（merge 阶段一脚本查完备性）；新沉淀的决策文档「影响范围」必须列文件/类名标识符（台账纪律，grep 匹配的数据源）。**找茬自审（v2.51.0；v2.53.0 与处置档解耦）**：关键决策节**任一处置档**（含推荐+注记、既定沿用）的决策命中三类高危（跨模块修改 / 编译器验不了的属性——并发安全、幂等、不变量 / 不可逆变更——外部副作用）→ 按 domain.md「找茬自审」自答三句写进 spec「找茬注记」表（templates/spec.md 占位），空白 = 质询不放行。

   建档时先自动探测填「既定，沿用」项（conventions/decisions/代码现状，写出处），不进队列；「推荐+注记」项直接填不问、用户可否决；方案内用户可见功能面的取舍（复用完整形态/带不带既有提示数字）同功能面取舍——进质询队列逐项拍板，禁单方裁剪塞进可否决项；用户明确说跳过 → 照办并注记「未质询，返工风险自负」。前端设计方向质询按 references/domain.md「可视化呈报硬规则」附可视化载体；重大架构决策拍板后沉淀 `decisions/`。**前端 UI 原型环节六步链（现状基线→需求质询→对标引导→制作→交付迭代→裁决回写）读 `references/prototype.md`——对标引导档位（⓪ 现状基线 / A styleguide / B 对标拉范式 / C 风格库）唯此一处。**决策质询的问题与选项呈报遵守 PLAIN_SPEECH_GATE（硬规则 24）：每个候选 2–3 句大白话讲清取舍（谁受影响、代价是什么），机制名带大白话括号，禁术语裸抛。
9. 登记 index.json（status=active）+ L0 注册表。
10. **领域检测**：读 `references/domain.md`，命中前端/后端/测试则按映射表注入对应技能要求。
 11. medium/large：引导拆分（读 `references/split.md`）；拆完**必须先 checkpoint 再派发**。large 档派发前核对：关键决策节「逐项拍板」档全部有拍板 + **「找茬注记」表非空白（三类高危命中时三答齐全且至少点名一个具体失败模式，禁纯否定词——「暂未发现/无/已覆盖」不算数）** + spec 确认，缺一即停。**前端 UI 任务与 large 档核对产物链（本核对在任何路径下必跑——不命中三场景管制、不拆分直接干时同样执行，防绕闸）**：用户故事骨架已拍板 + 原型已获用户确认——原型未确认 = **PROTOTYPE_STALE，实现/派发门禁拒绝**（与 merge.md 第 3 步产物一致性轴双设），缺一即停。领域检测=前端 UI 时，原型环节先读 `references/prototype.md`（六步链）。**施工纪律（不拆分直接干时同样执行——防绕闸同款）**：实现步骤按 split.md「施工纪律」四条自查（粒度红线/依赖图排序/垂直切片/验证锚点），开工前过一遍；自查结论一行落 spec 实现计划或 progress.md（不拆分路径留痕）。
    前端 UI 任务加验（DESIGN_SPEC_EXTRACT，硬规则 19）：已拍板原型 → `.taskflow/<id>/design/spec-extract.json` 规格表必须已提取在档——缺 = 派发门禁拒绝（子任务 spec 只能附规格表，编排层凭记忆转述原型 = 违规）；`validate-design-spec-gate.sh --spec` 在 merge 阶段一复核挂链。
    改现有页面任务加验（APP_PAGE_BASELINE，硬规则 21）：产物链「现状基线」行必须已提取在档（schema=app-baseline/1（Android）/ design-spec-extract/1（web，extract-spec.js 指向运行中的真实站点），或「不适用——新增页面」带理由）——缺 = 派发门禁拒绝（原型 = 基线 + 显式 delta，凭记忆重画现状 = 违规）；`validate-app-baseline-gate.sh --spec` 在 merge 阶段复核挂链。
