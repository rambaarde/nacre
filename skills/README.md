# varve — skills

Two skills and a git repo. That is the whole thing right now.

| | |
|---|---|
| **`varve-load`** | at session start, read what the team decided so your agent begins warm |
| **`varve-publish`** | at session end, write one log — strip private blocks, scan for secrets, show it, push it |

No CLI, no package, no portal. Those come later, and only if this part earns
them: the open question is whether a second person actually reads a shared store
and ever publishes back to it. Nothing here assumes the answer is yes.

## Install

```bash
npx varve init --project atlas --store git@github.com:acme/company-context.git
```

That installs both skills, writes `.varve.yml` into the repo, and — with
`--create-store` — scaffolds a new store from the template. Add `--yes` to run
headless; every prompt has a flag, and it never blocks waiting for input.

`.varve.yml` is two lines and **committed, not gitignored**:

```yaml
project: atlas
store: git@github.com:acme/company-context.git
```

The `store` line is what lets a teammate clone the repo and start warm without
running `init` at all.

## The store

One private git repo for the whole company. Start from `store-template/`.

```
_company.md · _standards.md          the only always-loaded files. Keep short
_team/_{who}/_profile.md             identity — a person spans projects
{project}/_project.md                roster: repos + teams
{project}/_decisions/ADR-*.md        rare, human-authored, durable
{project}/{team}/{person}/{project}-{YYYY-MM-DD}_{HH-MM-SS}.md
```

**One file per session**, never per day. Three sessions in a day, or one person
on two machines, would collide — and repairing a collision means merge logic on
the write path. New file every time, nothing ever rewritten.

**Protect the default branch.** A force-push can drop other people's commits, and
absent memory is invisible: nobody notices a log that is missing, because it
looks exactly like one that was never written.

## Rules these skills enforce

- **Never auto-publish.** Nothing reaches the store without a human seeing it
  first.
- **Never guess scope.** No `.varve.yml`, no default store — stop and say so. A
  fallback default is the one way one company's notes could land in another
  company's store.
- **Corrections are new layers**, never edits. A log that corrects an earlier one
  carries `supersedes:`, and both files remain.
- **No-op is valid.** A session with nothing worth recording produces no log.

## Deliberately absent

**No rolling handoff file.** It would be the only file in the system that gets
overwritten, it needs an LLM call to produce, and it needs an invariant to stay
safe. At small team sizes the newest few logs already answer "where do things
stand", and `varve-load` assembles that at read time. Worth adding when reading
recent logs stops being enough — more people, or parallel work inside one
project.
