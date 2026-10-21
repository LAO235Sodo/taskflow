# list & resume（恢复）

1. 定位项目。
2. **扫描"最近活跃工作"**：跑 `scripts/tf.mjs ls`——登记任务表 + 游离工作一次给出（降噪已内置：近 3 天有提交或改动、上限 8 条、跳过 adopt-ignore、plan 目录扫描、同前缀提示；**verifying 任务置顶打印「📌 待你验收」块并显示挂起天数**）。脚本缺失/报错 → 手工兜底：index.json 的 active/verifying 按 lastActiveAt 倒序（verifying 显示"等验收"并**排最前、注明挂起天数**，与 ls 输出规则一致）；游离=未登记 worktree + 近 3 天活跃分支（排除主分支/备份命名）+ `~/.opencode/plan/*.md` 文件头匹配本项目的交接文档（Plan mode 只能写全局目录，漏网重灾区）；跳过 adopt-ignore.json（含前缀模式），上限 8 条。同前缀 ≥3 个未登记 worktree → 问一次"加入忽略清单？"，确认后以前缀模式写入 adopt-ignore.json
3. **把 ls 的登记任务表格原样输出给用户**（markdown 表格含目标列，不缩写、不散文化——用户靠它知道每个任务是干嘛的；「已搁置」任务原样呈现并在呈报时注明「已搁置：<原因>；恢复跑 unpark」），第一个问题 = "继续哪个？"：
   - 登记任务 → 直接继续（按各自流程走）
   - 游离工作 → 三个出口：**继续（先按 adopt.md 收编补档案）** / 仅收编建档 / 忽略并记住（adopt-ignore.json）
   - 游离工作被选"继续"时，收编登记完成即无缝进入该工作（例如接着画设计稿），不重新开题
4. **无一可继续**（无登记任务、无游离 worktree/近期分支、无未提交改动）→ 告知无可继续的工作 + **原样转述 ls 打印的「📌 可续迭代」入口句**（用户可直接复制粘贴），再问是否新建（new-task.md）或呈现完整状态盘点。
5. **事实核查**（不可跳）：跑 `scripts/tf.mjs doctor <task-id>`（缺省=全部 active/verifying；退出码 1=有差异），按输出的不变量编号处理：
   - 执行位置：managed → 任务 worktree；attached → 主仓库当前分支（用户分支）。
   - **I1 对账**（低影响，直接做+报告）：跑 `node <skill目录>/scripts/tf.mjs reconcile --fix`（幂等、原子写、以 task.json 为准回写 index 并打印 diff；损坏的 task.json 只报不修，交编排层；规则见 data.md 唯一事实源）。
   - **I2 漏网**：未登记 commit → **直接补登**一条 checkpoint（summary 前缀 `(补登,resume 漏网检测)`，commit/files 取自 git——L3 是真相源，补登只是登记导航索引，无取舍风险），并报告；记录与代码不一致（未提交改动 / 回退 / 分叉）→ 明确列出差异，让用户决定以哪边为准，不得自行取舍。补登不是硬规则 6 的"擅自取舍"（那是指代码内容以哪边为准）。当前分支有工作但完全无任务档案 → 提示收编为新任务（adopt.md）。
   - **I3**：managed worktree 丢失 → 报告并询问是否重建；attached 的 `worktree: null` 是正常态，不得误报。
   - **I6**：基线已合入主干 → 提示本任务分支需 rebase（其产物已进主干）。
   - **stale 影响面对账（STALE_CHECK，v2.59.0）**：接管/resume 核对时跑 `node <skill目录>/scripts/tf.mjs stale <task-id>`（无 id 全量扫 active/verifying）——⚠ 影响面漂移 = main 自本任务基线 baseCommit 动了你声明的读写集：先重验 spec 影响面地图对应行再动工（带着过期假设干活 = 返工温床）；✓ 影响面新鲜 → 照常续做；ℹ 无基线锚（存量任务）→ 跳过。
   - **I18 账实对账（v2.60.0；档位 v2.60.2）**：doctor 输出疑似搁置 → **直接处理**：`tf.mjs park <task-id> --reason "<推断依据，如「I18② N 天无簿记且租约过期」>"`（可逆低影响，事后报告，用户 unpark 即撤）；疑似漏收口 → 呈报验收简报（`accept --pass` 是验收拍板，不可代理）或明确恢复开发；确认仍活跃则保持并刷新 lease。parked 任务不续做，恢复跑 `tf.mjs unpark <task-id>` 后再进第 8 步（PARK 机制：G 门/体检（缺省）/stale 不再盘点 parked 任务；doctor --all/点名仍全量体检）。
   - 脚本缺失/报错 → 手工兜底：`git status --short` + `git log --oneline -10` + `git rev-parse HEAD` 与最后 checkpoint 比对，按同样规则处理。
