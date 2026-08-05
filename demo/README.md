# Demo recordings

Every GIF here is a recording of the real product. `claude -p` drives real Claude
Code sessions, VHS drives a real shell, Playwright drives the real portal.
Nothing is mocked, restyled, or re-typed.

| file | what it shows |
|---|---|
| `demo-session.gif` | **the product.** A new session loads the team memory and stops a developer from re-opening a decision made four days earlier; then writes its own session log at the end. Two prompts, no varve commands. |
| `demo-cli.gif` | the plumbing underneath: resolve, report, search across projects, and every session as a git commit |
| `demo-portal.gif` | the human door: project page, in-place search, a session log, the ⌘K palette |

## The memory they read

Built under `/tmp/varve-demo` from the fictional `acme-context` — fictional
company, fictional projects — with **one commit per session**, so the history is
real rather than staged.

```sh
varve serve --port 4174     # against the demo memory, for the web capture
```

## Reproducing

```sh
V=../../vitrine

# the session loop — two takes, joined
vhs session-1-load.tape
vhs session-2-publish.tape
printf "file '$PWD/beat1.mp4'\nfile '$PWD/beat2.mp4'\n" > join.txt
ffmpeg -f concat -safe 0 -i join.txt -c copy joined.mp4
ffmpeg -i joined.mp4 -filter:v "setpts=PTS/5.5,crop=1240:560:0:0" -an fast.mp4
bash $V/scripts/optimize.sh fast.mp4 demo-session.gif 11 1100

# the plumbing
python3 $V/scripts/render_tape.py steps.cli.json > demo-cli.tape && vhs demo-cli.tape

# the portal
node $V/scripts/capture_web.mjs steps.web.json out
bash $V/scripts/optimize.sh out/raw.webm demo-portal.gif 10 1000
```

Recorded with [vitrine](https://github.com/rhyumiranda/vitrine).

## Four things that cost a take each

**Pipe the prompt into `claude`, never pass it positionally.** `--add-dir` is
variadic, so `--add-dir $STORE 'prompt'` swallows the prompt as a second
directory and claude errors with *"Input must be provided…"*. It reports that on
**stderr**, which `2>/dev/null` hides — so it reads as a slow call, not a failed
one, for as many takes as you have patience for.

**Wait on structure, not prose.** `Wait /starves/` waits on wording the model
invents fresh every run. `/rejected/` and `/atlas-2026/` come from the report
shapes the skills specify and survive re-recording.

**Never wait on text the demo already contains.** `Wait /alice/` matched instantly
because "alice" was in the comment line typed a moment earlier, so the take ended
before the call began.

**Capture at the size it will be read at.** The first portal recording was
2560x1440 squeezed into a 900px README image and every word was illegible. The
terminal GIF read fine only because its font was enormous relative to the frame,
which is exactly why the problem hid.

## Cost

The session recording makes two real API calls and takes about 150 seconds, most
of it a spinner — hence the 5.5x speed-up. Re-running produces a **different
log**, because the model writes it fresh each time.
