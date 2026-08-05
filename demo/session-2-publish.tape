# Beat 2 of demo-session.gif — the same session writing itself down.
# The prompt is piped via stdin: --add-dir is variadic and will otherwise eat a
# positional prompt, and claude reports that on stderr, which 2>/dev/null hides.
Output "beat2.mp4"
Set Shell "bash"
Set FontSize 18
Set Width 1240
Set Height 620
Set Theme "rose-pine-dawn"
Set TypingSpeed 42ms
Set WindowBar Colorful
Hide
Type "export VARVE_STORE=/tmp/varve-demo/acme-context"
Enter
Type "cd /tmp/varve-demo/atlas-web"
Enter
Type "clear"
Enter
Show
Sleep 600ms
Type "# decision made. now just close the laptop."
Enter
Sleep 1800ms
Type "echo 'We are leaving the eviction limit alone because beacon shares the instance. Write the session log with varve-publish, do not push, then reply in one short line.' | claude -p --add-dir $VARVE_STORE --permission-mode acceptEdits 2>/dev/null"
Enter
# Wait on the report SHAPE varve-load specifies, never on prose the model
# invents fresh each run.
Wait+Screen@420s /atlas-2026/
Sleep 5s
