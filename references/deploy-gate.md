# deploy-gate（部署协调门）——DEPLOY_GATE 机制细则唯一载体

> 触发：SKILL.md 硬规则 23。背景：2026-09-29 单日四起覆盖事故——治理代码被后续部署静默滚回、签名册条目互相覆盖、版本撞号覆盖验收窗口、声称部署但服务器无痕。共同根因 = 多会话各自从自己分支构建、部署同一台服务器，谁后上谁生效；git 对此完全不可见（git 冲突可见可解，部署覆盖静默无报错——本机制治后者）。
> 加固（2.40.0，对抗性审查四缺口）：预检新增**实况核验**（实测 jar md5 与基线比对——未登记部署从不可探测变必红）；`--record --web-only` 沿用基线 jar（消手抄污染）；verifying 让位机械化（分支不在部署血统=预检红）；租约 TTL 与跨机边界显式化。

## 四件套

1. **部署前预检（硬门）**：`node scripts/harness/deploy-preflight.mjs --branch <部署分支>`——读服务器 live-state 基线，跑两道门：**实况核验**（实测服务器 jar md5 与基线登记值比对，不符=红：未登记部署/手工动包/登记有误——先人工核实线上实况再 `--record` 补正基线，禁止盲上）+ **血统门**（线上 commit ⊆ 部署分支）。任一红 = **并集优先**：先 merge 线上任务分支进部署分支再构建，重新预检至绿，禁止直接上。**让位机械化**：任一任务 verifying（等真机验收）且其分支不在部署分支血统 → 红（部署会滚回其已上线代码；本体/并集自然豁免；分支引用已删除=信息级不误拦）。
2. **部署收尾登记（硬门）**：上传/重启/探针同一批次跑 `--record --branch --commit --jar-md5 --version --jar-path <服务器jar路径>` 更新 live-state。**不登记的部署 = 下次预检必红**（实况核验 md5 必不符——这是 2.40.0 起的机械事实，此前只是宣称）；基线缺位时预检宁可全红也不放行（历史假部署缺口正是靠登记才从静默变可见）。**web-only 部署**收尾跑 `--record --web-only --web-version <V> [--web-fp <F>]`——jar 沿用基线原值，禁手抄 jar 四件套（手抄错一次=基线污染=误红/误绿）。
3. **部署租约（v2.53.0 改口径：走 deploy 入口时无需也不应手动拿锁——入口自管 deploy 锁 ttl 1800，手动持锁后跑入口会撞自己的锁死等 30 分钟，2026-10-09 实证）**：手动 `lock deploy` 仅剩两个合法场景——①绕行 preflight 直跑部署命令链的应急（该链本身已被硬规则 23 禁止，锁只是减损）②非入口的长时间部署准备动作。锁的边界不变：本地 clone 的 `.taskflow/.locks/`——单机多会话有效，**跨用户/跨机器互不可见**（跨机让位人工协调，机械兜底=实况核验+血统门，数据源在服务器上跨机有效）。
4. **验收窗口让位 + 验收即合并**：任一任务 verifying 期间，非并集/非本体的部署让位（预检机械化拦截，见第 1 条）；用户回「验收通过」= 立即 merge main + main 重建替换包 + `accept --pass`——未合并的已部署分支过夜 = 滚回倒计时；「合并后 main 重建替换包」缺位同罪。

## 部署分支语义（v2.66.0，merge-first——2026-10-16 误部署实证固化）

- **判定**：project.json deploy.commands 含 main 检出断言（`branch --show-current … 'main'`）= 该项目部署命令**锁死从 main 构建**（镜像化/paas-ready 形态的并集语义）。deploy 入口（tf.mjs）对此机械防呆：`--branch` 传非 main 分支 → **拒绝**（构建会静默空转：checkout/tag/构建全取 main，产出与线上同内容的镜像，实物不变——2026-10-16 首次误部署实证：任务分支直接 deploy 构建了 main 同内容镜像，容器实物 md5 与部署前完全一致，靠 jarProbe 实物对账才抓出）。
- **正确流程（merge-first）**：任务实现全绿 → merge 前审查 → `merge --no-ff` 入 main → `tf.mjs deploy --branch main --version <V>` → 部署验证清单（实物 md5 对账+指纹翻新+迁移日志哨兵+行为探针+冒烟+**多环境附属核对**：存在测试/预发等附属套时其容器版本必须同步到同版本——旧版本经共享资源写正式数据=污染源，2026-10-26 沉淀）→ 真机验收 → `accept --pass` → 归档。verifying = 已部署已合并等真机验收（I16 敞口「已部署未合并」形态在此流程下天然消失）。
- **实物对账不可省**：任何部署后第一验证 = jarProbe/实物 md5 与本地构建比对（tag 正确 ≠ 内容正确——tag 来自主仓库 HEAD 时尤其如此）；md5 不变 = 空转部署，查构建检出区。
- **无 main 断言的项目**（commands 直跑分支构建/rsync 旧形态）不受此防呆影响，`--branch <任务分支>` 照常工作。

## 预检参数

