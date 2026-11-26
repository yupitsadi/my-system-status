#!/usr/bin/env bash
# Install the "My System Status" Cinnamon desklet for the current user.
#
#   ./install.sh                      install / update and add it to the desktop
#   ./install.sh --claude-statusline  also set a Claude Code status line that feeds
#                                     Claude's usage limits to the desklet
set -euo pipefail

UUID="my-system-status@aditya"
SRC="$(cd "$(dirname "$0")" && pwd)/$UUID"
DEST="$HOME/.local/share/cinnamon/desklets/$UUID"
CLAUDE_STATUSLINE=0

for arg in "$@"; do
  case "$arg" in
    --claude-statusline) CLAUDE_STATUSLINE=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

if ! command -v cinnamon >/dev/null 2>&1; then
  echo "Warning: Cinnamon was not found. This desklet only runs on the Cinnamon desktop."
fi
command -v python3 >/dev/null || { echo "python3 is required."; exit 1; }

echo "Installing to $DEST"
mkdir -p "$DEST"
cp -r "$SRC"/. "$DEST"/
chmod +x "$DEST/hub.py" "$DEST/claude_statusline.py"

# Add to the desktop if it is not there yet (keeps your other desklets).
if command -v gsettings >/dev/null && gsettings list-schemas | grep -qx org.cinnamon; then
  current="$(gsettings get org.cinnamon enabled-desklets)"
  if [[ "$current" != *"$UUID"* ]]; then
    new="$(python3 - "$current" "$UUID" <<'EOF'
import ast, sys
cur = sys.argv[1].replace("@as ", "")
items = ast.literal_eval(cur) if cur.strip() not in ("", "[]") else []
ids = [int(x.split(":")[1]) for x in items if x.count(":") >= 3 and x.split(":")[1].isdigit()]
items.append(f"{sys.argv[2]}:{max(ids, default=-1) + 1}:60:60")
print(str(items))
EOF
)"
    gsettings set org.cinnamon enabled-desklets "$new"
    echo "Added to the desktop."
  else
    # already enabled: reload so the new code is used
    dbus-send --session --dest=org.Cinnamon --type=method_call /org/Cinnamon \
      org.Cinnamon.ReloadXlet string:"$UUID" string:'DESKLET' >/dev/null 2>&1 || true
    echo "Already on the desktop; reloaded."
  fi
fi

if [[ $CLAUDE_STATUSLINE == 1 ]]; then
  python3 - "$DEST/claude_statusline.py" <<'EOF'
import json, os, sys
p = os.path.expanduser("~/.claude/settings.json")
d = {}
if os.path.exists(p):
    with open(p) as f:
        d = json.load(f)
cmd = "python3 " + sys.argv[1]
existing = (d.get("statusLine") or {}).get("command")
if existing and existing != cmd:
    print("Claude Code already has a status line; left it unchanged:\n  " + existing)
    sys.exit(0)
if os.path.exists(p):
    with open(p + ".bak-my-system-status", "w") as f:
        json.dump(d, f, indent=2)
d["statusLine"] = {"type": "command", "command": cmd}
os.makedirs(os.path.dirname(p), exist_ok=True)
with open(p, "w") as f:
    json.dump(d, f, indent=2)
print("Claude Code status line set (backup: ~/.claude/settings.json.bak-my-system-status).")
EOF
fi

echo "Done. Right-click the desklet and choose Configure to change size, colors and refresh rate."
