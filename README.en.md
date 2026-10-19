<div align="center">

# taskflow

**Cross-session checkpoint / resume / merge management for long-running coding-agent tasks**

Works with **any agent that can read files and run shell commands** — OpenCode · Claude Code · Codex · Cursor · Hermes

Intent is auto-detected. There are no action words to memorize.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-green.svg)](scripts/tf.mjs)
[![platform](https://img.shields.io/badge/platform-any%20SKILL.md%20agent-orange.svg)](#installation)

**English** · [中文 README →](README.md)

</div>

---

![taskflow demo](assets/demo-en.gif)

## Table of Contents

- [How it works](#how-it-works)
- [Installation](#installation)
- [The problems it solves](#the-problems-it-solves)
- [Quick usage](#quick-usage)
- [Core concepts](#core-concepts)
- [Command quick reference](#command-quick-reference)
- [Multi-session & concurrency](#multi-session--concurrency)
- [Speed tips](#speed-tips)
- [Self-consistency checks](#self-consistency-checks)
- [FAQ](#faq)
- [Design points](#design-points)

## How it works

It starts from the first thing you say. You say "add an XX feature to the project" — taskflow doesn't write code first; it opens a dossier: fetch the latest main branch, create a dedicated git worktree, link dependencies, and interrogate your requirement into a spec. **Your main checkout stays clean from this moment on** — it is only ever a merge landing zone.

During implementation, the agent lightweight-checkpoints after every acceptance point. You say "that's it for today" — checkpoint: handoff doc + git commit + index refresh, all on disk.

The next day, in a fresh session, you say "continue the last one." taskflow silently inventories: lists every task, fact-checks against git (branch HEAD, worktree liveness, index consistency), then hands you a recovery brief rebuilt from git facts — not model vibes, but reconciled truth. A task waiting for your acceptance? It sits at the very top of the list.

"Done — merge it" — the merge gate opens: forced main-branch sync → review in a **brand-new context** (not the session that wrote the code reviewing itself) → report and wait for your confirmation → merge. Another session merging at the same time? A queue lock serializes you instead of letting you rebase-race.

Acceptance walks the "user acceptance" section of the spec you confirmed at task creation, on the real deployment. You reply "verified" — only then does the task land in `merged`, the worktree auto-cleans, decisions are distilled and archived. Want to iterate later? The archive step generates a re-entry one-liner you can paste into any new session.

The same `.taskflow/` dossier is readable and writable by sessions from any framework: a task opened by OpenCode today can be taken over by Hermes tomorrow — with a takeover ritual that inventories every uncommitted change before allowing a single commit.

## Installation

### OpenCode

```bash
git clone https://github.com/LAO235Sodo/taskflow.git
ln -s "$(pwd)/taskflow" ~/.config/opencode/skills/taskflow
```

### Claude Code

```bash
git clone https://github.com/LAO235Sodo/taskflow.git
ln -s "$(pwd)/taskflow" ~/.claude/skills/taskflow
```

### Codex / Cursor (npx skills)

```bash
npx skills add LAO235Sodo/taskflow -g
```

### Hermes Agent

```bash
git clone https://github.com/LAO235Sodo/taskflow.git
ln -s "$(pwd)/taskflow" ~/.hermes/skills/taskflow
```

### Any other agent (minimal intake)

No skill-directory mechanism? Just tell your agent where SKILL.md lives. The single CLI has zero dependencies: `node scripts/tf.mjs` with your local node.

## The problems it solves

- Sessions get too long, you fear losing context → **checkpoint** to save state; **resume** in a fresh session picks up exactly where you left off
- Parallel tasks trample each other → every task gets its own **git worktree + branch** (physical isolation); the merge endgame is serialized by a **queue lock**
- Multiple sessions fight over the same task → session leases + worktree owner credentials surface "someone else is on it"; **takeover** completes the handover in one command
- The AI forgets your project rules → **conventions.md** project conventions + a red-lines summary in the root AGENTS.md — double insurance
- Merging over someone else's fresh code → merges force a **main-branch sync + review in a fresh context + your final acceptance**
- Existing work floating outside the system → **adopt** brings stray branches/worktrees under management via a review card you confirm item by item
- Vague feedback ("the page feels messy") had no standard action → **feedback classification matrix**: rework follows a fixed pipeline; if the root cause turns out deeper, an **escalation confirmation gate** fires first
- The same mistake keeps repeating → **experience induction protocol**: criticism distilled into rule + Why + How, deduplicated, reviewed by you, written down in two places
- Process spinning forever → **STUCK escalation gate**: failing the same fix 3 times forces a report with exactly three options (change approach / narrow acceptance / revert). Silent retries forbidden.

## Quick usage

| You say | It does |
| --- | --- |
| "Add an XX feature to the project" | Opens a new task: fetch latest main → create worktree → link dependencies → write spec |
| "That's it for today" | Checkpoint: update the handoff doc + git commit + refresh the index |
| New session: "continue the last one" | List tasks → fact-check against git → recovery brief → keep going |
| "Done — merge it" | Sync main → forced review → deploy & acceptance per project DoD → your confirmation → archive + auto-cleanup of the worktree |
| "I'm taking over his task" | takeover: swap owner + refresh lease + print the desk inventory (no commits until walked) |
| "Both sessions are merging" | `lock merge` queues them: first come first served, latecomers wait, stale locks can be seized |
| "Bring these existing branches in" | Scan → three-panel review card → nothing adopted until you confirm each item |
| "This page's interaction is a mess" | Feedback classification → rework pipeline: comments become acceptance items → fix → report with visual evidence → re-acceptance |
| "Your process is wrong / you skipped a step" | Experience induction: distill a rule → dedupe → you review → record in CHANGELOG + conventions |

## Core concepts

| Concept | In one sentence |
| --- | --- |
| Task dossier | One set per task (spec/handoff/findings/progress/decisions/task.json) in `<main-repo-root>/.taskflow/<task-id>/`, never committed — **code lives in git branches, narrative lives in markdown** |
| Four-layer index | L0 global registry → L1 project index → L2 task.json → L3 git commit (**the single source of truth**; on drift, indexes are rewritten from task.json) |
| Physical isolation | Every task lives in its own git worktree (managed/attached); the main checkout area is only ever a merge landing zone |
| State machine | `active` →(deploy `--deployed`)→ `verifying` →(accept `--pass`)→ `merged` →(`archive`) filed away — **transitions happen only via script commands; hand-editing status is illegal**; undo via `git revert -m 1`, never by resurrecting old tasks |
| Size tiers | small (minimal ceremony) / medium (full pipeline) / large (every key decision gets a sign-off); when in doubt, round up |
| Invariants | The only spec home is `references/data.md`, the only code-side registry is `INVARIANTS`, `doctor --self` enforces three-source consistency |
| Mechanism registry | One token + touchpoint list per mechanism; lint enforces "a token absent from its touchpoint files = dead rule = red" |
| Confirmation gates | Create/merge/archive/remote-deploy confirmed one by one (high-impact never exempt); verbally switchable to a batch tier for low-impact gates |

## Command quick reference

| Purpose | Commands |
| --- | --- |
| Inventory & health | `ls` (task table + stray work) / `doctor` (invariant checks, `--self` verifies spec↔code) / `lint` (process-doc self-check) |
| State transitions | `commit --deployed` (deploy) / `accept --pass` (acceptance) / `archive` (file away) |
| Multi-session work | `takeover` (handover ritual) / `lock` (queue lock) / `commit --session` (optimistic-lock commit) |
| Retrieval & diagnostics | `scout` (history search) / `testplan` (test plan) / `diagnose` (evidence pack) / `nextid` (ID reservation) |
| Legacy & safe commits | `migrate` (old-directory relocation) / `commit --files` (declare scope) |

Full usage is whatever `node scripts/tf.mjs` (no args) prints; the authoritative write-entrypoint list is the script's header comment.

## Multi-session & concurrency

- **Physical isolation**: managed tasks each own an exclusive worktree; parallel tasks can't see each other
- **Work in flight is visible**: session leases (heartbeat expires after 30 min) + worktree owner credentials (.owner.json + pid liveness) — doctor proactively warns "someone may be on this, verify before continuing"
- **The takeover ritual**: previous session dead / lease expired → `takeover <task-id> --session <this-session-ID>` completes the ownership swap in one command and prints a desk inventory (every uncommitted change walked; no commits until done)
- **Optimistic locking**: `commit --session` refuses writes when the owner doesn't match — a dead predecessor can't steal the task back
- **Merge queueing**: `lock merge` serializes the endgame; two parallel tasks' merges go from "chasing each other's re-reviews" to "queuing"

## Speed tips

Measured data: the big cost of long tasks isn't the process itself — **it's waiting for humans and rework**. With a human driving on the same day, a medium task completes the full pipeline in 1.5 hours and a small one in 20 minutes; multi-day tasks spend nearly all wall-clock time in the gaps between sessions. Ordered by leverage:

### Tier 1: existing switches — one sentence to activate

| Switch | How to activate | What it saves |
| --- | --- | --- |
| **Batch confirmation tier** | Tell the agent once: "remember: confirmation tier is batch" (written into conventions, effective across sessions) | 3–5 interruptions per task — low-impact actions grouped into one end-of-batch report |
| **Say "small" explicitly** | Add "this one's small" when stating the requirement | Skips spec interrogation, full checkpoints, sub-agent review — saves 10–20 min of ceremony |
| **Batch acceptance** | Reply "this batch all passes" for several tasks at once | One reply clears several verifying tasks instead of each hanging for days |
| **Abandon out loud** | Tell a hanging task "abandon and archive it" | A hanging task has exactly two exits: "continue" or "abandon" — each is one sentence |

### Tier 2: change how you hand over tasks (fewer round-trips — rework is the hidden time sink)

1. **Give full context up front** — requirement, references/screenshots, acceptance criteria, explicit non-goals, all in one shot at task creation
2. **List all feedback at once** — number every issue in a single list; ten items in one list = one rework round; ten items in five messages = five rounds
3. **Decide key questions on the spot** — answer the interrogation queue while you're there; deferred questions leave the task suspended
4. **Dictate conventions once** — project-level rules are said once, written into conventions, automatically honored by every future session

### Tier 3: make the agent itself faster (mechanism layer, already built in)

- **Parallel sub-agents**: zero-dependency changes are split and dispatched; the orchestrator only decides and reviews
- **Multi-session multi-task**: two terminals, one task each — worktree isolation + queue locks already have your back
- **scout prevents duplicate research**: "how did we solve XX before?" — check the decision library first
- **Checkpoint and rotate sessions in time**: responses degrade in very long sessions; proactively rotating to a fresh session is often faster

## Self-consistency checks

This skill manages itself the way it manages tasks:

- **`doctor --self`**: invariants spec ↔ `INVARIANTS` registry ↔ doctor implementation — three-source drift turns red at commit time
- **Seven lint checks**: step references / numbering continuity / gate keywords / **mechanism touchpoint reachability** (token absent from touchpoint files = dead rule) / **no fact re-narration** / **neutral templates**
- **Ratchet principle**: the second field-proven occurrence of the same error class must be mechanized (semantics → schema/script); fixing only the docs doesn't count
- **Definition of Done for new features**: registry entry + touchpoints + mechanical check + red-then-green fixture + gate-line update, delivered in the same change

## FAQ

**Q: How is this different from Claude Code's built-in /compact or OpenCode's session resume?**
Those are framework-internal black boxes bound to a single tool; the narrative data isn't portable. taskflow's dossiers are plain markdown+JSON in `.taskflow/`, platform-neutral — a task opened by OpenCode today can be taken over by Hermes tomorrow, takeover ritual included (uncommitted-change inventory and all).

**Q: Why no database or server?**
Zero-dependency single-file CLI (tf.mjs). Code lives in git branches, narrative in markdown — git is already the source of truth; no need to rebuild it.

**Q: Won't this burn tokens?**
SKILL.md is a router; once the action is determined, only the relevant `references/<file>.md` is loaded. Inventory/health runs as read-only script output — it doesn't eat context.

**Q: Is it safe? Can it delete my work by accident?**
State transitions happen only via script commands; merge/archive/deploy are confirmed one by one; `commit --files` declares scope to prevent sweep-ins; foreign worktrees are never auto-deleted.

**Q: Does it work without git?**
Yes, in a degraded docs-only mode (project.json marked `"git": false`); worktree/branch/commit capabilities are disabled.

## Design points

- **Platform-neutral data**: dossiers are framework-independent; cross-framework handover is seamless
- **Facts to scripts, judgment to models**: `ls`/`doctor` output facts only; repair decisions belong to the model + human
- **Rule reachability**: mechanism registry + lint-enforced touchpoints — rules live on the fridge door, not in a drawer
- **The main repo stays clean forever**: only a merge landing zone; all tasks live in worktrees
- **Domain-skill linkage (two axes)**: domain axis × lifecycle-stage axis; the registry injects installed skills on demand and honestly annotates what's missing

## Structure

```
taskflow/
├── SKILL.md            # Router: intent detection + tiering + action routing + hard rules
├── scripts/            # tf.mjs — the single CLI (local node, zero dependencies)
├── references/         # loaded on demand per action (data.md is the only spec, enforced by doctor --self)
└── templates/          # task dossier templates
```

## Version

The single source of truth for versions is SKILL.md (frontmatter `version` + the version string at the end of its description, kept consistent by lint); the per-version CHANGELOG.md is maintained locally since 2.67.1 and is not distributed with the repository.

## License

[MIT](LICENSE)
