# Demo recordings

Both GIFs are recordings of the real product — VHS drives a real shell for the
terminal, Playwright drives the real portal for the browser. Nothing is mocked or
restyled; the pixels are varve's own output.

## Reproducing

The memory they read is built from `acme-context` — fictional company, fictional
projects — under `/tmp/varve-demo`, with one commit per session so the git
history in the terminal recording is real rather than staged.

```sh
# terminal
python3 ../../vitrine/scripts/render_tape.py steps.cli.json > demo-cli.tape
vhs demo-cli.tape

# portal (needs `varve serve --port 4174` against the demo memory)
node ../../vitrine/scripts/capture_web.mjs steps.web.json out
bash ../../vitrine/scripts/optimize.sh out/raw.webm demo-portal.gif 10 900
```

Recorded with [vitrine](https://github.com/rhyumiranda/vitrine).

## Notes

The portal recording uses the raw full-frame capture rather than vitrine's
cinematic zoom layer: the zoom cropped the sidebar to a column of orphaned
numbers, and a navigation demo whose navigation is unreadable is not a demo.
