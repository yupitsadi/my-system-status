# My System Status

A desktop widget (desklet) for the **Cinnamon** desktop (Linux Mint, or any distro running Cinnamon). It shows your system health, your AI coding tools' usage limits, and a one-click button to connect a [PhoneBox](https://github.com/ersinkoc/phonebox) desk-panel phone.

## Features

**🖥 System**
- CPU usage and temperature, memory, disk, NVIDIA GPU (usage, temperature, VRAM)
- Battery, Wi-Fi network and signal, IP address, swap, uptime
- Live clock and date in the header

**🤖 AI limits**
- **Claude:** 5-hour session and weekly limits, with countdowns to reset
- **Codex, Antigravity:** limits and context usage (through PhoneBox)
- **Other tools:** login or running status for Cursor Agent, Kimi Code, OpenCode and Ollama, shown when they're installed
- How many Claude and Codex sessions are running right now

**📱 Phone Box**
- A large **Connect Phone Box** button that starts the PhoneBox agent and waits for the phone
- Colors show the state: blue = stopped, amber = waiting for the phone, green = connected (tap to open the PhoneBox settings)
- Details tab: phone model, USB or Wi-Fi, last seen, Wi-Fi port, agent version, and Connect / Open settings / Stop agent buttons

**✨ Look and feel**
- Dark glass card with smooth animations: fade-in, tab transitions, bars that grow to their new values, hover effects, and a pulsing status dot while connecting
- **Right-click → Configure:** size (80–160%), accent color, background opacity, animations on/off, refresh interval, and the tab shown at start

## Requirements

| Needed | For |
|---|---|
| Cinnamon desktop (tested on 6.6) | the desklet itself |
| `python3` (3.8+) | the data collector (`hub.py`), standard library only |
| `nmcli` (NetworkManager) | Wi-Fi name and signal *(optional)* |
| `nvidia-smi` | GPU tile *(optional)* |
| [PhoneBox](https://github.com/ersinkoc/phonebox) agent as the systemd user service `phonebox` | Phone Box tab and the Claude, Codex and Antigravity limits *(optional)* |
| [Claude Code](https://claude.com/claude-code) | Claude limits when PhoneBox isn't running *(optional)* |

Anything that's missing is simply hidden.

## Install

```bash
git clone https://github.com/yupitsadi/my-system-status.git
cd my-system-status
./install.sh
```

The widget appears in the top-left corner of your desktop. To move it, drag it. Right-click it and choose **Configure** to change its size and colors.

### Optional: Claude limits without PhoneBox

```bash
./install.sh --claude-statusline
```

This sets a [Claude Code status line](https://docs.claude.com/en/docs/claude-code/statusline) that saves Claude's own `rate_limits` numbers for the widget. It also shows a short line such as `Opus · ctx 12% · 5h 34% · 7d 61%` in your terminal. If you already have a status line, it is left unchanged. The numbers refresh whenever Claude Code is in use.

### Update

```bash
git pull && ./install.sh
```

### Uninstall

```bash
./uninstall.sh
```

## How it works

```
desklet.js (Cinnamon / GJS UI)
   │  runs every N seconds
   ▼
hub.py status  ──►  /proc, /sys, nmcli, nvidia-smi        (system)
               ──►  http://127.0.0.1:8765/api/*            (PhoneBox agent: phone + AI quotas)
               ──►  ~/.cache/my-system-status/claude.json  (Claude Code status line, fallback)
               ──►  cursor-agent / kimi / opencode / ollama (other AI tools; slow checks cached)
```

`hub.py` also works on its own from a terminal:

```bash
python3 ~/.local/share/cinnamon/desklets/my-system-status@aditya/hub.py status     # JSON
python3 ~/.local/share/cinnamon/desklets/my-system-status@aditya/hub.py connect    # start PhoneBox and wait for the phone
python3 ~/.local/share/cinnamon/desklets/my-system-status@aditya/hub.py stop       # stop the PhoneBox agent
```

Nothing is sent anywhere. The widget reads only local files, local commands and the PhoneBox agent on `127.0.0.1`.

## Troubleshooting

- **The widget doesn't appear:** open *System Settings → Desklets*, find **My System Status** and click **+**.
- **It shows "Loading…" forever:** run `hub.py status` (above) and look for a Python error.
- **The Phone Box button stays blue:** check `systemctl --user status phonebox`. The PhoneBox agent must be installed as a systemd user service named `phonebox` (its `setup.sh` does this).
- **Errors from Cinnamon:** `grep -i my-system-status ~/.xsession-errors`
- **Reload after editing the code:**
  ```bash
  dbus-send --session --dest=org.Cinnamon --type=method_call /org/Cinnamon org.Cinnamon.ReloadXlet string:'my-system-status@aditya' string:'DESKLET'
  ```

## License

[MIT](LICENSE)
