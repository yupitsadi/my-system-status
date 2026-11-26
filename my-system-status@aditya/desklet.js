const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const Util = imports.misc.util;

const UUID = "my-system-status@aditya";
const BASE_WIDTH = 480;

const C = {
    text: "#eef1f7", dim: "#8f98a8", faint: "#5d6575",
    card: "rgba(255,255,255,0.06)", track: "rgba(255,255,255,0.10)",
    good: "#34d399", warn: "#fbbf24", bad: "#f87171"
};

function gb(b) { return (b / 1073741824).toFixed(1); }
function clamp(p) { return Math.max(0, Math.min(100, p || 0)); }
function levelColor(p) { return p >= 85 ? C.bad : p >= 60 ? C.warn : C.good; }

function untilText(ts) {
    if (!ts) return "";
    let s = Math.round(ts - Date.now() / 1000);
    if (s <= 0) return "reset";
    let d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d > 0) return "resets in " + d + "d " + h + "h";
    if (h > 0) return "resets in " + h + "h " + m + "m";
    return "resets in " + m + "m";
}

function agoText(ts) {
    if (!ts) return "never";
    let s = Math.round(Date.now() / 1000 - ts);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 172800) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " days ago";
}

function uptimeText(s) {
    let d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h " + m + "m" : m + "m";
}

function rgbaWith(color, alpha) {
    let m = String(color).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? "rgba(" + m[1] + "," + m[2] + "," + m[3] + "," + alpha + ")" : color;
}

