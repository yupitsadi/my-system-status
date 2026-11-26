#!/usr/bin/env python3
"""Backend for the "My System Status" desklet.

  hub.py status       -> JSON with system, Phone Box and AI status
  hub.py connect      -> start the PhoneBox agent and wait for the phone to connect
  hub.py stop         -> stop the PhoneBox agent
  hub.py settings     -> open the PhoneBox settings page
"""
import glob
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

HOME = os.path.expanduser("~")
CACHE = os.path.join(HOME, ".cache", "my-system-status")
os.makedirs(CACHE, exist_ok=True)

AGENT = "http://127.0.0.1:8765"
SERVICE = "phonebox"


def run(cmd, timeout=5):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return 1, "", str(e)


def cached(name, ttl, fn):
    path = os.path.join(CACHE, name + ".json")
    try:
        if time.time() - os.path.getmtime(path) < ttl:
            with open(path) as f:
                return json.load(f)
    except (OSError, ValueError):
        pass
    val = fn()
    try:
        with open(path, "w") as f:
            json.dump(val, f)
    except OSError:
        pass
    return val


def agent_get(path, timeout=2):
    try:
        with urllib.request.urlopen(AGENT + path, timeout=timeout) as r:
            return json.loads(r.read() or b"null")
    except Exception:
        return None


