# varve

> **varve** *(n.)* /värv/ — an annual layer of sediment. One is laid down each
> year: coarse and light in summer, fine and dark in winter. Count them like
> tree rings and you can read a lake's history year by year, thousands of years
> back. Nothing rewrites an older layer. New ones settle on top.
>
> **One layer per session. Nothing overwritten.**

One git-backed memory store for a whole company — every project, every
repository — with two doors onto the same files: agents read plain markdown,
humans read an auth-gated portal generated from it.

**Status: planning. No implementation code exists.** Anything resembling a build
is new work, not maintenance.

---

## Read first

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
  _projects/{name}.md              one per project, lists its repos
  _team/_{who}/
    _profile.md
    _session_log/{project}-{YYYY-MM-DD}.md
    _drafts/                       gitignored — never leaves the machine
  _handoffs/{project}.md           rolling, overwritten
  _decisions/{project}/ADR-*.md
```

Each code repo carries a one-line `.context.yml` (`project: ims`) so tooling
resolves with no flag from any checkout.

## The positioning

> Everyone else builds **agent memory** — a database the agent queries.
> varve builds **team memory** — a document humans and agents share.

Both read the same bytes. Neither gets a privileged interface. Concretely: plain
markdown in git (reviewable in a PR, greppable, portable), nothing captured
silently, and a human door that is a real portal rather than a debug viewer.

---

## Hard constraints

Design gates, not preferences. A change violating one is wrong even if it works.

- **Exactly ONE LLM call in the system** — drafting a session log at session end.
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
- **`brief` is always project-scoped**, never company-wide.
- **Capture is automatic; sharing is manual.** A `SessionEnd` hook drafts into
  the gitignored draft area. `publish` is the only path into shared memory, and
  it always runs the private-block strip and the secret scan first.
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
- Nextra + Supabase auth for the portal; build-time client-side search.
- No architecture wiki, no gardening pass — that space is ceded deliberately.
- Local-first posture. Hosted is an add-on, never the default first-run story.
- Open-core rule: **the paid tier is never a smarter engine, only less work.**
  Any proposal to paywall a *capability* is rejected on sight.
- Tenancy: multi-tenant with hard isolation by default; single-tenant/on-prem
  for enterprise; self-hosting always available and stated openly.

## Open questions — do not assume answers

1. **Does anyone besides the author care that the store is human-readable?**
   Load-bearing. If not, this should be abandoned rather than repositioned.
2. Once drafting is automatic, will people actually **publish**?
3. Is cross-repo memory worth paying for?
4. Extend `create-ai-memory`, or keep varve separate?

---

## Repository conventions

- **`docs/` is gitignored** — internal strategy, local only. User-facing
  documentation goes in a *separate* directory. Never un-ignore `docs/` to
  publish a guide.
- **`_drafts/` is gitignored at any depth** — this is the privacy boundary made
  structural, not procedural.
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
