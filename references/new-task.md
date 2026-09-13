# 新任务

## 首次初始化（每个项目一次，检测到 `<主仓库根>/.opencode/tasks/` 不存在时）

1. `mkdir -p` 任务目录 + `decisions/`。
2. 写 `project.json`：

```json
{
  "key": "<规范化 key>",
  "name": "<目录名>",
  "repoRoot": "<主仓库根绝对路径>",
  "remote": "<原始 remote url 或 null>",
  "git": true,
  "createdAt": "<ISO8601>",
  "lastActiveAt": "<ISO8601>"
}
```

3. **gitignore 任务状态**（不污染 tracked 的 .gitignore，且对主仓库和所有 worktree 同时生效）：

```bash
grep -qx '.opencode/tasks/' <主仓库根>/.git/info/exclude 2>/dev/null \
  || echo '.opencode/tasks/' >> <主仓库根>/.git/info/exclude
```

4. 更新 L0 注册表 `~/.config/opencode/taskflow/projects.json`。
5. **生成项目约定**：读 `templates/conventions.md`，引导问答生成 `.opencode/tasks/conventions.md`（推送/部署节奏、验证清单、完成定义、环境端口注意、禁止事项；用户答不全的小节保留占位，后续随时补）。已存在则跳过。
6. 告知用户：已完成初始化。

之后每次任何动作结束时刷新 `project.json.lastActiveAt` 和 L0 注册表。

## 新任务流程

1. 定位项目 + 初始化（如上）。
2. **先读项目约定与决策库**：读 `.opencode/tasks/conventions.md`（推送/部署/禁忌，全程遵守）；`ls .opencode/tasks/decisions/`，凡与本次任务领域相关的决策文件读入上下文——避免重复踩坑、保持设计一致。
3. 与用户确认：**标题、一句话目标、规模分档**（small / medium / large 定义见 SKILL.md；分档决定流程轻重，small 有裁剪）。
4. 生成 id：`<slug>-YYYYMMDD`（slug 取标题 2-3 个关键词，小写 kebab-case）。
5. **一律建 worktree（从最新主分支拉起）**——新任务默认托管模式（`anchor: "managed"`）。仅当用户**显式要求**"就在当前分支/目录做"时才用挂靠模式（`anchor: "attached"`，复用当前分支，须提示并行风险）。默认路径：

   ```bash
   # 1) 拉最新（有 remote 时）；2) 从 origin/main 建任务分支 + worktree
   git fetch origin
   git worktree add ../<repo名>-<task-id> -b task/<task-id> origin/main
   # 无 remote → 依次 fallback：本地 main → master → 当前 HEAD
   ```

   主仓库检出区因此永远保持干净、只作合并落点；任何任务不在主仓库内直接改动。
   **依赖目录链接**（缓解全新检出无依赖的代价）：worktree 创建后，检测主仓库的 gitignored 依赖目录（node_modules / .venv / vendor / 构建缓存等），逐个符号链接进 worktree（`ln -s`）；链接不可行时提示用户按项目方式安装依赖。

6. 会话迁移：若主代理具备会话工作目录迁移能力（如 OpenCode 的 `tools.opencode.session_move`），把当前会话迁入 worktree；不具备则明确告知用户后续应在 worktree 目录下工作，并提示路径。
7. 从 `templates/` 复制初始化：`spec.md`（向用户收集验收标准）、`handoff.md`、`findings.md`、`progress.md`、`decisions.md`（空骨架）、`task.json`（schema 见 data.md）。
8. 登记 index.json（status=active）+ L0 注册表。
9. **领域检测**：读 `references/domain.md`，命中前端/后端/测试则按映射表注入对应技能要求。
10. medium/large：引导拆分（读 `references/split.md`）；拆完**必须先 checkpoint 再派发**。
