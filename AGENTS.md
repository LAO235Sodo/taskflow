# taskflow 项目运行约定（红线摘要）

> 完整版见 `.taskflow/conventions.md`（不入库）。本文件每次约定变更时同步。

## 四层纪律（v3.0.0）

1. **核心层（SKILL.md ≤60 行）**：只做路由与通用纪律——三铁律、15 条 A 类一行化纪律、确认原则、profile 触点；路由唯一载体=`references/entry-routes.md`（核心零栈私货、零机制代号、零事故叙事）。
2. **能力包层（packs/）**：栈特有规则与机械面住八包（frontend/jvm-data/deploy/docs-prd/changelog-gates/briefing/carrier/host-adapters），每包 manifest.json+PACK.md；未启用的包连一行都不加载（项目 profile 拍板）；机制机器注册表=`references/schemas/mechanisms.json`（`node scripts/gen-mechanisms.mjs` 生成，doctor I20 对账——改 manifest 必须重生成）。
3. **项目层（.taskflow/）**：profile.json（确认档位/包启用/任务类型裁剪）+ conventions.md（I19 完备性机械强制）；事故与教训沉淀 decisions/ 与 meta/recurrence.json。
4. **宿主层（host-adapters 包）**：宿主差异单点=`assets/shared/host-adapter.mjs`；omp guard 住 `.omp/hooks/pre/`，其余宿主降级纯纪律档。

## 红线

- 纯本地 skill 仓库：无部署；**push main 必须用户明确确认**
- 验证：`node scripts/tf.test.mjs` + `node scripts/tf.mjs doctor --all` + `node scripts/tf.mjs doctor --self` + `node scripts/tf.mjs lint` 全绿才算完
- 禁止：reset --hard / checkout -- . / clean -f / force push / branch -D
- 状态翻转只经脚本命令（--deployed / accept --pass / archive），禁手改 status；**accept --pass 前置=确认回执（confirm 命令落 confirmations.jsonl）**
- `.taskflow/` 不进 git；全局数据根=`TF_TASKFLOW_HOME`（缺省 `~/.local/state/taskflow`）
- prose 禁复述计数/范围（lint 事实禁改写强制）；全仓禁词清单见 briefing 包门脚本（自造词→传统术语）

## 棘轮原则（含对称退役）

- 同类错误第二次被实证必须机制化（语义 → schema/脚本），只修文档不算修完；新功能按 induction.md「新功能 DoD」交付（登记+触点+机械检查+fixture+门禁行，同一变更）。
- **对称退役**：门族连续 5 个任务零咬合（meta/gate-hits.jsonl 红/黄台账为证）= 卸载候选——doctor 出报表，用户拍板后才动，未拍板一律保留。

## 发版

改完代码 + 手写 `CHANGELOG.md` 顶条目 → `node scripts/tf.mjs release <version>`（版本写入→lint→回归→commit→tag→push origin main --tags，远程不可达=警告不失败）；各安装位 `self-update`。
