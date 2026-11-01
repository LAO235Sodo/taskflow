# 数据模型对照门细则（DATA_MODEL_GATE，硬规则 28）

> 细则唯一载体：分诊判定、真源纪律、提取器口径、对照表列定义、收尾行格式、已知边界与豁免通道都在本文件。
> 机制登记：references/data.md 机制登记表 `DATA_MODEL_GATE` 行。机械面：项目 `scripts/harness/validate-data-model-gate.sh`（mech install 渲染）+ `validate-changelog.sh` 收尾串接。

## Why（这门防什么）

本仓数据口径返工是返工大头，但治理全在**变更侧**——硬规则 14 消费方清单（动手前）、硬规则 25 同类排查（修复前）、decisions/ 沉淀（出事后）。「设计侧」在动工前确认字段口径/表结构/多源一致的产物步骤与拍板门，在本门之前一道都没有。实证：`.taskflow/decisions/` 口径类决策占比近半；同一字段语义返工到第 7 轮才沉淀；主工作流表一族在两份 schema 文件双源定义且已经漂移（会话标题/归档/置顶三列只在其中一份）。前端视觉轴有规格表/基线/样式真源/渲染证据四道机械门，数据轴零道——本门补齐，且按「轻形态」设计：不引入三层模型/ER 图产物/评审会，全部必要确认压进**一张对照表 + 一次拍板 + 收尾一行**。

## ① 全任务分诊（每个任务的第一个问题）

立项必答：**本任务动不动数据模型？** 判定落 spec 一行（全员必填，模板已带占位）：

```
数据模型分诊：涉及——<理由>
数据模型分诊：不涉及——<理由>
```

- 不涉 = 付一行理由，其余全免（不提取、不建表、不拍板）。
- 涉 = 走②-⑥。
- **判定依据（三路合取，任一命中即涉）**：
  1. **预期改动文件集合 × 谓词初筛**（下文谓词全文；命令：`grep -nE '<路径层谓词>' <预期文件清单>` 或直接跑门脚本默认模式试判）；
  2. **需求词信号**——需求描述含「加字段／加表／删列／改含义／改单位／改枚举／改位序／改契约／迁移」类词；
  3. **编排层判断**——DTO 纯改名、JSON 契约字段调整等谓词漏网形态（机械下界之上的人工上界）。
- **分诊漏判兜底（双保险）**：分诊写不涉但收尾 CHANGELOG 条目反引号资产命中门谓词 → 门红；merge `--spec` 模式同样以谓词复核分诊结论，错配=红。

## ② 真源目录（docs/data-model/）与 lock-file 纪律

```
docs/data-model/
  data-model-extract.json     机器真源（schema=data-model-extract/1；AI 与门脚本消费）
  data-model-extract.md       人读渲染（五节：表清单/实体↔DDL 一致性/重复定义/依赖/unresolved）——同一提取器同次产出
  DATA_MODEL_DECISIONS.md     拍板日志（只增不改；记录格式见文件头说明）
```

- **lock-file**：`data-model-extract.json|.md` 的内容**只能由提取器再生**——DDL/实体变更收尾必须重跑刷新（门红灯管）；**手工编辑真源产物=违规**（改了也会被下次提取覆盖）。
- **单源双形态**：JSON 给机器（AI 盘点、门校验 schema 头），.md 给人（读依赖图/重复定义/mismatch）；不存在需要手工同步的第二份产物——变更=再生。
- 目录进 git；对齐 `docs/ui/style-source/` 真源先例。
- 刷新命令：`node scripts/design/extract-data-model.js --root <扫描根> --out docs/data-model`（out 缺省即 `<root>/docs/data-model/`）。

## ③ 提取器口径（extract-data-model.js）

- 扫描面：SQL DDL = 全部 `.sql` 文件；实体 = `.kt/.java` 中含 `@TableName/@Entity` 的文件（天然覆盖 `data/` 这类非 entity 命名目录）。跳过 node_modules/.git/build/dist；文件数超 3000 截断并在 stats 注记。
- 一文件多实体（如 `AgentWorkflowEntities.kt` 连排多个 `@TableName` 类）按注解分段解析，不会串类。
- **依赖启发式（三级确定性，多义不猜）**：显式 `FOREIGN KEY … REFERENCES` → `fk`；列名 `*_id` → ①直接同名（单/复数）②表名后缀 `_<候选>` 唯一命中 ③同模块前缀（from 与候选共享首 `_` 段、排除自身）唯一命中 → `implicit-id`；三级都不唯一/不命中 → `unresolved` 注记（禁静默猜）。列 COMMENT 含「关联」只作人工核对加权，不作机械必要条件。
- 解析不了的（`@Entity` 无表名、异常文件）进 `unresolved[]`——诚实列出，**对照表允许手填但必须带源码证据锚**。
- **mappings 四类口径**：
  - `matched`——实体列集与 DDL 列集一致（大小写不敏感）；
  - `entity-only`——实体有 DDL 无（优先级最高的 mismatch 类别；差异列在 `entityOnlyColumns[]`）；
  - `ddl-only`——DDL 有实体无（`ddlOnlyColumns[]`）；两类并存时 result=entity-only，两个差异数组都保留；
  - `table-missing`——`@TableName` 对不上任何已提取 SQL 表。