| 参数 | 说明 |
| --- | --- |
| `--branch <分支>` | 必填，部署分支 |
| `--web-only` | web-only 部署跳过血统门（jar 不动；web 血统由构建后签名册哨兵保证）；实况核验仍跑（基线完整性检查，与部署内容无关） |
| `--server <host>` | 目标服务器（必填，按项目显式配置；本脚本不带默认主机） |
| `--state-path <路径>` | 服务器上 live-state 路径（缺省 /opt/<app>/live-state.json，按项目适配） |
| `--state-file <本地路径>` | 直读本地文件替代 ssh（测试/CI/无 ssh 环境；--record 同样写本地） |
| `--proc-probe <cmd>` | ③进程清点 opt-in（v2.62.0）：配置探针命令才启用，输出行协议 `JARMTIME/CPIDS/PROC/UNIT/CONT/IMGLATEST`（判定：容器与 systemd 并存/旧镜像容器/latest 指针缺失/游离 none-type 进程/进程早于 jar mtime/皆无=红）；project.json `deploy.procProbe` 经 `tf.mjs deploy` 自动透传；无配置=信息级跳过——探针命令属项目侧事实（容器名/镜像 tag/unit 名全项目异构），不进模板 |
| `--record ...` | 登记模式：`--branch --commit --jar-md5 --version` 必填 + `--jar-path`（服务器 jar 路径，启用实况核验——强烈建议）；`--task/--by/--rollback/--web-version/--web-fp` 选填 |
| `--record --web-only ...` | web-only 登记：`--web-version` 必填 + `--web-fp` 选填；jar 沿用基线（须已有基线，首次登记仍走全量） |

## 实况核验（2.40.0）

- **机理**：live-state 是「声称的基线」，服务器上的 jar 是「事实」——预检时实测事实与声称比对。未登记的部署必然改变实际 jar 的 md5 → 下次预检必红，缺口从不可探测变必红（治「B 部署不登记 → 基线停在 A → C 含 A 照常绿 → B 被静默滚回，门全程绿」）。
- **`jar.path` 语义随模式**：ssh 模式 = 服务器上的 jar 路径（`md5sum \|\| md5 -q` 远端实测）；`--state-file` 模式 = 本地文件路径（node crypto 读取，测试替身）。
- **红/跳过规则**：md5 不符 = 红（任何模式）；ssh 模式读不到 md5（路径错/权限/ssh 不通）= 红（要部署的服务器都读不到，基线不可信）；`--state-file` 模式本地不可读 = 信息级跳过（服务器路径在测试替身下不存在属预期）；基线无 `jar.path`/`md5` = 信息级跳过（存量基线向后兼容——补登记 `--jar-path` 后启用）。
- **web 维度无实况核验**：web 入口指纹的实测核验是项目侧签名册哨兵的职责（本技能够不到线上 entry URL）——web 声称与实况的分叉靠签名册编号连续性暴露（#65 覆盖 #64 事故的治理载体在项目侧）。

## live-state schema（live-deploy-state/1）

```json
{
  "schema": "live-deploy-state/1",
  "updatedAt": "ISO8601",
  "by": "<会话标识>",
  "jar": { "version": "", "md5": "", "branch": "", "commit": "", "task": "", "rollbackPoint": "", "path": "<服务器jar路径——2.40.0 增量可选，登记后启用实况核验>" },
  "web": { "version": "", "entryFingerprint": "", "note": "" },
  "env": {}
}
```

血统门只认 `jar.commit`；实况核验认 `jar.md5 × jar.path`；web 缺口（声称部署但 note 记录未上线）不拦 jar 预检——web 血统由签名册哨兵保证，基线 note 负责把缺口从静默变可见事实。schema 版本不因 `jar.path` 升版（增量可选字段，旧基线/旧读侧零迁移）。

## 凭证门约定（credgate，v2.62.0 自历史空包事故上游化）

前端凭证（打包时内联进产物的 VITE_*/NEXT_PUBLIC_* 类键）缺位不报错、上线即「未配置 XX」白屏——git 对此不可见，本约定把「构建源在位 + 产物携带 + 线上在位」三道检查标准化。三道各司其职：preflight ④管构建源（部署前）、项目构建脚本管产物（构建时）、探针（渲染产物 scripts/harness/credential-probe.mjs）管线上（部署后）。

