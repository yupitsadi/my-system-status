#!/usr/bin/env bash
# Remove the "My System Status" desklet, its cache and (if we set it) the Claude Code status line.
set -euo pipefail
UUID="my-system-status@aditya"
DEST="$HOME/.local/share/cinnamon/desklets/$UUID"

if command -v gsettings >/dev/null && gsettings list-schemas | grep -qx org.cinnamon; then
  current="$(gsettings get org.cinnamon enabled-desklets)"
  new="$(python3 - "$current" "$UUID" <<'EOF'
import ast, sys
cur = sys.argv[1].replace("@as ", "")
items = ast.literal_eval(cur) if cur.strip() not in ("", "[]") else []
print(str([x for x in items if not x.startswith(sys.argv[2] + ":")]))
EOF
)"
  gsettings set org.cinnamon enabled-desklets "$new"
fi

python3 - "$DEST/claude_statusline.py" <<'EOF'
import json, os, sys
p = os.path.expanduser("~/.claude/settings.json")
if os.path.exists(p):
    with open(p) as f:
        d = json.load(f)
    if (d.get("statusLine") or {}).get("command") == "python3 " + sys.argv[1]:
        del d["statusLine"]
        with open(p, "w") as f:
            json.dump(d, f, indent=2)
        print("Removed the Claude Code status line.")
EOF

rm -rf "$DEST" "$HOME/.cache/my-system-status" "$HOME/.config/cinnamon/spices/$UUID"
echo "Uninstalled."
