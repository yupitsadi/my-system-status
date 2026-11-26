#!/usr/bin/env python3
"""Claude Code status line: saves the status JSON (rate limits, context) for the
My System Status desklet, then prints a short status line."""
import json
import os
import sys
import time

data = json.load(sys.stdin)
cache = os.path.expanduser("~/.cache/my-system-status")
os.makedirs(cache, exist_ok=True)
keep = {k: data.get(k) for k in ("rate_limits", "model", "context_window")}
keep["_saved_at"] = int(time.time())
tmp = os.path.join(cache, "claude.json.tmp")
with open(tmp, "w") as f:
    json.dump(keep, f)
os.replace(tmp, os.path.join(cache, "claude.json"))

parts = [(data.get("model") or {}).get("display_name") or "Claude"]
ctx = (data.get("context_window") or {}).get("used_percentage")
if ctx is not None:
    parts.append(f"ctx {ctx:.0f}%")
rl = data.get("rate_limits") or {}
for key, label in (("five_hour", "5h"), ("seven_day", "7d")):
    w = rl.get(key) or {}
    if w.get("used_percentage") is not None:
        parts.append(f"{label} {w['used_percentage']:.0f}%")
print(" · ".join(parts))