6. 读 `.taskflow/conventions.md`（项目约定，必读）+ spec.md、handoff.md、findings.md、decisions.md + **spec「需求基线」节列出的 PRD 条目（REQ_BASELINE 读路径：读链接即读文件，机械加载不靠裁量——原始需求与业务口径住 docs/prd，接力不读它=漂移温床）**（项目决策库 decisions/ 如相关也读）；**前端 UI 任务在原型/设计环节的：加读 `references/prototype.md`（六步链，含 ⑤ 裁决回写核对）**。pre-v2.23 档案无「需求基线」节 → ℹ 提示顺手补（跑 `tf.mjs req-confirm` 补锚）。

   **子任务在途分支（v2.53.0，对抗审查实证缺口）**：读 task.json `subtasks[]`——存在非 done 项 = 上次中断在拆分派发中 → 按 split.md 第 4/5 步续派（复用已建子 worktree 与分支，`task/<id>/<n>-<slug>` 归父任务管），**兄弟子任务 worktree/分支禁收编禁忽略**（strays 已按命名排除，误报时人工归位父任务）；恢复摘要须列子任务进度（done/total + 打回原因若有）。
7. 输出恢复摘要：**需求锚定（以 PRD 基线口径复述：本任务要满足的原始需求 / 当前进度 / 与基线的已知偏差；small 档一行带过）/ 当前在哪（环节用 references/stages.md 节点名报，如「卡在 code review，阻塞项剩 1」）/ 下一步（具体命令）/ 未决风险**——复述口径不对，用户当场纠（确认在第 8 步收口）。摘要确认后把「下一步」init 成 omp Todo（会话工作台——SKILL.md「会话工作台」）。
8. 用户确认后继续工作；续做时把 task.json 与 index.json 的 sessionID 更新为当前会话（sessionID=最近活跃会话，旧会话线索留在 progress.md 与 note）。**接管触发分三态（v2.53.0，对齐 I9 与 README 口径）**：① lease 活跃且属主 pid 活 → **先呈报「前任在途」核对**（doctor I9 同款提示），用户确认前任真停手后才跑接管仪式——禁直接覆写（多会话互踩正是接管要防的场景）；② 会话不符 / lease 过期 / 属主 pid 已死 → 直接跑 `node <skill目录>/scripts/tf.mjs takeover <task-id> --session <当前会话ID>`（机械改 sessionID + 重写 worktree/`.owner.json`（OWNER_JSON 属主凭证）+ 刷新 LEASE 心跳 + 打印桌面清点清单；①态强接须加 `--force`）；**清点（未提交改动逐项过目、认领或编辑文件丢弃）由编排层完成并复述给用户，完成前禁止 commit**。**遗留服务核对**：续做涉本地 dev 服务的验证前，先 `node <skill目录>/scripts/tf.mjs svc ls` 核对 services.json 租约（stale/orphan 先 `svc release` 清理——上次会话的服务可能还挂在端口上，防占用误判）。
9. **verifying 任务的恢复**：跳过开发流程，直接从 merge.md 第 6 步（推送与部署）继续验收闭环。**恢复第一动作：跑 `node <skill目录>/scripts/tf.mjs accept <task-id>` 把验收简报重新呈给用户**——长任务跑完一小时，人的注意力刚回来，早忘了任务起点；简报说清：任务是什么、部署了什么、验哪几项、怎么验、怎么回复（「验收通过」才归档 / 哪条不符说看到什么）。verifying/active 任务的「打回」走本步与修复循环，**不产生已合并代码的回退**；若用户诉求是撤回已合并（merged）的代码，改跑 `node <skill目录>/scripts/tf.mjs revert-plan <task-id>` 生成 Saga 补偿方案（只读不执行，逐条 `git revert -m 1` 需用户逐条确认）。
10. **归档续迭代**（用户提及已完成/历史工作，活任务与游离无命中）：
    - **定位**：`node <skill目录>/scripts/tf.mjs scout <关键词>`（双层：活任务 + archive/，含 decisions 与 journal）。用户给了任务名 → `ls --all` 直接找；只给领域词 → scout 多试几个近义词（视觉/配色/颜色），仍无命中再扩大到 CHANGELOG + `git log --grep`。
    - **读四件**：task.json（终态与 checkpoints 时间线）、handoff.md（待办区=天然迭代种子）、journal/decisions.md + 项目级 `decisions/`（约束与**被否决方案**——防止重走弯路或无意推翻既有决策）。同日同主题 decisions 文件出现重复 → 呈报请用户裁决合并，不自行取舍。
    - **呈报再开工**（闸门，不得跳过）：任务终结于什么 / 哪些决策约束本次（含被否决清单）/ 待办种子清单 / 建议方向（可多条；**涉及前端页面/布局/视觉时，方向建议必须附可视化载体——domain.md 前端硬规则：线框图 / 设计稿 HTML / before-after 截图 / 标注图按档选，纯文字可被打回**）→ 用户拍板方向后才动手。
    - **新任务建档，不复活旧任务**：merged→active 是状态倒退，旧档案是不可变叙事。走 new-task.md，spec 背景写血缘：「承接 `archive/<旧任务id>`，待办源：`decisions/<文件>.md`」，**task.json 落 `"derivedFrom": "<旧任务id>"`**（归档续迭代=派生路径，ls 双列层级呈现血缘——新任务一级列自带「源:旧任务id，已归档」标注）。核对合并后代码是否又动过（旧档案之后 main 的演进可能已覆盖部分待办）。
