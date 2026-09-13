# 数据结构与四层索引

## 四层

```
L0  ~/.config/opencode/taskflow/projects.json     全局：项目 → 注册信息
L1  <主仓库根>/.opencode/tasks/index.json         项目 → 任务列表
L2  tasks/<task-id>/task.json                     任务 → checkpoint 历史 + 子任务
L3  git 分支上的 checkpoint commits                真相源：diff、message
```

**L3 是唯一真相源。** L0-L2 只是导航索引；精确追溯一律用 git：

```bash
git log --all --follow -- <文件>            # 反向：这个文件被哪些任务/commit 改过
git show <checkpoint-sha>                   # 某次存档的具体改动
git diff main...task/<id>                   # 任务全量改动
```

## index.json（L1）

```json
{
  "tasks": [
    {
      "id": "auth-refactor-20260913",
      "title": "重构认证模块",
      "status": "active",
      "tier": "medium",
      "branch": "task/auth-refactor-20260913",
      "worktree": "/abs/path/to/repo-auth-refactor-20260913",
      "sessionID": "ses_xxx",
      "createdAt": "2026-09-13T10:00:00+08:00",
      "lastActiveAt": "2026-09-13T18:30:00+08:00",
      "lastCheckpointCommit": "a1b2c3"
    }
  ]
}
```

status 取值：`active` / `verifying` / `merged` / `archived`。

`verifying` = git 已合并、部署/用户验收进行中；只有用户最终验收通过才落 `merged`（见 merge.md 第 9-10 步）。

## task.json（L2）

```json
{
  "id": "auth-refactor-20260913",
  "title": "重构认证模块",
  "goal": "一句话目标",
  "tier": "medium",
  "anchor": "managed",
  "status": "active",
  "branch": "task/auth-refactor-20260913",
  "worktree": "/abs/path",
  "createdAt": "...",
  "sessionID": "ses_xxx",
  "checkpoints": [
    {
      "ts": "2026-09-13T18:30:00+08:00",
      "commit": "a1b2c3",
      "summary": "完成登录表单校验",
      "files": ["src/auth/login.ts", "src/auth/types.ts"]
    }
  ],
  "subtasks": [
    {
      "id": "1-validate-form",
      "title": "表单校验",
      "status": "pending",
      "spec": "subtasks/1-validate-form/spec.md",
      "worktree": null,
      "branch": null
    }
  ]
}
```

anchor 取值：
- `managed`：taskflow 新建（task/<id> 分支 + worktree），生命周期全管，归档时自动移除 worktree
- `attached`：挂靠用户现有分支/worktree——不迁移、不改名、**绝不自动清理**，merge 后资产归用户

subtask status 取值：`pending` / `in_progress` / `done` / `blocked`。

## 任务目录布局

```
.opencode/tasks/<task-id>/
├── task.json
├── spec.md          # 任务规格：目标/验收/约束
├── handoff.md       # 交接：目标、决策(含否决方案)、已完成、下一步
├── findings.md      # 研究结论、踩坑
├── progress.md      # 会话日志（每次 checkpoint 追加）
├── decisions.md     # 本任务固化决策（归档时沉淀到项目决策库）
└── subtasks/<n>-<slug>/spec.md
```

## 项目级文件

- `project.json` —— 项目身份（key、repoRoot、remote、git 标志）
- `adopt-ignore.json` —— 收编忽略清单：用户选择忽略的分支/worktree 及原因，adopt 扫描时跳过
- `conventions.md` —— **项目约定（唯一事实源）**：推送与部署、验证清单、完成定义、环境与端口注意事项、禁止事项。跨任务存活；项目初始化时引导生成，口述新约定随时写入；红线摘要同步至项目根 `AGENTS.md`（OpenCode 每会话自动注入，双保险）
- `decisions/` —— **项目决策库**（`YYYY-MM-DD-<slug>.md`）。任务会结束，决策留在项目——**改类似功能之前先查这里**。注意：部署/验收类约定只住 conventions.md，不要重复记入决策库
