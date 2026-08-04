---
type: varve-standards
---

<!-- Always loaded, every brief, forever. Every line costs tokens in every session. -->
# Engineering Standards

Only rules you would otherwise repeat next week. Project-specific rules go in the project.

* **[Rule]:** [Non-negotiable, stated in one line]
* **[Rule]:** [Non-negotiable, stated in one line]

# Conventions

* **Commits:** [Format]
* **Branches:** [Naming, protection]
* **Production:** [Access posture, who may write]

# Not Here

Architecture, API docs, onboarding guides. varve is a log, not a wiki.

Anything true of one project only — a language version, a test runner, a deploy
gate for one service. That goes in `{project}/_standards.md`, so a project on a
different stack never loads it.
