# carrier 包 — 五载体技能（能力接口）

> 能力包（v3.0.0）：五个可装可卸的分析技能，按**能力接口**契约写（依赖倒置——引用方依赖接口而非技能名）。装不装由项目 profile `carriers.decision` 一次拍板（init 单问卷），此后不再逐任务注记；未装时按 profile 降级注记一次（纯纪律档承载）。
> 安装（CARRIER_SKILLS）：`node <skill目录>/scripts/tf.mjs packs install carrier --all`（或点名）；安装位缺省 `~/.agents/skills/<名>/`。

## 五载体契约

| 技能 | 输入 | 输出 |
| --- | --- | --- |
| scope-assessment | 需求描述+候选改动面 | 「N 页面/M 接口/K 文件」枚举 + 单会话容量对照 + 超限拆分建议 |
| impact-analysis | 改动集 | 消费方清单（文件:行号+消费性质）+ 牵连模块表 |
| data-boundary | 改动集 | 涉数据管道边界枚举 + 上下游影响面（量/时间/值/一致性/展示五维） |
| conflict-triage | 两任务写集 | 重叠面 + 冲突分级（可并行/需排序/需拆分） |
| page-forensics | 页面级故障现象 | 页面↔接口映射 + 取证清单（网络面+视觉面双轮证据） |

细则各自住 `packs/carrier/<名>/SKILL.md`（≤60 行薄接口技能）。

## 与核心纪律的接线

核心「变更影响盘点」一条（原 14+25 合并，F21/F43）：动手前列消费方清单（载体=impact-analysis）、修复前扫同类、范围评估（载体=scope-assessment）、并行写预警转拆分协调（载体=conflict-triage）、涉数据管道（载体=data-boundary）、页面级故障（载体=page-forensics）。**缺装=按 profile 降级注记一次**（`skills` 检测 + 别名命中：冲突分级/范围/影响面/数据边界/页面取证），不再逐任务追问。

## 事故档案

- v2 时代五载体声明装在 omp 位却不存在（注册表 install 字段指向本机死路径，换机即失）→ v3 实体化随包分发（F07/F43）。
