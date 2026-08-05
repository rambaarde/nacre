# The loop, with the session boundary visible:
#   session 1 — work, /varve-publish, exit
#   session 2 — /varve-load, carry on
# The exit is the point. Without it there is nothing to prove.
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
Type "export VARVE_STORE=/tmp/varve-demo/acme-context"
Enter
Type "cd /tmp/varve-demo/atlas-web"
Enter
Type "clear"
Enter
Show

# ---------- session 1: working ----------
Sleep 700ms
Type "claude --add-dir $VARVE_STORE --permission-mode bypassPermissions"
Enter
Sleep 14s

Type "We hit the expiry bug again. Keep 419 rather than reverting to 401 — mobile already ships against it. atlas-api has to deploy before atlas-web."
Enter
Sleep 120s

# ---------- save the session ----------
Type "/varve-publish"
Enter
Sleep 215s
Enter
Sleep 50s

# ---------- and it is gone ----------
Type "/exit"
Enter
Sleep 6s
Type "clear"
Enter
Sleep 2s

# ---------- session 2: a different session entirely ----------
Type "claude --add-dir $VARVE_STORE --permission-mode bypassPermissions"
Enter
Sleep 14s

Type "/varve-load"
Enter
Sleep 210s

Type "So what should I pick up?"
Enter
Sleep 100s
