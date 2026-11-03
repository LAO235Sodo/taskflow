# 贡献指南 / Contributing

感谢愿意为这个技能出力。这个仓库是**公开仓**，git 历史不可变——一次 commit 就等于一次发布，所以贡献流程的核心只有一件事：**别把不该公开的东西带进来**，其余交给 CI 和维护者。

## 提交流程（五步）

1. **Fork** 本仓库，从 `main` 拉一个功能分支（`git checkout -b feat/xxx`）；
2. **改动**——保持聚焦：一个 PR 解决一件事；
3. **提交前自查**（CI 也会跑同样的三件事，红灯自己修最快）：
   ```bash
   node scripts/tf.mjs hygiene        # 公开仓卫生扫描（block 词=拒绝）
   node scripts/tf.mjs lint           # 文档/登记表一致性
   node scripts/tf.test.mjs           # 全量回归
   ```
4. **开 PR**——按模板填「变更说明」（必填：改了什么、为什么；维护者合并后会搬进 Release notes）；
5. 等维护者审查。合并后由维护者发版（tag + GitHub Release 自动生成）。

## 红线：什么绝不进提交

| 类别 | 例 |
| --- | --- |
| 真名 | 公司、项目、系统、产品的真实名称 |
| 个人标识 | 工号、用户主目录路径、内网账号 |
| 内网拓扑 | 内网 IP、内部域名、服务器路径 |
| 凭据 | 密钥、密码、token、私钥（视同泄漏处置） |

黑名单唯一源是 `assets/harness/hygiene-terms.json`；机制细节（替换规范、豁免标记 `hygiene-ok: 理由`、事故处置）见 `references/public-hygiene.md`。示例数据用明显假的值：`example.com`、文档保留段 `192.0.2.x`。

## 仓库纪律（改代码前必读）

- **`scripts/tf.mjs` 是单文件 CLI**（拷贝即用、无构建）——不要继续拆分；可测试的纯函数放独立模块（先例：`scripts/release-notes-lib.mjs`、`taskflow-state-machine.mjs`）。
- **不要动 `CHANGELOG.md`**——它不在这个仓库里（维护者本地维护）；PR 模板里的「变更说明」就是给它准备的素材。
- 改了机制/文档，同步更新 `references/data.md` 对应行——lint 会检查触点可达性。

## CI

PR 和 push 到 main 都会自动跑上面三件事（`.github/workflows/ci.yml`）。全绿不代表一定被合并，但红灯一定先修。

---

## Quick English

1. Fork → branch from `main` → one focused change per PR.
2. Before pushing: `node scripts/tf.mjs hygiene && node scripts/tf.mjs lint && node scripts/tf.test.mjs` — CI runs the same three.
3. Never commit real company/project names, personal IDs, intranet IPs or credentials. Use obvious placeholders (`example.com`, `192.0.2.x`). Blocklist source: `assets/harness/hygiene-terms.json`; details in `references/public-hygiene.md` (Chinese).
4. Fill the PR template's change description — the maintainer turns it into Release notes. Do NOT touch CHANGELOG.md (maintained locally, written after merge).
5. `scripts/tf.mjs` is a deliberately single-file CLI — do not split it further; testable pure functions go to separate modules (see `scripts/release-notes-lib.mjs`).
