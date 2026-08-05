# Beat 1 of demo-session.gif — a new session that already knows.
# The prompt is piped via stdin: --add-dir is variadic and will otherwise eat a
# positional prompt, and claude reports that on stderr, which 2>/dev/null hides.
Output "beat1.mp4"
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
Type "# monday. new session. bob has never spoken to alice."
Enter
Sleep 1800ms
Type "echo 'About to raise the cache eviction limit in atlas-api. Use varve-load first. Answer in under 60 words.' | claude -p --add-dir $VARVE_STORE 2>/dev/null"
Enter
# Wait on the report SHAPE varve-load specifies, never on prose the model
# invents fresh each run.
Wait+Screen@420s /rejected/
Sleep 5s
