# nacre — skills

Two skills and a git repo. Everything else is convenience around them.

| | |
|---|---|
| **`nacre-load`** | at session start, read what the team decided so your agent begins warm |
| **`nacre-publish`** | at session end, write one log — strip private blocks, scan for secrets, show it, push it |

The CLI and portal now exist, but they only wire up and display what these two
skills write — delete them and the memory is still readable Markdown in git.

The open question they were waiting on is still open: whether a second person
actually reads a shared memory and ever publishes back to it. Shipping a package
did not answer that, and nothing here assumes the answer is yes.

## Install

```bash
npm i -g nacre-cli                              # the package; the commands are nacre and nac

nacre init git@github.com:acme/acme-context.git  # once, per company
nacre add atlas ../atlas-web ../atlas-api        # once, per project
```

`add` installs both skills, writes `.nacre.yml` into each repo, and records the
repos in the project roster. Adding a repo later is the same command again. Run
`nacre` with no arguments at any point to see where you are and what applies
next.

To read the memory as a person rather than through an agent:

```bash
nacre serve          # a portal over your own clone. No login, loopback only
nacre search <term>  # the same search, same ranking
```

Every command also works as **`nac`**. Inside a session, the skills answer to
`nac load` and `nac publish` as well as their full names.

`.nacre.yml` is two lines and **committed, not gitignored**:

```yaml
project: atlas
memory: git@github.com:acme/acme-context.git
```

The `memory` line is what lets a teammate clone the repo and start warm
without running anything at all.

## The store

One private git repo for the whole company — each names it their own way
(`acme-context`, `atlas-memory`). Start from `store-template/`.

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
- **Never guess scope.** No `.nacre.yml`, no default store — stop and say so. A
  fallback default is the one way one company's notes could land in another
  company's store.
- **Corrections are new layers**, never edits. A log that corrects an earlier one
  carries `supersedes:`, and both files remain.
- **No-op is valid.** A session with nothing worth recording produces no log.

## Deliberately absent

**No rolling handoff file.** It would be the only file in the system that gets
overwritten, it needs an LLM call to produce, and it needs an invariant to stay
safe. At small team sizes the newest few logs already answer "where do things
stand", and `nacre-load` assembles that at read time. Worth adding when reading
recent logs stops being enough — more people, or parallel work inside one
project.
