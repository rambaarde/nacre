# varve

> **varve** *(n.)* /värv/ — an annual layer of sediment. One is laid down each
> year: coarse and light in summer, fine and dark in winter. Count them like
> tree rings and you can read a lake's history year by year, thousands of years
> back. Nothing rewrites an older layer. New ones settle on top.
>
> **One layer per session. Nothing overwritten.**

One git-backed memory store for a whole company — every project, every
repository — with two doors onto the same files: agents read plain markdown,
humans read a portal generated from it and served from their own clone.

**Status: planning. M0 is built; nothing else is.** `skills/` holds the two
skill files (`varve-load`, `varve-publish`) and `store-template/` the store
scaffold — no CLI, no package, no portal. **M0 gates all package work**
(`docs/prd-v1.md` §0): if a second person neither reads nor publishes,
the PRD is cancelled rather than descoped. Anything beyond `skills/` and
`store-template/` is new work, not maintenance.

---

## Read first

Two internal documents, both gitignored:

- `docs/founder-thesis.md` — the spec. Wins on any conflict.
- `docs/prd-v1.md` — the build plan for the installable package. **M0 (the
  two-skill sharing experiment) blocks all package work**, and cancellation is
  an accepted outcome of it.

The design spec is `docs/founder-thesis.md` — **gitignored, local only.** It
holds the full rationale, competitive analysis, falsifiable hypotheses, and what
is deliberately out of scope. Read it before proposing scope changes; do not
restate its conclusions here.

If `docs/` is absent from your checkout, that is expected — this repository is
the consumer-facing front, and the strategy document is intentionally not
published. Ask before working from assumptions about scope.

Vault note (decisions + continuity):
`~/Documents/_global_ai_mem/_Ai_Memory/_projects/varve.md`
Session logs: `~/Documents/_global_ai_mem/_Ai_Memory/_session_logs/varve/`

## Related project

`~/Documents/opensource/create-ai-memory` — same author, shipped 2026-07-13,
public, MIT, npm `create-ai-memory`. Plain-markdown vault, session hooks,
adapters for claude/codex/gemini/cursor/opencode, 38 tests, zero runtime deps.

**It is varve's v0 at personal scope.** varve is that plus company scope, a
shared git repo, a publish gate, and a portal. Whether varve extends it or stays
a separate codebase is **an open decision** — do not assume either.

---

## What it is

Scope is three levels: **company → projects → code repos.** One store covers all
of them.

```
_ai_memory_company_context/        one private git repo per company
  _company.md                      cross-project facts, shared infrastructure
  _standards.md
  _team/_{who}/_profile.md         identity — company level, spans projects
  {project}/
    _project.md                    roster: repos + teams
    _handoff.md                    rolling, overwritten
    _decisions/ADR-*.md
    {team}/{person}/{project}-{YYYY-MM-DD}_{HH-MM-SS}.md    one file per SESSION
```