11. **验收意见回收**（active 任务 + 用户带回意见/不满 = 打回——按 SKILL.md「反馈分类」路由，分类结论外显一句）：
    - **表面微调** → 直接改 + findings.md 记一行，不走重流程。
    - **新需求** → 走 SKILL.md「归入 vs 另开」。
    - **打回返工** → 归入当前任务：意见转成 spec 验收项增补（不推翻已固化决策）→ 修复 → 呈报**附可视化载体**（硬规则 11）→ 用户过目 → 再验收。**原型类打回 = prototype.md ④ 交付迭代回路**（同类全文排查/真源回写）。
    - **隐性升级**（诊断中发现上游缺失：spec/用户故事没写、口径打架）→ **升级确认门**：呈报「原范围 → 升级后范围 + 新增工作量与影响」请用户拍板，**不得默认扩大返工范围**（实证：snap-ai-patrol-20260921 页面返工查出「用户故事从未写」——靠自觉问了，本条使它成为流程保证）。
    - **呈报 checklist（方向变更/修复方案呈报前机械过一遍）**：
      - [ ] 涉前端方向？→ 可视化载体附了吗（硬规则 11，纯文字可被打回）
      - [ ] 范围比原任务扩大了？→ 升级呈报带「原范围→新范围+影响」了吗
      - [ ] 走查/诊断结论落 findings.md 了吗（checkpoint.md 主动触发条款）
      - [ ] 前端/large 任务？→ **评审包四件套路径**（用户故事/PRD、原型、决策表、验收标准——spec 产物链节现成）附了吗
      - [ ] 属五类正式呈报（方案/打回返工/升级确认门与需求变更门/验收简报/部署清单）？→ 呈报稿落 `.taskflow/<id>/briefing-<场景>.md` 过 PLAIN_SPEECH_GATE 门了吗（硬规则 24，红=重写绿才呈报）
