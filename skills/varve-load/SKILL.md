---
name: varve-load
description: >
  Read the company context store at session start so you begin warm: what the
  project decided against, its open risks, and its newest session logs. Use at
  the beginning of any session in a repo carrying a .varve.yml, and when the
  user says "varve load", "vrv load", "/varve-load", "load context", "what did
  the team decide", or asks what happened on this project before now.
---

# varve-load

Read the store. Report what the team already decided. **Zero LLM calls** — this
is file reads, not analysis.

## 1. Resolve scope

Walk up from the working directory for `.varve.yml`:

```yaml
project: atlas
memory: git@github.com:acme/acme-context.git
```

- `--project <name>` overrides.
- **No `.varve.yml` found → stop.** Say so, list the projects that exist in the
  store if one is already cloned, and do nothing else. Never guess a project,
  and never fall back to a default store: a wrong guess writes one company's
  context into another company's session.

The local path is derived from the memory repo's own name — `acme-context`
resolves to `~/acme-context` — so two companies never collide on one directory.
If it is not cloned yet, clone it from the `memory` line, **non-interactively**:

```bash
GIT_TERMINAL_PROMPT=0 git clone --depth 50 <memory-url> ~/acme-context
```

If that fails — no credentials, no network, wrong host — **say one line and
continue the session anyway.** A blocked session start is worse than a cold one.

## 2. Freshness

```bash
git -C <store> pull --ff-only
```

If the pull fails or the tree is dirty, do not force it. Report the checkout's
age instead. **A stale clone reads stale memory silently**, which is this
design's one quiet failure — say the age out loud rather than hiding it.

## 3. Read, in this order

Stop as soon as the budget is spent. The order is urgency of not knowing, not
recency:

1. `_company.md` and `_standards.md` — the only always-loaded files
2. every `## Decided against` block in the newest ~15 logs for this project
3. open risks and unresolved items
4. the newest few log summaries, any team, any person

Never read another project's tree. An agent working on `atlas` must not load
`beacon` — that is a relevance rule before it is a token one.

Skip any log whose `supersedes:` target you have already read, and prefer the
superseding one.

## 4. Report

**Hard ceiling: 2,000 tokens.** The same size whether the project has 47 logs or
4,700 — recency-weighted and truncated, never a full dump. Over the ceiling
means truncate and say how to get more, never exceed silently.

```text
project: atlas · repos[2]: atlas-web, atlas-api · logs: 47 · last: 2026-08-01 (alice)
memory: ~/acme-context · pulled 2m ago

active[2]{what,since}:
  rate-limit header rename — api shipped, web pending,2026-07-29
  cache eviction limit — declined, shared instance,2026-07-26

rejected[2]{what,why}:
  raise the cache eviction limit,breaks beacon on the same instance
  retry failed uploads client-side,retries a request the user watched fail

risks[1]{what,who}:
  old header still read in atlas-web,bob

next: remove the old header path in atlas-web before the next release
help[]: varve-publish · read {project}/{team}/{person}/<file> --full
```

**Explicit empty state.** A project with no logs yet gets a definite line and the
next step — never silent output, which cannot be told apart from failure:

```text
project: atlas · no logs yet
next: run varve-publish at the end of this session to write the first one
```

## Rules

- **Zero inference.** Do not summarise, rank by model judgement, or rewrite what
  the store says. Read and report.
- **Never company-wide.** Company-level facts reach the brief only by being
  referenced from `_company.md`, which is always loaded and deliberately short.
- **Fail open, always.** Store unreachable, mid-rebase, budget blown — report one
  line and let the session start.
- **Carry `Decided against` verbatim.** Never soften it, never mark it as
  historical, never strike it through. Those are live constraints, and they are
  the content class this store exists to preserve.
