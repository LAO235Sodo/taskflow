# deploy 包 — 部署协调门

> 能力包（v3.0.0）：部署方向的规则与机械面。核心 SKILL.md 只留确认原则（远程部署命令执行逐条确认）；细则住本包。
> **形态分档（F20；schema 单源=DEPLOYMENT_PROFILE：project.json 节白名单/deploy 形态枚举/验证分级注解唯一出处）**：`project.json deploy.form` 声明——`jar`=服务器 jar 包（ssh/md5 实况对账/血统门，本包机械面全装）；`generic`=通用命令清单（conventions「推送与部署」登记命令 + 部署确认门 + `deploy` 入口 `--record` 登记，jar 资产不装）；`none`=无部署。

## 规则全文（DEPLOY_GATE，原硬规则 23）

1. **部署必经唯一入口** `tf.mjs deploy --branch <部署分支> [--web-only] [--version V]`（DEPLOY_ENTRY）——门禁内嵌（deploy-preflight 实况核验 + 血统门 + verifying 让位），红=拒绝执行，绿=按 project.json deploy 配置执行 + 自动 `--record` 登记；**绕过入口的手工部署=漏登记=doctor I17 对账必红**。
2. **部署分支防呆（merge-first）**：deploy commands 含 main 检出断言的项目，`--branch` 非 main → 入口拒绝——先 merge 进 main（前置=merge 审查）再 `deploy --branch main`。
3. **conventions 接线**：mech install DEPLOY_ENTRY 把「部署必经入口」补记进项目部署确认清单（第⓪项）。
4. **I16 敞口不变量**：verifying 任务已部署未合并 main 超 24h=红（main 构建部署将静默滚回；ls 待验收块 ⚠敞口 标记；accept --pass 打印收口三件事）。
5. **I17 实况对账（jar 形态）**：live-state md5 vs 服务器实际 jar md5（jarProbe 实物探针优先；ssh 只读；无配置/不可达=信息级跳过）。
6. **租约与让位 + 验收即合并**：部署租约由入口自管（ttl 1800，无需手动 lock）；任一任务 verifying 期间非并集/非本体的部署让位（预检机械拦）；**用户回「验收通过」= 立即 merge main + main 重建替换包部署 + accept --pass**（顺序勿反）。
7. **generic 形态**：部署命令清单登记在 conventions「推送与部署」节（用户拍板入档）；执行前逐条呈报确认（确认档位 detailed 下逐条）；执行后 `deploy --record` 登记版本指纹（无 ssh/md5 面）。

## 产物

jar 形态 mech install：`deploy-preflight.mjs`（预检+登记）+ `credential-probe.mjs`（凭证探针）；细则唯一载体 = 包内 `deploy-gate.md`（v3 从 references 迁入）+ merge.md 第 6 步部署节。

## 事故档案

- 2026-09-29 治理被静默滚回等四起覆盖事故 → 部署协调门四件套。
- 2026-09-30 双包事故「门在但绕得过去」（部署会话没跑 preflight）→ 部署唯一入口物理化。
- 2026-10-16 任务分支直接 deploy 静默空转（构建了 main 同内容镜像实物不变）→ 部署分支防呆。
- 2026-10-08 拍板：不上服务器侧 cron，本地触点尽力而为，CI/CD 到位后被流水线替代。
