# The real Claude Code TUI. A developer runs the two skills — nothing else.
# Timings are generous on purpose: /varve-load took ~140s in the first take and
# the next keystroke landed while it was still working, which corrupts the run.
# bypassPermissions, not acceptEdits: the latter only auto-approves edits, so the
# skill's `git pull` stopped on an approval prompt the tape could not answer.
Output "session.mp4"
Set Shell "bash"
Set FontSize 16
Set Width 1300
Set Height 780
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms
Set WindowBar Colorful
Set Padding 16

Hide
Type "export VARVE_STORE=/tmp/varve-demo/acme-context"
Enter
Type "cd /tmp/varve-demo/atlas-web"
Enter
Type "clear"
Enter
Show

Sleep 800ms
Type "claude --add-dir $VARVE_STORE --permission-mode bypassPermissions"
Enter
Sleep 14s

Type "/varve-load"
Enter
Sleep 200s

Type "We are leaving the eviction limit alone — beacon shares the instance."
Enter
Sleep 100s

Type "/varve-publish"
Enter
# The skill composes the log and then STOPS at a confirmation gate — nothing
# leaves the machine unless a person says so. Take 3 ended sitting on that
# prompt, which is the skill behaving correctly, not a failure.
Sleep 210s
Enter
Sleep 45s
