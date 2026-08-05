<div align="center">

# varve

**One context memory for your whole company — every project, every repo, every
person. Agents and people read the same files.**

Your agent remembers a session. Your team remembers nothing. varve gives a
company one shared memory: plain Markdown in a private git repo that an agent
loads at session start and a person browses in a portal, with no database in
between.

Most tools scope memory to a repository. A product is rarely one repository, and
the knowledge that matters most lives in the seam between them. varve's unit is
the **product**, and above it the **company**.

No vectors. No API key. No service to run. Markdown you can read in a pull request.

</div>

<!-- Outside the centred block on purpose: align="center" centres every LINE of
     a code fence, so a short first line sits indented and the block reads as
     mis-typed code rather than as something to paste. -->

```sh
npm i -g varve-cli
varve init git@github.com:acme/acme-context.git
```

<div align="center">

**Working alone?** You want
[create-ai-memory](https://github.com/rambaarde/create-ai-memory) instead —
same idea, one person, no shared repo to set up.

[![npm](https://img.shields.io/npm/v/varve-cli)](https://www.npmjs.com/package/varve-cli)
![tests](https://img.shields.io/badge/tests-58%20passing-brightgreen)
![runtime deps](https://img.shields.io/badge/runtime%20deps-0-blue)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933)
![license](https://img.shields.io/badge/license-Apache--2.0-blue)

</div>

---

## The problem

The code lands. The reasoning dies with the session.

One developer spends six hours with an agent discovering a constraint, rejecting
three approaches, and shipping a fix. The diff records what changed. Nothing
records *why*, or what was tried and abandoned. Next week someone else — or the
same person with a fresh agent — starts blind and rediscovers it.

You pay the same tax every time:

- **Decisions evaporate.** Why a choice was made lives in a closed chat thread.
- **Rejections are invisible.** Nothing records what was tried and deliberately
  not done, so it gets re-litigated — or re-shipped, and re-broken.
- **Onboarding is oral.** A new teammate's context is whatever someone remembers
  to tell them.
- **Agents restart cold.** Every session re-derives what the team already knows.

**And the knowledge that actually breaks production belongs to no single repo.**
*"The API changed its expiry response; the web app must deploy after it."* That
fact is owned by two repositories and lives in neither — so a per-repo wiki has
nowhere to put it, and it ends up in someone's head or a Slack thread that
scrolls away.

## The promise

When any developer or agent joins a project session, they should understand the
current state, known risks, active decisions, and the next move — within minutes.

> **No teammate starts from zero.**
>
> **No rejected idea gets rediscovered as if new.**
>
> **No production lesson disappears inside a dead transcript.**

One memory per company. Every project inside it, every repo inside those, every
person who works on them — including the ones who joined last week and the ones
who were on leave. Nobody left reconstructing what the team already knew.

## How it works

One private git repo holds the memory for the whole company. Your code repos
carry a two-line signpost pointing at it — no memory lives in them, only the
address.

```
acme-context/          ← all memory. One repo. Separate from your code.
  _company.md              facts owned by more than one project
  atlas/                   a project
    _project.md              which repos and teams make it up
    devs/dana/               one file per session, never overwritten
  billing/                 another one

atlas-web/.varve.yml      ← project: atlas · memory: git@…/acme-context.git
atlas-api/.varve.yml      ← the same two lines
```

**Agents** read it through two skills — one loads what the team decided at
session start, one writes the session's log at the end. **People** read the same
bytes in a local portal.

Both doors, one store. Neither gets a privileged interface.

## Setup

Install once, then two commands, run by whoever sets things up.

```sh
npm i -g varve-cli                              # the package; the commands are varve and vrv

varve init git@github.com:acme/acme-context.git  # once, per company
varve add atlas ../atlas-web ../atlas-api        # once, per project
```

Trying it without installing works too — `npx varve-cli init <git-url>`.

Adding a repo later is the same command again:

```sh
varve add atlas ../atlas-worker
```

**Everyone after that runs nothing.** They clone a repo that already carries
`.varve.yml`, and their next session starts warm.

Unsure where you are? Run `varve` with no arguments — it reports live state and
names the one command that applies next.

```
$ varve
project: atlas · repos[3]: atlas-api, atlas-web, atlas-worker · logs: 47
memory: ~/acme-context · you are in: atlas-web
next: varve-load at session start · varve-publish at the end
```

Every command also works as **`vrv`**.

## Read it

```sh
varve serve            # the portal, from your own clone. No login.
varve search 419       # the same search the portal uses, same ranking
```

Three ways in — **project · person · time** — over one store. The project page
leads with the **handoff**: the next step from the most recent session that named
one. A reader who stops there already knows where the team left off.

Under it sits the curated project note, then every session in order. Decisions,
risks and what was **decided against** stay inside the logs they were made in,
dated and attributed. They are deliberately not collected onto the project page:
after a hundred sessions such a list is neither current nor historical, and
capping it silently drops the entry that mattered. An index is a cache, never a
source.

Decided-against entries are never struck through. Strikethrough reads as
*deleted*; these are live constraints, and they are the class of knowledge
nothing else keeps.

## Write it

Capture is one motion, and a person is present for all of it:

```
compose → strip <!-- private --> → secret scan → show → push
```

No draft folder, no second command. The private block matters more than it looks:
without somewhere to put the unshareable half, people write nothing at all.

**Nothing is shared by omission**, and nothing reaches the store without someone
seeing it first.

## Why plain files

> **varve** *(n.)* /värv/ — an annual layer of sediment. One is laid down each
> year: coarse and light in summer, fine and dark in winter. Count them like tree
> rings and you can read a lake's history year by year, thousands of years back.
> Nothing rewrites an older layer. New ones settle on top.

**One layer per session. Nothing overwritten.**

Everything else in this space builds **agent memory** — a database the agent
queries. SQLite, vectors, a graph, an extraction pipeline. A human reads it, if
at all, through a debug viewer.

varve builds **team memory** — a document humans and agents share.

The distinction underneath: **the reasoning trail is episodic, not
encyclopedic.** What a system *is* can be documented and kept current. What
happened, what was tried, what was ruled out and why — that is a sequence of
dated, attributed entries, and it is not an encyclopedia. Plenty of tools are
building the encyclopedia. The trail is the part nobody keeps, and it is the part
that stops a decision being made twice.

It is also why varve composes rather than competes: if you keep a per-repo
architecture wiki, keep it. This is the layer above it.

| | |
|---|---|
| **Markdown in git** | reviewable in a pull request, greppable, diffable, portable |
| **Nothing captured silently** | a person publishes, or it stays local |
| **Zero inference on reads** | reading is file reads; one model call, and only when you write |
| **Company-wide scope** | company → projects → teams → people, and projects → repos |
| **Append, never reconcile** | new files only; a correction is a new layer, not an edit |

Uninstall varve and you are left with a git repo of readable Markdown and its
full history. That is the test this design has to keep passing.

## If you are working alone

Use **[create-ai-memory](https://github.com/rambaarde/create-ai-memory)**
(`npm create ai-memory@latest`). Same conviction — plain Markdown you own, no
database, memory that outlives the chat thread — scoped to one person and one
machine.

varve exists for the part that only shows up with other people: a memory a
teammate reads, a decision that has to survive the person who made it, and a
fact that belongs to two repositories and neither. If nobody else is going to
read it, everything varve adds is cost — a shared repo to create, a publish step
to remember, a portal nobody opens.

|  | create-ai-memory | varve |
|---|---|---|
| scope | you | your company |
| memory lives | a vault on your machine | a private git repo the team clones |
| sharing | not the point | the whole point |
| setup | one command | a repo, then one command per project |

They are the same idea at two sizes. Start with the smaller one — it is a real
tool, not a demo, and moving up later is copying Markdown into a different
folder.

## Status

**Early, and honest about it.** The CLI, both skills, and the portal work and are
tested. What has *not* happened is the part that matters: nobody outside the
author has used this with a teammate for two weeks.

That experiment is the point. The unproven half of this idea is not capture, it
is **sharing** — whether a second person reads a shared memory and ever publishes
back to it. If the answer turns out to be no, this should be abandoned rather
than repositioned.

## Open questions

1. Does anyone besides the author care that the memory is human-readable?
2. With writing human-invoked, will a second person record anything at all?
3. Is cross-repo memory worth paying for, or merely nice to have?

## License

Apache-2.0.
