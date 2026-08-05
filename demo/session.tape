# The loop, with the session boundary visible:
#   session 1 — work, /varve-publish, exit
#   session 2 — /varve-load, carry on
# The exit is the point. Without it there is nothing to prove.
#
# Two deliberate choices about how sessions start:
#   - Session 1 opens with the recording already inside it. varve adds no flags
#     to how you launch Claude Code, so showing a launch line would imply it does.
#   - Session 2 starts visibly, with a bare `claude`, because the claim being
#     made is that the second session is genuinely new.
# Both need CLAUDE_CONFIG_DIR: an isolated config keeps the author's hooks,
# statusline, project list and account name out of a public README, and carries
# the permission settings that would otherwise have to be typed as flags.
#
# Read demo/README.md before touching any Sleep here.

Output "session.mp4"
Set Shell "bash"
Set FontSize 16
Set Width 1300
Set Height 760
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms
Set WindowBar Colorful
Set Padding 16

Hide
# Only set because this is recorded from inside a Claude Code session; it is an
# artifact of how the demo is made, not of anything varve needs.
Type "unset CLAUDE_CODE_CHILD_SESSION"
Enter
Type "export CLAUDE_CONFIG_DIR=/tmp/varve-demo/.claude-demo"
Enter
Type "cd /tmp/varve-demo/atlas-web"
Enter
Type "clear"
Enter
Sleep 1s
Type "claude"
Enter
Sleep 20s
Show

# ---------- session 1: working ----------
# Ordinary work. Nothing varve-specific about it.
Type "We hit the expiry bug again. Keep 419 rather than reverting to 401 — mobile already ships against it. atlas-api has to deploy before atlas-web."
Enter
Sleep 120s

# ---------- save the session ----------
Type "/varve-publish"
Enter
Sleep 215s

# The gate: the agent names a call it made, the developer corrects it.
Type "both repos, then push"
Enter
Sleep 60s

# ---------- and it is gone ----------
Type "/exit"
Enter
Sleep 6s
Type "clear"
Enter
Sleep 2s

# ---------- session 2: a different session entirely ----------
Type "claude"
Enter
Sleep 20s

Type "/varve-load"
Enter
Sleep 210s

Type "So what should I pick up?"
Enter
Sleep 100s