def read(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


# ---------------------------------------------------------------- system

def cpu_percent():
    def snap():
        v = list(map(int, read("/proc/stat").splitlines()[0].split()[1:]))
        return v[3] + v[4], sum(v)
    i1, t1 = snap()
    time.sleep(0.25)
    i2, t2 = snap()
    return round(100 * (1 - (i2 - i1) / max(t2 - t1, 1)))


def mem():
    info = {}
    for line in read("/proc/meminfo").splitlines():
        k, v = line.split(":", 1)
        info[k] = int(v.split()[0]) * 1024
    return {"used": info["MemTotal"] - info["MemAvailable"], "total": info["MemTotal"],
            "swap_used": info.get("SwapTotal", 0) - info.get("SwapFree", 0),
            "swap_total": info.get("SwapTotal", 0)}


CPU_SENSORS = ("k10temp", "zenpower", "coretemp", "cpu_thermal", "acpitz")


def cpu_temp():
    """First CPU sensor found: AMD (k10temp/zenpower), Intel (coretemp), ARM, then ACPI."""
    found = {read(d + "/name"): d for d in glob.glob("/sys/class/hwmon/hwmon*")}
    for name in CPU_SENSORS:
        d = found.get(name)
        t = read(d + "/temp1_input") if d else ""
        if t:
            return round(int(t) / 1000)
    return None


def battery():
    bats = sorted(glob.glob("/sys/class/power_supply/BAT*"))
    if not bats:
        return None
    b = bats[0]
    return {"percent": int(read(b + "/capacity", "0")), "status": read(b + "/status", "Unknown")}


def wifi():
    rc, out, _ = run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi", "list", "--rescan", "no"], 3)
    for line in out.splitlines():
        if line.startswith("yes:"):
            parts = line.split(":")
            return {"ssid": ":".join(parts[1:-1]), "signal": int(parts[-1] or 0)}
    return None


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def gpu():
    rc, out, _ = run(["nvidia-smi", "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total",
                      "--format=csv,noheader,nounits"], 3)
    if rc != 0 or not out:
        return None
    n, u, t, mu, mt = [x.strip() for x in out.splitlines()[0].split(",")]
    return {"name": n.replace("NVIDIA GeForce ", ""), "util": int(u), "temp": int(t),
            "mem_used": int(mu), "mem_total": int(mt)}


def system_status():
    du = shutil.disk_usage("/")
    return {
        "host": socket.gethostname(),
        "cpu": cpu_percent(),
        "cpu_temp": cpu_temp(),
        "load": round(os.getloadavg()[0], 2),
        "mem": mem(),
        "disk": {"used": du.used, "total": du.total},
        "battery": battery(),
        "wifi": wifi(),
        "ip": local_ip(),
        "gpu": cached("gpu", 15, gpu),
        "uptime": int(float(read("/proc/uptime", "0").split()[0])),
    }


# ---------------------------------------------------------------- Phone Box (PhoneBox agent)

def service_state():
    rc, out, _ = run(["systemctl", "--user", "is-active", SERVICE], 3)
    return out or "unknown"


def phone_status():
    st = {"service": service_state(), "agent_up": False, "connected": False,
          "via": None, "phone": None, "last_seen": None, "wifi_port": None, "settings_url": AGENT + "/"}
    info = agent_get("/api/info")
    if not info:
        return st
    st.update(agent_up=True, connected=bool(info.get("connected")), via=info.get("via"),
              version=info.get("version"), problem=info.get("usbProblem") or info.get("webviewProblem"))
    phones = agent_get("/api/phones") or []
    if phones:
        p = max(phones, key=lambda x: x.get("lastSeen") or 0)
        st["phone"] = p.get("name") or p.get("model")
        st["last_seen"] = (p.get("lastSeen") or 0) / 1000 or None
        st["via"] = st["via"] or p.get("via")
    lan = agent_get("/api/lan") or {}
    if lan.get("active"):
        st["wifi_port"] = lan.get("port")
    return st


def connect():
    if service_state() != "active":
        print("Starting PhoneBox agent...", flush=True)
        rc, _, err = run(["systemctl", "--user", "start", SERVICE], 15)
        if rc != 0:
            print("Could not start PhoneBox: " + err)
            return 1
    for _ in range(30):
        info = agent_get("/api/info")
        if info and info.get("connected"):
            print("Phone Box connected via " + (info.get("via") or "?"))
            return 0
        time.sleep(1)
    if agent_get("/api/info"):
        print("Agent running, waiting for the phone. Open PhoneBox on the phone.")
        return 2
    print("PhoneBox agent did not respond on port 8765.")
    return 3


def stop():
    run(["systemctl", "--user", "stop", SERVICE], 15)
    print("PhoneBox agent stopped.")
    return 0


# ---------------------------------------------------------------- AI tools

def proc_count(pattern):
    rc, out, _ = run(["pgrep", "-fc", pattern], 2)
    try:
        return int(out)
    except ValueError:
        return 0


def quotas_from_agent():
    q = agent_get("/api/quotas", 3)
    if not q:
        return None
    out = []
    for p in q.get("providers", []):
        limits = [{"label": l.get("label"), "used": l.get("percent"),
                   "resets_at": (l.get("resetsAt") or 0) / 1000 or None,
                   "severity": l.get("severity")} for l in p.get("limits") or []]
        item = {"id": p.get("id"), "name": p.get("name"), "plan": p.get("plan"), "limits": limits,
                "note": p.get("error") or p.get("extra"), "updated": (p.get("updatedAt") or 0) / 1000 or None}
        cx = p.get("codex")
        if cx and cx.get("contextWindow"):
            item["context"] = {"used": round(100 * (cx.get("lastInput") or 0) / cx["contextWindow"]),
                               "model": cx.get("model")}
        out.append(item)
    return out


def claude_from_statusline():
    try:
        with open(os.path.join(CACHE, "claude.json")) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    rl = data.get("rate_limits") or {}
    now = time.time()
    limits = []
    for key, label in (("five_hour", "5-hour session"), ("seven_day", "Weekly")):
        w = rl.get(key)
        if w:
            used = w.get("used_percentage")
            if isinstance(w.get("resets_at"), (int, float)) and w["resets_at"] < now:
                used = 0
            limits.append({"label": label, "used": used, "resets_at": w.get("resets_at")})
    return {"id": "claude", "name": "Claude", "plan": None, "limits": limits,
            "updated": data.get("_saved_at"), "note": "from Claude Code status line"}


def local_tools():
    tools = []
    if shutil.which("cursor-agent"):
        def check():
            rc, out, err = run(["cursor-agent", "status"], 15)
            return "not logged in" not in (out + err).lower()
        tools.append({"name": "Cursor", "state": "Logged in" if cached("cursor", 600, check) else "Not logged in",
                      "ok": cached("cursor", 600, check)})
    if shutil.which("kimi"):
        ok = bool(glob.glob(os.path.join(HOME, ".kimi-code", "credentials", "*")))
        tools.append({"name": "Kimi Code", "state": "Logged in" if ok else "Not logged in", "ok": ok})
    if shutil.which("opencode"):
        def stats():
            rc, out, _ = run(["opencode", "stats"], 20)
            for line in out.splitlines():
                line = line.strip("│ ")
                if line.startswith("Total Cost"):
                    return line[len("Total Cost"):].strip()
            return "?"
        tools.append({"name": "OpenCode", "state": "Cost " + cached("opencode", 900, stats), "ok": True})
    if shutil.which("ollama"):
        try:
            with urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=1) as r:
                loaded = [m.get("name") for m in json.loads(r.read()).get("models", [])]
            tools.append({"name": "Ollama", "state": "Running" + (": " + ", ".join(loaded) if loaded else ""), "ok": True})
        except Exception:
            tools.append({"name": "Ollama", "state": "Stopped", "ok": False})
    return tools


def ai_status():
    providers = quotas_from_agent()
    source = "PhoneBox"
    if providers is None:
        source = "local"
        c = claude_from_statusline()
        providers = [c] if c else []
    sessions = {"claude": proc_count(r"(^|/)claude( |$)"), "codex": proc_count(r"(^|/)codex( |$)")}
    for p in providers:
        p["sessions"] = sessions.get(p.get("id"), 0)
    return {"source": source, "providers": providers, "tools": local_tools()}


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        print(json.dumps({"system": system_status(), "phone": phone_status(), "ai": ai_status(),
                          "time": int(time.time())}))
        return 0
    if cmd == "connect":
        return connect()
    if cmd == "stop":
        return stop()
    if cmd == "settings":
        subprocess.Popen(["xdg-open", AGENT + "/"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