Each code repo carries a **committed** `.varve.yml` — `project:` plus `store:`
(the memory repo's URL) — so a fresh clone resolves both with no flag and no
prior `init`. It holds **resolution only**; the repo roster lives once, in
`_projects/{name}.md`. Never list sibling repos in `.varve.yml` — that is N+1
copies of one fact. `check` reports mismatches between the two and never
repairs them. Thesis §6.1.1.

## The positioning

> Everyone else builds **agent memory** — a database the agent queries.
> varve builds **team memory** — a document humans and agents share.

Both read the same bytes. Neither gets a privileged interface. Concretely: plain
markdown in git (reviewable in a PR, greppable, portable), nothing captured
silently, and a human door that is a real portal rather than a debug viewer.

---

## Hard constraints

Design gates, not preferences. A change violating one is wrong even if it works.

- **Exactly ONE LLM call in the system** — composing a session log when the
  human runs `varve log`.
  Never on the read path. Never in the background on a timer.
- **Zero inference on reads.** `brief`, `search`, `show`, `check` are file reads
  and index lookups.
- **Token ceilings:** `brief` ≤2,000 · `search` ≤500 · `handoff` ≤1,000 ·
  `check` ≤200 · errors ≤100. Over the ceiling means truncate and tell the agent
  how to get more — never exceed silently.
- **Latency:** log write <200 ms · brief <1 s · search <200 ms · portal rebuild
  <60 s.
- **Append, never reconcile.** No gardening pass, no dedupe-on-write, no
  background contradiction detection. This is the entire performance argument.
- **One file per session, never per day.** *(corrected 2026-08-04.)* Every write
  creates a new timestamped file; nothing is appended to or rewritten. Per-day
  filing collides on three-sessions-in-a-day and on one person with two
  machines, and the fix for that collision is merge logic on the write path —
  which the line above forbids. The author's own vault has run per-session for
  103 days; the weaker rule was written down by mistake.
- **`brief` is always project-scoped**, never company-wide. `search` is
  *different*: project-scoped by default, `--all` for company-wide, one
  keystroke in the portal (§6.4.4.1). Injection is **parent-session only** —
  never once per subagent.
- **There is never a global default store.** Resolution is flag → `.varve.yml`
  walking up → *error*. Never guess, never fall back. A default in user config
  is the one mechanism that could write company A's notes into company B's
  store. Failing loudly is the feature (§6.1.1).
- **Corrections are new layers carrying `supersedes:`, never edits.** Project
  slugs are immutable; display names live in frontmatter.
- **Filing is project-first: `{project}/{team}/{person}/`.** *(restructured
  2026-08-04, was member-first.)* `brief` is project-scoped and runs every
  session, so the hot path is one subtree. Team is a directory on the stated
  assumption people don't change teams — the one changeable path segment,
  deliberate. Profiles stay company-level; a person spans projects.
- **`_handoffs/` is the only file that gets overwritten**, and only because it
  is a cache — but a non-reproducible one. **A handoff may never contain a fact
  absent from the logs**, and `handoff` refuses to clobber hand edits without
  `--force` (§6.1.3).
- **"Conflict-free" covers session logs only.** `_company.md`, `_standards.md`,
  and the roster are genuinely shared-write; a git conflict there is correct and
  expected. Do not claim the store cannot conflict.
- **Reading is automatic; writing is one deliberate human act.** *(revised
  2026-08-04.)* `SessionStart` injects `brief` — timeout, fail open, never
  blocks, parent session only. **There is no write hook and no `_drafts/`
  folder in v1.** `varve log` composes, strips private blocks, secret-scans,
  shows, and pushes in one motion with the human present. The asymmetry is the
  privacy boundary, not an inconsistency: reading moves nothing off the machine,
  writing does.
- **A staging folder is needed exactly when a machine writes files a human has
  not read.** That rule is why `_drafts/` was cut, restored, and cut again. If
  the `SessionEnd` write hook ever returns, `_drafts/` returns with it — they
  are one decision, and a write hook without the folder would be auto-publish.
- **Auto-injection means load counts prove nothing.** H7 and H4′ are measured by
  `varve serve` opens and logs published per active day — voluntary human acts. Never cite
  brief injections as evidence anyone read anything.
- **Never auto-publish. Never upload transcripts.** Drafting is local.
- **Git stays the source of truth in every tier**, including hosted. Stop
  paying → lose convenience, lose nothing else.

## Agent-facing output contract (AXI)

The CLI follows https://axi.md/. Every command:

- TOON for lists — not JSON, not prose tables
- 3–4 fields by default; more only behind `--fields`
- truncate long content with a size hint and the flag to get the rest
- pre-computed aggregates inline, so no second round-trip
- explicit empty states — an agent cannot tell silent-empty from failure
- structured errors on **stdout**; exit 0 success / 1 error / 2 unknown flag
- never prompt interactively; every prompt has a flag equivalent
- `help[]` next-step lines, values parameterized
- bare command shows live state, not usage text

## Architecture rule

**No business logic in command handlers.** Commands parse arguments, call an
operation, render a result. Operations are explicit contracts that a CLI adapter
and a future hosted worker both call.

Not speculative structure — it is the one lesson taken from a competitor's own
published retrospective, where the CLI grew into the engine and the rewrite cost
them ~23.5k LOC.

---

## Settled — do not reopen

- **The name is `varve`.** Rationale and the rejection checklist are in the
  thesis, Appendix C.
- Nextra for the portal.
- **One `search()` operation, not two engines.** CLI calls it directly; `varve
  serve` calls the same one locally. A prebuilt FlexSearch index exists only for
  the hosted Publish target. **An index is a cache, never a source** — delete
  every index and lose time, nothing else. Thesis §6.2.2.
- **No auth, no database, no server.** *(revised 2026-08-04 — supersedes the
  Supabase decision.)* Every developer already clones the store, so `varve
  serve` renders it locally and the git host is the access-control list. A user
  table would only drift out of sync with the repo's collaborator list. Thesis
  §6.2.1.
- No architecture wiki, no gardening pass — that space is ceded deliberately.
- Local-first posture. Hosted is an add-on, never the default first-run story.
- Open-core rule: **the paid tier is never a smarter engine, only less work.**
  Any proposal to paywall a *capability* is rejected on sight. Capability moving
  *into* the free tier is the rule working, not erosion — do not read it as the
  paid tier thinning.
- **Free tier is developer-facing; the hosted portal is the paid tier.**
  *(2026-08-04.)* Free = CLI + `varve serve` against your own clone. Non-devs get
  the git host's web UI for free (inherent to markdown in git, nobody builds it)
  or the paid portal. **No self-host kit** — considered and cut; deferred until a
  real team asks *and* H7 has cleared.
- **Build auth only where no existing ACL already covers the readers**
  (§6.2.3). Local portal: git host is the ACL → no auth. Hosted portal: readers
  have no git account at all → real auth, ours to run. This is why GitHub OAuth
  is right for one and wrong for the other.
- Tenancy: multi-tenant with hard isolation by default; single-tenant/on-prem
  for enterprise; self-hosting the OSS core always available and stated openly.
  *(That is the store and the free developer tooling — it does not include a
  deployment kit for the hosted non-developer portal, which was cut above.)*

## Open questions — do not assume answers

1. **Does anyone besides the author care that the store is human-readable?**
   Load-bearing. If not, this should be abandoned rather than repositioned.
2. With writing human-invoked again (no write hook, no drafts), will a second
   person record at all? Measured as logs published per active day against the
   author's 79%/103-day baseline.
3. Is cross-repo memory worth paying for?
4. Extend `create-ai-memory`, or keep varve separate? *(The v1 PRD assumes
   separate while inheriting its zero-dependency discipline. Still open.)*

---

## Repository conventions

- **`docs/` is gitignored** — internal strategy, local only. User-facing
  documentation goes in a *separate* directory. Never un-ignore `docs/` to
  publish a guide.
- **No `_drafts/` in v1.** The privacy boundary is the gate inside `varve log`
  (strip → scan → show → push), not a folder. If a write hook is ever added,
  the gitignored drafts folder comes back with it.
- Do not commit or push unless asked.
- Conventional Commits; body required; 3–5 files per commit.
- Never add an agent as commit co-author.
- Documentation comments on every file created or touched — explain why it
  exists, not what the next line does.

## Working style

**Simplicity is part of correctness.** Prefer stdlib and native features over
dependencies, one line over fifty, deleting over adding. If a feature is not
demanded by a hard constraint above or by a real user complaint, it is probably
premature.

Mark deliberate shortcuts with a `ponytail:` comment naming the trigger that
should undo them.
