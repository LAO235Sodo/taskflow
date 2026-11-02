# taskflow 项目运行约定（红线摘要）

> 完整版见 `.taskflow/conventions.md`（不入库）。本文件每次约定变更时同步。

- 纯本地 skill 仓库：无部署；**push main 必须用户明确确认**
- 验证：`node scripts/tf.test.mjs` + `node scripts/tf.mjs doctor --all` + `node scripts/tf.mjs doctor --self` + `node scripts/tf.mjs lint` 全绿才算完
- 禁止：reset --hard / checkout -- . / clean -f / force push / branch -D
- 不变量 spec 唯一出处是 `references/data.md`，脚本与文档不得各自另立语义；**状态翻转只经脚本命令（--deployed / accept --pass / archive），禁手改 status**；prose 禁复述计数/范围（lint 事实禁改写强制）
- **棘轮原则**：同类错误第二次被实证必须机制化（语义 → schema/脚本），只修文档不算修完；新功能按 induction.md「新功能 DoD」交付（登记+触点+机械检查+fixture+门禁行，同一变更）
- **机制快照对账**（2026-09-30 拍板）：mech install 产物是快照不是引用——采纳登记版本 ≠ 技能版本 = 陈旧快照，doctor 采纳对账 / mech ls 点名提醒刷新，禁静默沿用；重跑 mech install 必刷回版本
