# 领域技能联动

taskflow 管任务流程，专业判断交给领域技能。写 spec 时检测领域，实现阶段注入，审查阶段复检。

**领域检测**（写 spec 时做一次，拆分时复核）：

| 信号 | 领域 |
| --- | --- |
| 需求含 页面/组件/样式/布局/交互/界面/仪表盘/落地页，或文件以 .tsx/.jsx/.vue/.svelte/.css/.scss/.html 为主 | 前端 UI |
| 需求含 接口/API/服务端/后端/数据库迁移，或改动以服务端代码为主 | 后端 API |
| 需求含 测试/单测/E2E/测试用例，或涉及 *_test.* / test_*.py / *.spec.* / *.test.* 文件 | 测试 |
| 服务端文件以 .java 为主 | Java |
| 服务端文件以 .kt 为主 | Kotlin |
| 服务端文件以 .py 为主 | Python |
| 服务端文件以 .js/.ts 为主 | Node |

**领域 → 技能映射**（只使用已安装技能；同一任务命中多个领域则叠加）：

| 领域/栈 | spec / 实现阶段注入 | merge 审查追加 |
| --- | --- | --- |
| 前端 UI（任何栈） | `frontend-design`（设计方向写进约束节） | 阶段三：`web-design-guidelines` 界面规范合规 |
| API/接口设计 | `api-design-principles` | 按其原则逐条核对接口定义 |
| Java | `java-springboot` | 按其最佳实践核对 |
| Kotlin | `kotlin-springboot` | 按其最佳实践核对 |
| Node | `nodejs-backend-patterns` | 按其最佳实践核对 |
| Python | —（暂无实现类技能） | `python-testing-patterns` 核对测试代码 |
| E2E / Web 功能验证 | `webapp-testing`（Playwright 实操验证） | 附带浏览器验证结果 |

实现注入方式：编排层用 skill 工具加载后，把要点摘录进 spec / 子任务 spec 约束节，并随 prompt 传给子代理（子代理自身具备 skill 能力则直接加载）。

**兜底**：领域技能不可用时按常规流程继续，并在结果中注明"未经 XX 审查"；映射表未列的栈（如 Go）暂无对应技能，走通用流程。

**扩展**：新领域技能按同一模式接入——spec 阶段检测领域 → 实现阶段注入 → 审查阶段复检。