function MySystemStatus(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MySystemStatus.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.hub = GLib.build_filenamev([metadata.path, "hub.py"]);
        this.data = null;
        this.message = "";
        this.busy = false;
        this.barValues = {};      // last value per bar, so bars ease from old to new

        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        for (let [key, prop] of [["scale", "scale"], ["accent", "accent"], ["bg-opacity", "bgOpacity"],
                                 ["animations", "animations"], ["refresh", "refresh"], ["start-tab", "startTab"]])
            this.settings.bindProperty(Settings.BindingDirection.IN, key, prop, () => this._build());
        this.tab = this.startTab || "system";

        this._build();
        this._refresh();
        this._tick();
    },

    px: function (n) { return Math.round(n * (this.scale || 1)) + "px"; },
    pxn: function (n) { return Math.round(n * (this.scale || 1)); },

    // ---------------------------------------------------------- layout

    _build: function () {
        let W = this.pxn(BASE_WIDTH);
        this.innerW = W - this.pxn(44);
        this.root = new St.BoxLayout({ vertical: true });
        this.root.set_style(
            "width: " + W + "px; padding: " + this.px(20) + " " + this.px(22) + "; border-radius: " + this.px(22) + ";" +
            "color: " + C.text + "; spacing: " + this.px(14) + ";" +
            "background-gradient-direction: vertical;" +
            "background-gradient-start: rgba(26,31,46," + this.bgOpacity + ");" +
            "background-gradient-end: rgba(12,14,22," + this.bgOpacity + ");" +
            "border: 1px solid rgba(255,255,255,0.09);");

        // header
        let header = new St.BoxLayout({ vertical: false });
        let titles = new St.BoxLayout({ vertical: true });
        titles.add_actor(this._label("My System Status", 21, C.text, true));
        this.subtitle = this._label("", 11, C.dim);
        titles.add_actor(this.subtitle);
        header.add(titles, { expand: true });
        let clockBox = new St.BoxLayout({ vertical: true });
        this.clock = this._label("", 22, C.text, true);
        this.date = this._label("", 10, C.dim);
        clockBox.add(this.clock, { x_align: St.Align.END, x_fill: false });
        clockBox.add(this.date, { x_align: St.Align.END, x_fill: false });
        header.add(clockBox, { y_align: St.Align.MIDDLE, y_fill: false });
        this.root.add_actor(header);

        // Phone Box button
        this.phoneBtn = new St.Button({ reactive: true, track_hover: true, x_expand: true });
        let pb = new St.BoxLayout({ vertical: false });
        pb.set_style("spacing: " + this.px(12) + ";");
        pb.add(this._label("📱", 24), { y_align: St.Align.MIDDLE, y_fill: false });
        let pbText = new St.BoxLayout({ vertical: true });
        this.phoneTitle = this._label("Connect Phone Box", 15, "#ffffff", true);
        this.phoneSub = this._label("", 11, "rgba(255,255,255,0.85)");
        pbText.add_actor(this.phoneTitle);
        pbText.add_actor(this.phoneSub);
        pb.add(pbText, { expand: true, y_align: St.Align.MIDDLE, y_fill: false });
        this.phoneDot = this._label("●", 18);
        pb.add(this.phoneDot, { y_align: St.Align.MIDDLE, y_fill: false });
        this.phoneBtn.set_child(pb);
        this.phoneBtn.connect("clicked", () => this._phoneClicked());
        this._hoverGrow(this.phoneBtn);
        this.root.add_actor(this.phoneBtn);

        // tabs
        let tabs = new St.BoxLayout({ vertical: false });
        tabs.set_style("spacing: " + this.px(4) + "; padding: " + this.px(4) + "; border-radius: " + this.px(13) + "; background-color: " + C.card + ";");
        this.tabButtons = {};
        for (let [id, text] of [["system", "🖥  System"], ["ai", "🤖  AI Limits"], ["phone", "📱  Phone Box"]]) {
            let b = new St.Button({ label: text, reactive: true, track_hover: true, x_expand: true, style_class: "mss-tab" });
            b.connect("clicked", () => this._switchTab(id));
            this.tabButtons[id] = b;
            tabs.add(b, { expand: true });
        }
        this.root.add_actor(tabs);

        this.body = new St.BoxLayout({ vertical: true });
        this.body.set_style("spacing: " + this.px(10) + ";");
        this.root.add_actor(this.body);

        this.footer = this._label("", 10, C.faint);
        this.root.add_actor(this.footer);

        this.setContent(this.root);
        this._render(false);
        if (this.animations) {
            this.root.opacity = 0;
            this.root.ease({ opacity: 255, duration: 400, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }
        if (this.data) this._restartTimer();
    },

    // ---------------------------------------------------------- widgets

    _label: function (text, size, color, bold, extra) {
        let l = new St.Label({ text: String(text) });
        l.set_style("font-size: " + this.px(size || 12) + "; color: " + (color || C.text) + ";" +
            (bold ? "font-weight: bold;" : "") + (extra || ""));
        l.clutter_text.ellipsize = 3;
        return l;
    },

    _hoverGrow: function (actor) {
        actor.set_pivot_point(0.5, 0.5);
        actor.connect("notify::hover", () => {
            if (!this.animations) return;
            let s = actor.hover ? 1.025 : 1.0;
            actor.ease({ scale_x: s, scale_y: s, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        });
    },

    _bar: function (key, p, width, color) {
        let h = this.pxn(8);
        let track = new St.Widget({ width: width, height: h });
        track.set_style("border-radius: " + (h / 2) + "px; background-color: " + C.track + ";");
        let fill = new St.Widget({ height: h });
        fill.set_style("border-radius: " + (h / 2) + "px; background-color: " + (color || levelColor(p)) + ";");
        let target = Math.round(width * clamp(p) / 100);
        if (p > 0) target = Math.max(target, h);
        let prev = this.barValues[key];
        if (this.animations && prev !== target) {
            fill.width = prev === undefined ? 0 : prev;
            fill.ease({ width: target, duration: 700, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        } else {
            fill.width = target;
        }
        this.barValues[key] = target;
        track.add_child(fill);
        return track;
    },

    _card: function (extra) {
        let c = new St.BoxLayout({ vertical: true });
        c.set_style("padding: " + this.px(12) + " " + this.px(14) + "; border-radius: " + this.px(15) + ";" +
            "spacing: " + this.px(8) + "; background-color: " + C.card + ";" + (extra || ""));
        return c;
    },

    _meterRow: function (parent, key, name, p, sub) {
        let row = new St.BoxLayout({ vertical: true });
        row.set_style("spacing: " + this.px(5) + ";");
        let top = new St.BoxLayout({ vertical: false });
        top.add(this._label(name, 12, C.dim), { expand: true });
        top.add_actor(this._label(p === null || p === undefined ? "--" : Math.round(p) + "%", 13, levelColor(p), true));
        row.add_actor(top);
        row.add_actor(this._bar(key, p, this.innerW - this.pxn(28)));
        if (sub) row.add_actor(this._label(sub, 10, C.faint));
        parent.add_actor(row);
    },

    _tile: function (parent, key, title, value, unit, p, sub) {
        let w = Math.floor((this.innerW - this.pxn(10)) / 2);
        let t = this._card("width: " + w + "px; spacing: " + this.px(6) + ";");
        t.add_actor(this._label(title, 11, C.dim));
        let v = new St.BoxLayout({ vertical: false });
        v.set_style("spacing: " + this.px(4) + ";");
        v.add(this._label(value, 26, C.text, true), { y_align: St.Align.END, y_fill: false });
        v.add(this._label(unit || "", 12, C.dim, false, "padding-bottom: " + this.px(5) + ";"), { y_align: St.Align.END, y_fill: false });
        t.add_actor(v);
        t.add_actor(this._bar(key, p, w - this.pxn(28)));
        t.add_actor(this._label(sub || " ", 10, C.faint));
        parent.add(t, { expand: true });
    },

    _infoRow: function (parent, key, value, color) {
        let r = new St.BoxLayout({ vertical: false });
        r.add(this._label(key, 12, C.dim), { expand: true });
        r.add_actor(this._label(value, 12, color || C.text));
        parent.add_actor(r);
    },

    _chip: function (text, color, bg) {
        return this._label(text, 10, color, true,
            "padding: " + this.px(3) + " " + this.px(9) + "; border-radius: " + this.px(9) + "; background-color: " + bg + ";");
    },

    _actionButton: function (text, cb, color) {
        let b = new St.Button({ label: text, reactive: true, track_hover: true, x_expand: true });
        b.set_style("padding: " + this.px(9) + " " + this.px(12) + "; border-radius: " + this.px(11) + ";" +
            "font-size: " + this.px(12) + "; font-weight: bold; color: white; background-color: " + (color || this.accent) + ";");
        b.connect("clicked", cb);
        this._hoverGrow(b);
        return b;
    },

    // ---------------------------------------------------------- render

    _switchTab: function (id) {
        if (id === this.tab) return;
        this.tab = id;
        this._render(true);
    },

    _render: function (animateIn) {
        for (let id in this.tabButtons) {
            let on = id === this.tab;
            this.tabButtons[id].set_style("padding: " + this.px(8) + " 0; border-radius: " + this.px(10) + ";" +
                "font-size: " + this.px(12) + "; font-weight: bold;" +
                (on ? "background-color: " + this.accent + "; color: white;" : "color: " + C.dim + ";"));
        }
        this._renderPhoneButton();
        this.body.destroy_all_children();
        if (!this.data) {
            this.body.add_actor(this._label("Loading…", 12, C.dim));
            return;
        }
        let s = this.data.system;
        this.subtitle.set_text(s.host.replace(/-/g, " ") + "  ·  up " + uptimeText(s.uptime));
        this.footer.set_text("Updated " + new Date(this.data.time * 1000).toLocaleTimeString() +
            "  ·  every " + this.refresh + "s  ·  right-click → Configure");
        if (this.tab === "ai") this._renderAi();
        else if (this.tab === "phone") this._renderPhone();
        else this._renderSystem();

        if (animateIn && this.animations) {
            this.body.opacity = 0;
            this.body.translation_y = this.pxn(10);
            this.body.ease({ opacity: 255, translation_y: 0, duration: 280, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }
    },

    _renderPhoneButton: function () {
        let p = this.data ? this.data.phone : null;
        let bg, title, sub, dot;
        if (this.busy) {
            bg = "rgb(75,85,99)"; title = "Connecting to Phone Box…"; sub = "Starting the PhoneBox agent"; dot = C.warn;
        } else if (p && p.connected) {
            bg = "rgb(15,118,110)"; title = "Phone Box connected";
            sub = (p.phone || "Phone") + " via " + (p.via || "?") + "  ·  tap to open settings"; dot = C.good;
        } else if (p && p.agent_up) {
            bg = "rgb(180,83,9)"; title = "Phone Box: waiting for phone";
            sub = "Open PhoneBox on the phone, or tap to retry"; dot = C.warn;
        } else {
            bg = this.accent; title = "Connect Phone Box";
            sub = this.message || "PhoneBox agent is stopped  ·  tap to connect"; dot = C.bad;
        }
        this.phoneBtn.set_style("padding: " + this.px(13) + " " + this.px(16) + "; border-radius: " + this.px(15) + ";" +
            "background-gradient-direction: horizontal; background-gradient-start: " + bg + ";" +
            "background-gradient-end: " + rgbaWith(bg, 0.7) + ";");
        this.phoneTitle.set_text(title);
        this.phoneSub.set_text(sub);
        this.phoneDot.set_style("font-size: " + this.px(18) + "; color: " + dot + ";");

        // pulse the dot while connecting or waiting
        let pulse = this.animations && (this.busy || (p && !p.connected));
        this.phoneDot.remove_all_transitions();
        this.phoneDot.opacity = 255;
        if (pulse)
            this.phoneDot.ease({ opacity: 60, duration: 800, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                                 repeatCount: -1, autoReverse: true });
    },

    _renderSystem: function () {
        let s = this.data.system;
        let row1 = new St.BoxLayout({ vertical: false });
        row1.set_style("spacing: " + this.px(10) + ";");
        this._tile(row1, "cpu", "CPU", s.cpu, "%", s.cpu, (s.cpu_temp ? s.cpu_temp + "°C  ·  " : "") + "load " + s.load);
        let ramP = s.mem.used / s.mem.total * 100;
        this._tile(row1, "ram", "Memory", gb(s.mem.used), "/ " + gb(s.mem.total) + " GB", ramP, Math.round(ramP) + "% used");
        this.body.add_actor(row1);

        let row2 = new St.BoxLayout({ vertical: false });
        row2.set_style("spacing: " + this.px(10) + ";");
        let diskP = s.disk.used / s.disk.total * 100;
        this._tile(row2, "disk", "Disk /", gb(s.disk.used), "/ " + gb(s.disk.total) + " GB", diskP, Math.round(diskP) + "% used");
        if (s.gpu) this._tile(row2, "gpu", "GPU · " + s.gpu.name, s.gpu.util, "%", s.gpu.util,
            s.gpu.temp + "°C  ·  " + s.gpu.mem_used + "/" + s.gpu.mem_total + " MB");
        this.body.add_actor(row2);

        let info = this._card();
        if (s.battery) this._infoRow(info, "🔋  Battery", s.battery.percent + "%  ·  " + s.battery.status,
            s.battery.percent < 20 ? C.bad : C.text);
        this._infoRow(info, "📶  Wi-Fi", s.wifi ? s.wifi.ssid + "  (" + s.wifi.signal + "%)" : "Not connected", s.wifi ? C.text : C.bad);
        this._infoRow(info, "🌐  IP address", s.ip || "offline");
        if (s.mem.swap_total) this._infoRow(info, "💾  Swap", gb(s.mem.swap_used) + " / " + gb(s.mem.swap_total) + " GB");
        this._infoRow(info, "⏱  Uptime", uptimeText(s.uptime));
        this.body.add_actor(info);
    },

    _renderAi: function () {
        let ai = this.data.ai;
        if (!ai.providers.length)
            this.body.add_actor(this._label("No AI limit data yet. Connect Phone Box, or run Claude Code once.", 12, C.dim));
        for (let p of ai.providers) {
            let card = this._card();
            let head = new St.BoxLayout({ vertical: false });
            head.set_style("spacing: " + this.px(6) + ";");
            head.add(this._label(p.name, 15, C.text, true), { expand: true, y_align: St.Align.MIDDLE, y_fill: false });
            if (p.sessions) head.add(this._chip(p.sessions + " running", C.good, "rgba(52,211,153,0.15)"), { y_align: St.Align.MIDDLE, y_fill: false });
            if (p.plan) head.add(this._chip(p.plan, "#ffffff", rgbaWith(this.accent, 0.35)), { y_align: St.Align.MIDDLE, y_fill: false });
            card.add_actor(head);
            p.limits.forEach((l, i) => this._meterRow(card, "ai-" + p.id + "-" + i, l.label, l.used, untilText(l.resets_at)));
            if (p.context) this._meterRow(card, "ai-" + p.id + "-ctx", "Last context (" + p.context.model + ")", p.context.used);
            card.add_actor(this._label([p.note, "updated " + agoText(p.updated)].filter(Boolean).join("  ·  "), 10, C.faint));
            this.body.add_actor(card);
        }
        if (ai.tools.length) {
            let card = this._card();
            card.add_actor(this._label("Other AI tools", 13, C.text, true));
            for (let t of ai.tools) this._infoRow(card, t.name, t.state, t.ok ? C.good : C.dim);
            this.body.add_actor(card);
        }
    },

    _renderPhone: function () {
        let p = this.data.phone;
        let yes = (v) => v ? C.good : C.bad;
        let card = this._card();
        this._infoRow(card, "Agent service", p.service, yes(p.service === "active"));
        this._infoRow(card, "Phone", p.phone || "—");
        this._infoRow(card, "Connected", p.connected ? "Yes, via " + p.via : "No", yes(p.connected));
        this._infoRow(card, "Last seen", agoText(p.last_seen));
        this._infoRow(card, "Wi-Fi port", p.wifi_port ? String(p.wifi_port) : "off");
        if (p.version) this._infoRow(card, "Agent version", p.version);
        if (p.problem) this._infoRow(card, "Problem", String(p.problem), C.warn);
        this.body.add_actor(card);
        if (this.message) this.body.add_actor(this._label(this.message, 11, C.warn));

        let row = new St.BoxLayout({ vertical: false });
        row.set_style("spacing: " + this.px(8) + ";");
        if (!p.connected) row.add(this._actionButton(this.busy ? "Connecting…" : "Connect", () => this._connect()), { expand: true });
        row.add(this._actionButton("Open settings", () => this._run(["settings"], () => {}), "rgb(55,65,81)"), { expand: true });
        if (p.service === "active") row.add(this._actionButton("Stop agent", () => this._stop(), "rgb(127,29,29)"), { expand: true });
        this.body.add_actor(row);
    },

    // ---------------------------------------------------------- actions

    _run: function (args, cb) {
        Util.spawnCommandLineAsyncIO(["python3", this.hub].concat(args).map((a) => GLib.shell_quote(a)).join(" "),
            (stdout, stderr, code) => cb(stdout, stderr, code));
    },

    _phoneClicked: function () {
        if (this.busy) return;
        let p = this.data ? this.data.phone : null;
        if (p && p.connected) this._run(["settings"], () => {});
        else this._connect();
    },

    _connect: function () {
        if (this.busy) return;
        this.busy = true;
        this.message = "";
        this._render(false);
        this._run(["connect"], (out, err) => {
            this.busy = false;
            let lines = (out || err || "").trim().split("\n");
            this.message = lines[lines.length - 1] || "";
            this._refresh();
        });
    },

    _stop: function () {
        this._run(["stop"], (out) => {
            this.message = (out || "").trim();
            this._refresh();
        });
    },

    _restartTimer: function () {
        if (this.timer) Mainloop.source_remove(this.timer);
        this.timer = Mainloop.timeout_add_seconds(this.refresh || 15, () => { this.timer = null; this._refresh(); return false; });
    },

    _refresh: function () {
        if (this.timer) Mainloop.source_remove(this.timer);
        this.timer = null;
        this._run(["status"], (out, err) => {
            try {
                this.data = JSON.parse(out);
            } catch (e) {
                global.logError(UUID + ": bad status output: " + err);
            }
            this._render(false);
            this._restartTimer();
        });
    },

    _tick: function () {
        let d = new Date();
        this.clock.set_text(("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2));
        this.date.set_text(d.toDateString());
        this.clockTimer = Mainloop.timeout_add_seconds(10, () => { this._tick(); return false; });
    },

    on_desklet_removed: function () {
        if (this.timer) Mainloop.source_remove(this.timer);
        if (this.clockTimer) Mainloop.source_remove(this.clockTimer);
        this.timer = this.clockTimer = null;
    }
};

function main(metadata, desklet_id) {
    return new MySystemStatus(metadata, desklet_id);
}
