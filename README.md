# varve

> **varve** *(n.)* /värv/ — an annual layer of sediment. One is laid down each
> year: coarse and light in summer, fine and dark in winter. Count them like
> tree rings and you can read a lake's history year by year, thousands of years
> back. Nothing rewrites an older layer. New ones settle on top.

**One layer per session. Nothing overwritten.**

---

## Status

**Planning. No implementation yet.**

The design lives in [`docs/founder-thesis.md`](docs/founder-thesis.md) — scope,
competitive analysis, the hypotheses that would falsify it, and what is
deliberately out of scope.

## The idea

Your agent remembers. Your team doesn't.

Every serious team using AI agents has the same hole: one developer spends six
hours with an agent discovering constraints, rejecting approaches, and shipping
a fix. The code lands. The reasoning dies with the session. The next developer
opens a new session cold and rediscovers it.

varve is one git-backed memory store for a whole company — every project, every
repository — with two doors onto the same files:

- **Agents** read plain markdown directly, plus a token-bounded CLI.
- **Humans** read an auth-gated portal generated from those same files.

Nothing is shared until a person publishes it.

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
| **Company-wide scope** | company → projects → repositories, not one wiki per repo |

## Shape

```
_ai_memory_company_context/        one private git repo per company
  _company.md                      cross-project facts, shared infrastructure
  _standards.md
  _projects/{name}.md              one per project, lists its repos
  _team/_{who}/
    _session_log/{project}-{date}.md
  _handoffs/{project}.md           rolling next-session brief
  _decisions/{project}/ADR-*.md
```

Each code repository carries a one-line `.context.yml` (`project: ims`) so the
tooling resolves with no flags from any checkout.

## Open questions

This is a thesis, not a product. The load-bearing questions are unanswered:

1. Does anyone besides the author care that the store is human-readable?
2. Once drafting is automatic, will people actually publish?
3. Is cross-repo memory worth paying for?

See the thesis §8 for how each would be falsified.

## License

TBD — intended open-source core with a hosted service. See thesis §12.
