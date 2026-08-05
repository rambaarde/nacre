# Demo recordings

Every GIF here is a recording of the real product. VHS drives a real shell;
Playwright drives the real portal. Nothing is mocked, restyled, or re-typed.

| file | what it shows |
|---|---|
| `demo-agent.gif` | **a real Claude Code run** invoking `varve-publish` — it composes the log, writes it to the memory, and reports the gate steps it could not finish rather than claiming them |
| `demo-handoff.gif` | the value proposition — bob picks up alice's reasoning from a session that ended days ago, agent side and human side of the same memory |
| `demo-cli.gif` | the agent door: resolve, report, search across projects, and the git history underneath |
| `demo-portal.gif` | the human door: project page, in-place search, a session log, the ⌘K palette |

## The memory they read

Built under `/tmp/varve-demo` from the fictional `acme-context` — fictional
company, fictional projects — with **one commit per session**, so the history in
the terminal recording is real rather than staged.

```sh
varve serve --port 4174     # against the demo memory, for the web captures
```

## Reproducing

```sh
V=../../vitrine
python3 $V/scripts/render_tape.py steps.cli.json > demo-cli.tape && vhs demo-cli.tape
python3 $V/scripts/render_tape.py steps.handoff.json > handoff-cli.tape && vhs handoff-cli.tape
python3 $V/scripts/render_tape.py steps.agent.json    > agent.tape       && vhs agent.tape

node $V/scripts/capture_web.mjs steps.web.json out
bash $V/scripts/optimize.sh out/raw.webm demo-portal.gif 10 1000
```

The split screen is two recordings stacked, with the shorter one holding its last
frame so both panes end together:

```sh
ffmpeg -i out2/raw.webm -vf "tpad=stop_mode=clone:stop_duration=13,crop=1100:680:0:0" web.mp4
ffmpeg -i handoff-cli.mp4 -vf "crop=1100:680:0:0" cli.mp4
ffmpeg -i cli.mp4 -i web.mp4 -filter_complex "[0:v][1:v]hstack=inputs=2" handoff.mp4
```

Recorded with [vitrine](https://github.com/rhyumiranda/vitrine).

## Two things worth knowing before re-running

**The portal captures use vitrine's raw full-frame video, not its cinematic zoom
layer.** The zoom cropped the sidebar to a column of orphaned numbers, and a
navigation demo whose navigation is unreadable is not a demo.

**VHS's `Wait` stopped matching once the screen had scrolled**, so the `serve`
step waits on a fixed pause instead. The command was never at fault — a
screenshot of that exact frame shows it printing correctly.

**The agent recording is real and therefore slow.** `claude -p` takes over two
minutes, most of it a spinner, so the tape gives that step 150s and the result is
sped up 7x in post — the typing, the write and the proof stay legible, the
waiting does not. Re-running it costs a real API call and will produce a
different log, because the model writes it fresh.

**Capture at the size it will be read at.** The first portal recording was
2560x1440 squeezed into a 900px README image and the text was illegible. These
capture at 1100-1280 wide so the pixels survive the trip.
