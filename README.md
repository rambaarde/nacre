# varve

> **varve** *(n.)* /värv/ — an annual layer of sediment. One is laid down each
> year: coarse and light in summer, fine and dark in winter. Count them like
> tree rings and you can read a lake's history year by year, thousands of years
> back. Nothing rewrites an older layer. New ones settle on top.

**One layer per session. Nothing overwritten.**

---

## Status

**Early. One thing built.** [`skills/`](skills/README.md) holds two skill files
and a store template — no CLI, no package, no portal.

That is deliberate. The unproven part of this idea is not capture, it is
**sharing**: whether a second person reads a shared store and ever publishes back
to it. Building a CLI and a portal before knowing that would be building on an
assumption. So the smallest possible version ships first, and the rest waits on
what it shows.

## The idea

Your agent remembers. Your team doesn't.

Every serious team using AI agents has the same hole: one developer spends six
hours with an agent discovering constraints, rejecting approaches, and shipping
a fix. The code lands. The reasoning dies with the session. The next developer
opens a new session cold and rediscovers it.

varve is one git-backed memory store for a whole company — every project, every
repository — with two doors onto the same files:

- **Agents** read plain markdown directly, plus a token-bounded CLI.
- **Humans** read a portal generated from those same files, served from their
  own clone — no login, no server, no database.

Nothing is shared until a person publishes it — writing and publishing are one
deliberate motion, with the private-block strip and secret scan inline.

## Why it is different

Every other tool in this space builds **agent memory** — a database the agent
queries. SQLite, vectors, a graph, an extraction pipeline. A human reads it, if
at all, through a debug viewer.

varve builds **team memory** — a document humans and agents share. Both read
the same bytes. Neither gets a privileged interface.

Concretely:

| | |
|---|---|
| **Plain markdown in git** | reviewable in a PR, greppable, diffable, portable. Not a database, not sync chunks |
| **Nothing captured silently** | a human publishes, or it stays local |
| **Zero inference on reads** | exactly one LLM call in the system, at session end, user-triggered |
| **Company-wide scope** | company → projects → teams → people, and projects → repositories. Not one wiki per repo |

## Shape

```
_ai_memory_company_context/       one private git repo per company
  _company.md                     cross-project facts, shared infrastructure
  _standards.md
  _team/_{who}/_profile.md        identity — spans projects
  {project}/
    _project.md                   roster: repos + teams
    _handoff.md                   rolling next-session brief
    _decisions/ADR-*.md
    {team}/{person}/{project}-{date}_{time}.md    one file per session
```

Each code repository carries a one-line `.varve.yml` (`project: atlas`) so the
tooling resolves with no flags from any checkout.

## Open questions

These are unanswered, and they decide whether this is worth building:

1. Does anyone besides the author care that the store is human-readable?
2. With writing human-invoked, will a second person record anything at all?
3. Is cross-repo memory worth paying for?

Each one has a test attached, and a result that would end the project.

## License

Open-source core, with a hosted service for the parts a team would rather not operate. The free tier is not a trial: the store is your git repo, and every read is local and permanent.
