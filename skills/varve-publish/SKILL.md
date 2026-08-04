---
name: varve-publish
description: >
  Write this session's log into the shared company context store and publish it
  in one gated motion — compose, strip private blocks, scan for secrets, show
  the result, push. Use at the end of a working session, and when the user says
  "varve publish", "vrv publish", "/varve-publish", "log this", "publish the
  session", or asks to record what was decided for the rest of the team.
---

# varve-publish

One motion:

```
compose → strip private → secret scan → show → push
```

## 1. Resolve scope

Walk up from the working directory for `.varve.yml` (`project`, `memory`).
`--project` overrides. **No binding → stop and say so.** Never guess the project,
never fall back to a default store.

Resolve the store path as `varve-load` does. Pull before writing:

```bash
git -C <store> pull --ff-only
```

Conflict or dirty tree → **report and stop.** Never auto-resolve; never force.

## 2. Decide whether to write at all

**No-op is valid.** A session that opened a file and quit produces nothing. Say
so in one line and stop.

Write a log when the session produced any of: a decision, a rejected option, a
constraint discovered, something verified, something that broke, or a handoff
the next person needs. *"Files changed"* alone is not a reason — git already
records that.

## 3. Compose

**This is the single LLM call in the system.** It happens here, before the human
sees anything, and never on a read path. `--no-compose` writes a skeleton for the
user to fill in, with zero inference.

Path — **one file per session**, never per day:

```
{store}/{project}/{team}/{person}/{project}-{YYYY-MM-DD}_{HH-MM-SS}.md
```

Local date and time from this machine. A cross-timezone team needs no shared
clock, because no two people ever write the same file.

**`{person}` and the `who:` field are the same slug, and it is not a free
choice.** It is `git config user.name`, lowercased, with every run of
non-alphanumeric characters replaced by a hyphen — `Dana Reyes` → `dana-reyes`.
Run `varve` to see the one this machine will use.

Inventing a shorter one splits a person in two: their profile stays in
`_team/_dana-reyes/` while their logs file under `dana`, so their own page never
shows their profile and the roster disagrees with the record. Nothing errors —
it just quietly becomes two people.

```markdown
---
project: atlas
who: alice
started: 2026-08-04T16:22:07
repos: [atlas-api, atlas-web]
---

# Session Outcome

* **High-Level Summary:** Renamed the rate-limit headers in atlas-api and
  verified them in production.
* **Important Decisions:** Header rename ships in the API first; the web app
  follows in a separate deploy.
* **Decided Against:** Raising the shared cache eviction limit — same instance
  as beacon, and raising it starves their workers under load.
* **Constraints / Blockers:** atlas-web still reads the old header name.
* **Next Step:** Remove the old header path in atlas-web, with bob.
* **Notes for Future AI:** The deploy order is a contract, not a convention.

<!-- private -->
Took three days because of a workaround around another dev's refactor.
<!-- /private -->
```

This is the shape that has been running for over a hundred days, kept
deliberately rather than improved on. **Bullets, not headings** — one
`# Session Outcome` and a labelled line each — because that is what a person
actually fills in without it turning into an essay.

One label is added to it: **Decided Against**. The original leaves rejected
options to a guideline, and a guideline is the first thing dropped on a tired
Friday. It is the content class this store exists for, so it gets a line of its
own.

`## Heading` form is read too, so a log written either way parses.

### The auto block

Below the human's notes, append what git already knows. Same shape the source
vault has used for a hundred days — it is not an invention, and it is not worth
redesigning:

```markdown
## Auto Session Log
_Auto-generated 2026-08-04 22:36:21._

* **Repos:** atlas-api, atlas-web
* **Branch:** main
* **Commits this session:**
- b057180 feat(api): rename the rate-limit headers
- 9006bfe test(api): cover the old header path
* **Uncommitted at publish:**
- M src/limits.ts
```

Collect it with one call per touched repo:

```bash
git -C <repo> log --since="<session start>" --format="%h %s"
git -C <repo> status --short
```

**Three rules, and the third is the one that matters:**

1. **Short SHAs and subjects only.** The prose above already says what happened;
   these are pointers, not a second copy of it. Never paste a diff.
2. **Timeout it, and treat failure as empty.** A repo on a slow mount or with a
   pathological history must not stall a publish. No commits recorded is a
   missing line; a hung publish is a person who stops publishing.
3. **This block is machine output and stays below the human's notes.** It is
   never the summary, never a substitute for saying what was decided, and a
   session with commits but nothing worth writing is still a no-op.

Cost, measured: ~10–30 ms per repo, 68 ms for three, against a 200 ms write
budget. It is on the write path, once per session — no read gets slower, because
no read touches git.

**`repos:` is derived from the paths this session actually touched** — the git
roots of the files you read and edited, deduplicated. **Never from the working
directory.** A single `repo_root` scalar makes cross-repo sessions invisible in
frontmatter, and cross-repo sessions are the reason this product exists. If the
schema cannot express it, it will not be measured.

**Corrections are new files, never edits.** To correct an earlier log, write a
new one carrying `supersedes: atlas-2026-07-28_09-14-03`. Both remain. The record
of having been wrong is often the most useful content in the store, and editing
in place destroys it.

The `<!-- private -->` block matters more than it looks. Without somewhere to
write the unshareable part, people write nothing at all — the honest log and the
shareable log must be allowed to differ, or logging fails for reasons that look
like laziness but are actually discretion.

## 4. The gate — every time, in order

**1. Strip** every `<!-- private -->` … `<!-- /private -->` block. Report the count.

**2. Scan** for secrets. Prefer `gitleaks detect --no-git --source <file>` if it
is installed; the rules are a solved problem and a hand-rolled scanner will be
worse. Without it, fall back to obvious patterns — `AKIA`, `ghp_`, `sk-`,
`-----BEGIN`, `password=`, `Bearer ey`, long high-entropy strings, anything
shaped like a connection string — **and say plainly that the fallback is weaker
than gitleaks.**

**3. Show** the exact final content. Not a summary of it. The reviewed surface
must stay small enough that review is genuine rather than ceremonial; if a log is
too long to read, that is a bug in composing it, not a reason to wave it through.

**4. Push** only on explicit confirmation:

```bash
git -C <store> add <path> && git -C <store> commit -m "log(atlas): rate-limit headers verified in prod" && git -C <store> push
```

A scan finding blocks the push. Overriding is per-finding and explicit — never
"proceed anyway" for the whole file.

**There is no undo.** Once pushed, it is in history on every clone. If a secret
gets through, **rotate the secret** — do not rewrite history, because that needs
a force-push, which is the one operation that can silently drop other people's
commits.

## 5. Report

```text
ok: published · atlas/devs/alice/atlas-2026-08-04_16-22-07.md
private: 1 block stripped · scan: 0 findings (gitleaks) · repos[2]: atlas-api, atlas-web
help[]: varve-load (next session)
```

Never claim the log was published if the push failed.

## Memory quality

Inherited from the skill this one descends from, and load-bearing rather than
stylistic:

- Record **rejected options and why** when the tradeoff matters. This is the
  content class a gardened wiki destroys and the one nothing else preserves.
- Record explicit **decisions not to act.**
- State what was **not** verified.
- Correct earlier wrong notes — as a new layer, never by editing.
- Sort open items by urgency, not chronology.
