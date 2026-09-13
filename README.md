# taskflow

长任务跨会话的存档/恢复/合并管理技能，为 [OpenCode](https://opencode.ai) 及兼容 OpenCode skill 规范的编码代理设计。自动识别意图、无需指定动作词。

## 解决什么问题

- 会话太长怕丢上下文 → **checkpoint 存档**，新会话 **resume** 接着干
- 多任务并行互相踩踏 → 每任务独立 **git worktree + 分支**，物理隔离
- AI 忘记项目规矩 → **conventions.md** 项目约定文档，每个会话必读
- 覆盖别人新代码 → merge 前**强制同步主分支 + 全新上下文审查 + 你最终验收**
- 既有工作游离在体系外 → **adopt 收编**，评审卡确认后纳入管理

## 安装

```bash
npx skills add LAO235Sodo/taskflow -g -y
```

或直接克隆到 OpenCode 技能目录：

```bash
git clone https://github.com/LAO235Sodo/taskflow ~/.config/opencode/skills/taskflow
```

## 快速使用

| 你说 | 它做 |
| --- | --- |
| "给项目加个 XX 功能" | 新任务建档：fetch 最新主分支 → 建 worktree → 链依赖 → 写 spec |
| "先到这，明天继续" | checkpoint：更新交接文档 + git commit + 更新索引 |
| 新会话："继续上次那个" | 列任务 → git 事实核查 → 恢复摘要 → 接着干 |
| "做完了，合并吧" | 同步 main → 强制审查 → 部署验收（按项目 DoD）→ 你确认 → 归档 + 自动清理 worktree |
| "收编现有的分支" | 扫描 → 三板块评审卡 → 你逐个确认才纳入 |

## 设计要点

- **代码存 git 分支，叙事存 markdown**：状态文档永不进 git（`.git/info/exclude`）
- **四层索引**：全局注册表 → 项目 index → 任务 checkpoints → git commit（真相源）
- **轻重分档**：small/medium/large，small 档 merge 自查不派子代理
- **anchor 资产归属**：managed（taskflow 新建，自动清理）/ attached（挂靠你的分支，绝不自动删）
- **领域技能联动**：检测前端/后端/测试，按需注入 frontend-design、各栈最佳实践等技能
- **主仓库永远干净**：只作合并落点，所有任务住 worktree

## 结构

```
taskflow/
├── SKILL.md            # 路由器：意图识别 + 分档 + 动作路由 + 硬规则
├── references/         # 按动作按需加载
│   ├── data.md         # 数据结构 schema + 四层索引
│   ├── new-task.md     # 初始化 + 建档 + worktree
│   ├── checkpoint.md   # 存档（完整版/轻量版）
│   ├── resume.md       # 恢复 + 漏网检测
│   ├── merge.md        # 强制审查合并闭环（DoD 部署验收）
│   ├── adopt.md        # 收编（三板块评审卡）
│   ├── split.md        # 拆分与子代理派发
│   └── domain.md       # 领域技能联动映射
└── templates/          # handoff / findings / progress / spec / subtask-spec / conventions
```

## 版本

见 [CHANGELOG.md](CHANGELOG.md)。当前 v2.2.0。

## 兼容性

OpenCode V2（`~/.config/opencode/skills` 或 `~/.agents/skills` 自动发现）；其他支持 SKILL.md 规范的代理（Claude Code、Codex、Cursor 等）经 `npx skills` 安装亦可使用，个别动作引用的工具（如 session_move）不存在时按文件内兜底路径执行。
