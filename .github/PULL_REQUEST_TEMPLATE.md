<!-- 中文在前，英文速览在后 / Chinese first, quick English below -->

## 变更说明（必填）

<!-- 这个 PR 改了什么、为什么改。维护者合并后会把它搬进本地 CHANGELOG，作为 GitHub Release notes 的素材——请写清楚行为变化。 -->

## 自查清单

- [ ] `node scripts/tf.mjs hygiene` 通过（无真实公司/项目名、个人工号、内网 IP、凭据；词表见 `assets/harness/hygiene-terms.json`）
- [ ] `node scripts/tf.mjs lint` 通过
- [ ] `node scripts/tf.test.mjs` 全量通过
- [ ] 我没有修改 CHANGELOG.md（该文件由维护者本地维护，不随仓分发，合并后由维护者代写）

---

## Change description (required)

<!-- What does this PR change and why? The maintainer will move this into the local CHANGELOG and use it as GitHub Release notes material. -->

## Self-check

- [ ] `node scripts/tf.mjs hygiene` passes — no real company/project names, personal IDs, intranet IPs or credentials (blocklist: `assets/harness/hygiene-terms.json`)
- [ ] `node scripts/tf.mjs lint` passes
- [ ] `node scripts/tf.test.mjs` full regression passes
- [ ] I did NOT touch CHANGELOG.md (maintained locally by the maintainer; written after merge)
