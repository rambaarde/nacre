# Demo recordings

Both GIFs are the real product. `demo-session.gif` is an unedited Claude Code
session driven by VHS; `demo-portal.gif` is the real portal driven by Playwright.
Nothing is mocked, restyled, or re-typed.

| file | what it shows |
|---|---|
| `demo-session.gif` | a developer typing `/varve-load` and `/varve-publish` in Claude Code — the session reads the team memory, and writes itself down at the end |
| `demo-portal.gif` | the human door: project page, in-place search, a session log, the ⌘K palette |

## The memory they read

Built under `/tmp/varve-demo` from the fictional `acme-context` — fictional
company, fictional projects — with one commit per session, so the history is real
rather than staged. The store needs an upstream (`git branch -u origin/main`) or
the skill spends its output explaining a failed pull.

## Reproducing

```sh
vhs session.tape                                   # ~9 minutes, two API calls
ffmpeg -i session.mp4 -filter:v "setpts=PTS/13" -an fast.mp4
bash ../../vitrine/scripts/optimize.sh fast.mp4 demo-session.gif 9 900

varve serve --port 4174                            # in another shell
node ../../vitrine/scripts/capture_web.mjs steps.web.json out
bash ../../vitrine/scripts/optimize.sh out/raw.webm demo-portal.gif 10 1000
```

Recorded with [vitrine](https://github.com/rhyumiranda/vitrine).

## Five things that each cost a take

**Answer the publish gate.** `/varve-publish` composes the log and then *stops*,
asking whether to push. That is the skill working — nothing reaches a shared repo
without a person saying so — but a tape that never presses Enter records a
session that wrote nothing. The tape sends `Enter` after the compose.

**`bypassPermissions`, not `acceptEdits`.** The latter only auto-approves edits,
so the skill's `git pull` stalls on an approval prompt the tape cannot answer.

**Give each step far more time than feels necessary.** `/varve-load` took ~140s.
A keystroke that lands while the model is still working goes into a busy input
and corrupts the rest of the run.

**Wait on structure, never on prose.** For non-TUI takes: the report shapes the
skills specify (`rejected[`, a log filename) survive re-recording. Wording the
model invents does not. And never wait on text the demo has already typed on
screen — `/alice/` matched the comment line and ended the take before the call
began.

**Capture at the size it will be read at.** The first portal recording was
2560x1440 squeezed into a 900px README image and every word was illegible.

## Cost

The session recording is a real ~9-minute Claude Code session. Re-running it
produces a **different log**, because the model writes it fresh.