- **键清单单一定义点 = deploy/frontend-credentials.json**（CWD 相对；项目根起）：`{ "envPath": "frontend/.env", "keys": [ { "name": "<键名>", "chunkHint": "<命名 chunk 提示，可省>" } ] }`。envPath 缺省 frontend/.env（探针与④段同径都认）。新增凭证键必须登记此处再接入检查——多处手抄键清单=漂移温床。**只判在位性，不做值格式校验**（格式门误杀真值先例：企微 corpid 非 ww 前缀）。值零落纸：任何检查的输出/日志只准出现键名，绝不回显值。
- **preflight ④段（自动生效）**：清单在→逐键断言 envPath 内在位非空（缺=红）；清单不在→信息级跳过（非前端项目零负担；跳过必须显式可见，禁静默降级）。**④按 CWD 取构建源**：任务 worktree 内跑 preflight 查的就是该 worktree 的 .env——分支部署等价命令链必须在任务工作树内跑 preflight。与②的 git-common-dir 簿记定位刻意不同（②查 .taskflow 簿记、恒在主仓库；④查「本次构建将用哪份检出」），勿「统一」。
- **构建脚本接法（项目自接，约定配方）**：`npm run build` 成功后、打包/分发前——a) envPath 逐键在位非空；b) 对构建产物目录递归 `grep -rIFl -- "<值>"`（定字面量）每键至少 1 命中，零命中=红（内联空串=构建时 env 缺失）。全量扫不点名 chunk——chunk 落点会漂。参考实现：项目自接的 deploy/check-frontend-credentials.sh 类脚本（解析规则与探针同源）。
- **探针接法（部署后兜底）**：project.json deploy.commands / webCommands 在 ping 之后追加 `node scripts/harness/credential-probe.mjs --base-url <线上入口URL>`——GET / 收集 chunk→逐键断言值字面量在线上产物中（命名 chunk 优先、缺失降级全量、只报键名）。mech install DEPLOY_GATE 渲染该探针；不接线=纯死文件（采纳对账只查存在性，接线是项目自己的部署链义务）。
- 夹具：tf.test.mjs 真跑④红/绿/跳过三路 + ③ opt-in 跳过/探针注入红绿 + 探针红/绿/无清单跳过三路。

## 采纳与延迟加载

- `node tf.mjs mech install DEPLOY_GATE`：渲染 `scripts/harness/deploy-preflight.mjs`、`scripts/harness/credential-probe.mjs` 入项目 + conventions 补记（部署协调四件套节）+ AGENTS 红线镜像 + 采纳登记（doctor 采纳对账产物存在性）。**已装项目升级到 2.40.0+ 行为须重跑一次 `mech install DEPLOY_GATE --yes` 刷新项目侧脚本快照**（渲染是快照不是引用；已装版本漂移刷新属确认闸场景，未带 `--yes` 拒绝落盘并打印将覆盖文件清单，v2.65.0）。**渲染是快照不是引用——项目侧定制 deploy-preflight/credential-probe 必须上游化或迁项目自有文件，整文件覆盖已有文件须过 `--yes` 确认闸（清单先行，不再静默）**（v2.62.0 教训：进程清点段本地定制未上游化，mech 刷新即静默删段；v2.65.0 机械闸收口）。
- **延迟加载**：项目未装时门降级通过，首个部署触点（merge.md 第 6 步）识别并呈报一次安装建议——禁静默降级、禁未问先装（硬规则 22 同款纪律）。
- **首次采集基线**：人工核实线上实况（systemctl cat 拿 EnvironmentFile → jar md5 → 签名册），以 `--record`（含 `--jar-path`）补录；基线缺位时预检红属预期，不许为绿灯编造基线。
- **部署清单呈报走 PLAIN_SPEECH_GATE（硬规则 24）**：部署命令清单是五类正式呈报之一——落 `.taskflow/<id>/briefing-部署清单.md` 过 `validate-plain-speech.mjs` 后再呈报用户；清单里 DEPLOY_GATE/让位/敞口等词必须带大白话括号（词表 references/glossary.md），用户要能一眼看懂每条命令会做什么、哪步可回滚。
- **宿主侧加固（TASKFLOW_GUARD，v2.45.0）**：部署墙是本门在宿主层的延伸——omp extension（`.omp/hooks/pre/taskflow-guard.js`）拦 bash 工具里的 rsync/scp 部署特征与 ssh+systemctl restart，提示必经 deploy 入口；默认警告模式，项目观察稳定后 `TF_WALL=enforce` 切硬拦。检测归脚本、强制归宿主——绕过入口在物理层失效（细则 references/taskflow-guard.md）。

## fixture

tf.test.mjs DEPLOY_GATE 节：`--state-file` 模式真跑脚本——基线 commit ⊆ 分支 → 退出 0；基线不在血统 → 退出 1 且报「血统门/并集优先」；`--record` 登记后复检闭环 → 0。2.40.0 加固断言：实况核验绿路（md5 实测一致 → 0）/ 红路（篡改 jar 内容 → 1，未登记部署必红）/ 无 jar.path 向后兼容跳过；`--record --web-only` jar 沿用基线 + 无基线拒绝；record 缺参拒绝；verifying 让位机械化红路（验收中任务分支 ⊄ 部署分支 → 1）/ 并集绿路 / 分支引用缺失信息级；worktree 内跑（git-common-dir 定位主仓库 .taskflow）；lint 版本一致性红/绿两路（篡改副本真跑）。v2.62.0 凭证门块：④绿/红/无清单跳过三路（tmp 仓真跑，红路只报键名值零落输出）；③ opt-in（无 --proc-probe → ℓ 跳过；探针注入红/绿两路真跑行协议）；deploy 入口 procProbe 透传断言；探针三路（--base-url 指向本地 http 静态服务夹具真跑 curl 链）；mech 渲染过滤 DEPLOY_GATE 双产物落点断言。
