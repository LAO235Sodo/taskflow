# host-adapters 包 — 宿主防护层

> 能力包（v3.0.0）：宿主（omp）扩展的规则与资产。**宿主差异单点 = `assets/shared/host-adapter.mjs`**（detectHost/usagePath/planScanDirs/guardTargets/redlineFile/canaryCmdBin）；本包含 omp 专属扩展本体。
> 安装：`node <skill目录>/scripts/tf.mjs mech install TASKFLOW_GUARD`——**仅 omp 宿主**（adapter 检测）；其余宿主打印「本宿主无守门通道，已降级纯纪律档（conventions 红线 + doctor）」不落盘。

## guard 16 项语义（omp extension 住 `.omp/hooks/pre/taskflow-guard.js`）

- **D 状态栏常显**：进行中N/等你验收M/已上线超24小时未合并K 常驻底栏（I16 持续可见性）；
- **B 簿记校验**：`commit --files` 空格分隔多文件硬拦（逗号才对）；`deploy` 缺 `--web-only` 而项目配了 webCommands → 注入提醒；
- **C 压缩接力注入**：压缩摘要自动携带 taskflow 接力线索（任务 id/状态/分支 + 恢复入口）——「先存档再跑」的宿主兜底；
- **E 输出规范注入**：每轮把「术语/代号首现后跟括号大白话 + 项目词表」前置进请求（messages 头插主形态；词表活读项目 glossary）；
- **I 词表反馈沉淀**：检测「看不懂」类反馈，词表未改写则逐轮注入沉淀指令；
- **A 部署墙**：rsync/scp/ssh+restart 疑似绕过部署唯一入口——默认警告，`TF_WALL=enforce` 硬拦；
- **V 渲染证据提醒**：样式载体改动+任务分支+无证据 → 每任务一次弹提醒 + 逐轮催 + 压缩兜底（`TF_V_WARN=off` 关）；
- **U 状态引导注入**：active/verifying/parked 三态引导行 + 未完成子任务清单（状态翻转唯一写路径=扳机命令，禁手改 status）；
- **J 状态翻转墙**：edit/write/bash 手改 task.json/index.json 的 status 物理拦截（`TF_STATUS` off/warn/enforce，缺省 enforce）；
- **K 验收期提醒**：等验收任务在档时 push/merge 先提醒合并时序（不拦）；
- **T 技能加载埋点**：skill:// 读取计数（`tf.mjs skills --usage` 报表，仅 omp 有埋点文件）；
- **H blocker 三问提醒**：子代理报告含 blocker 特征时注入同类排查三问（来源限定）；
- 越界编辑警告 / 派发 spec 机械注入 / 环境变量开关面见 `packs/host-adapters/taskflow-guard.md`（v3 保留）与 `mechanisms` 命令输出。

## 包内资产

- `assets/guard/taskflow-guard.js`——omp extension 模板（渲染枚举注入 + shared 内联自包含）；
- `pi/taskflow.ts`——pi 宿主扩展（380 行，v2.90.0 agents 安装位抢救）；新宿主适配器按 `assets/shared/host-adapter.mjs` 的函数面实现。

## 事故档案

- 2.84.1 实锤：before_provider_request 的 payload 形状随 provider transport 而定，向 payload.system 写入被静默丢弃=E/U/V 三墙 no-op 19 天 → 注入落点收拢 host-adapter（messages 头插主形态）+ canary 金丝雀。