- **处置规则**：涉该表的任务，对照表「迁移/兼容」列必须注记 mismatch 处置（本次修齐 / 存量漂移待处理+理由）；**存量 mismatch 本身不阻塞无关任务**（不要求全仓清零才能干活）。

## ④ spec「数据模型对照表」节（七列）

| 列 | 填法 |
| --- | --- |
| 表或实体 | 表名或实体类名（涉实体↔DDL 映射时两个都写） |
| 字段 | 列/属性名；整表级改动写「（整表）」 |
| 现状 | **唯一合法源 = 提取器产物 + 源码证据锚（`文件:行号`）**；同名表多处定义（duplicates 命中）**必须列全全部定义源**；提取器未覆盖的形态手填但必须带锚 |
| 变更后 | 新类型/单位/枚举值/口径（外部展示单位等语义一并列） |
| 消费方 | grep 实证清单（硬规则 14 不降级；依赖图 .md 反向索引作机械起点） |
| 迁移/兼容 | 迁移脚本/默认值/兼容读法；**涉表 mismatch 处置注记落这列** |
| 拍板 | 用户拍板结论；`豁免——<理由>` 合法（须真豁免，防橡皮图章） |

- **拍板列未填禁动工**（new-task 第 11 步派发核对 + merge 阶段三双设）。
- 现状列锚一律指**源码**——真源 JSON 仅作盘点索引，不是证据本身（锚纪律不因真源存在而放松）。

## ⑤ 收尾「数据模型：」行（三段格式 + DDL 子段）

CHANGELOG 条目反引号资产命中谓词 → 条目块必含：

```
数据模型：<spec 对照表路径 或 提取 JSON 路径>；同步：<≥1 项同步动作>；真源：已刷新
```

- **同步：**列迁移脚本/契约更新/消费方同步/DDL 其余定义处处置，至少一项，空=红。
- **真源：已刷新**——门复核 `docs/data-model/data-model-extract.json` 存在且 schema 头合法。
- **DDL 子段**（条目涉 `.sql` 或内联 CREATE/ALTER 时追加）：`DDL：<各受影响表其余定义处处置 + 迁移>`——如「DDL：sample_table 其余 1 处已同步、实体已改；无迁移」。
- 廉价通道：`数据模型：不适用——<理由>`（理由必填，防静默绕闸）。

## ⑥ 门谓词全文（路径层 + 内容层）

- 路径层：`\.sql$|(^|/)(db/migration|flyway|liquibase)/|(^|/)(entity|entities|po|pojo|model|domain|data)/[^/]*\.(java|kt|ts|js)$`
- 内容层（反引号路径指向的仓内**代码**文件才查；文档与不存在文件只走路径层）：`@(TableName|Entity)\(|@Table\(`（实体面）与 `CREATE TABLE |ALTER TABLE `（DDL 面——触发 DDL 子段义务）。
- 误伤走廉价通道（如 `data/` 目录放非实体代码、文档引用 DDL 片段）：一行理由了事——与基线门同取舍。

## ⑦ 已知边界（棘轮位——攒第二次实证再机械化）

- 「现状列是否列全 duplicates 全部源」「涉及表 mismatch 是否在迁移/兼容列注记」——v1 由 merge 编排层对照提取器 .md「重复定义表」节语义核对，门不做 JSON 交叉。
- 谓词漏网（无注解 DTO、跨服务契约）靠 spec「改动文件集合声明」+ 编排层判定兜底。
- 提取器只覆盖 SQL DDL + JVM 注解实体；其他栈（Go struct tag / TS ORM decorator 等）按实证需求再扩。
- 服务内联 `CREATE TABLE`（字符串块里的 DDL）由内容层谓词抓触发义务，但提取器不解析内联 DDL 为列级事实——对照表现状列手填+锚。
