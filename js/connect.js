"use strict";

/* =========================================================================
   WE RUN Coaching — one-tap delivery to the athlete's watch.

   How the session actually reaches a watch
   ----------------------------------------
   Garmin has no "import workout from a link", and Garmin's own developer
   programme is closed to new applicants, so there is no way to talk to
   Garmin Connect directly. What does work is intervals.icu: it is free, it
   is an official Garmin partner, and once an athlete links their Garmin
   account there it uploads their planned workouts into Garmin Connect,
   which then syncs to the watch.

   So the chain is:

       athlete taps Connect
         -> intervals.icu asks them to approve WE RUN  (this is the
            "permission" step — they approve it on intervals.icu, we never
            see a password)
         -> our Worker stores the access token server-side
         -> we POST the session onto their intervals.icu calendar
         -> intervals.icu pushes it into Garmin Connect
         -> it appears on the watch at the next sync

   The browser only ever holds an opaque handle. The intervals.icu access
   token lives in the Cloudflare Worker (see worker/), never in the page.
   ========================================================================= */

const Connect = {
  KEY: "werun.link",

  /** True when the coach has deployed the Worker and switched this on. */
  isEnabled() {
    return !!(CONFIG.workerUrl && CONFIG.connectEnabled);
  },

  api(path) {
    return CONFIG.workerUrl.replace(/\/+$/, "") + path;
  },

  token() {
    try {
      return localStorage.getItem(Connect.KEY) || "";
    } catch (e) {
      return ""; // private mode, or storage blocked — treated as "not linked"
    }
  },

  save(t) {
    try {
      localStorage.setItem(Connect.KEY, t);
    } catch (e) {
      /* nothing we can do; the athlete will just be asked to link again */
    }
  },

  forget() {
    try {
      localStorage.removeItem(Connect.KEY);
    } catch (e) {}
  },

  isLinked() {
    return !!Connect.token();
  },

  /**
   * intervals.icu sends the athlete back to `?linked=<handle>` with the
   * `#w=` session fragment intact. Stash the handle and tidy the URL so the
   * link they might re-share doesn't carry their handle in it.
   */
  captureRedirect() {
    const q = new URLSearchParams(location.search);
    const linked = q.get("linked");
    const err = q.get("link_error");
    if (!linked && !err) return null;
    if (linked) Connect.save(linked);
    q.delete("linked");
    q.delete("link_error");
    const qs = q.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    return linked ? { ok: true } : { ok: false, error: err };
  },

  /** Hand the athlete to intervals.icu to approve us. */
  begin() {
    const back = location.origin + location.pathname + location.hash;
    location.href = Connect.api("/oauth/start") + "?return=" + encodeURIComponent(back);
  },

  async request(path, opts) {
    const o = Object.assign({ headers: {} }, opts || {});
    o.headers = Object.assign(
      { Authorization: "Bearer " + Connect.token(), "Content-Type": "application/json" },
      o.headers
    );
    const res = await fetch(Connect.api(path), o);
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      /* non-JSON error page */
    }
    if (res.status === 401) {
      Connect.forget();
      throw new Error("Your link to intervals.icu expired — tap Connect again.");
    }
    if (!res.ok) throw new Error((body && body.error) || "Request failed (" + res.status + ")");
    return body;
  },

  /** Who is linked, and have they turned on the Garmin upload over there? */
  status() {
    return Connect.request("/api/me", { method: "GET" });
  },

  /**
   * Put the session on the athlete's intervals.icu calendar.
   * `date` is an ISO yyyy-mm-dd; defaults to the session's own date or today.
   */
  push(w, date) {
    const payload = {
      date: date || w.date || todayISO(),
      name: w.name,
      description: toIntervalsText(w),
    };
    // The .fit file carries the exact steps and targets. If the encoder
    // trips on something, the description still gets the session across.
    try {
      payload.fitBase64 = bytesToBase64(buildFitFile(w));
      payload.filename = slug(w.name) + ".fit";
    } catch (e) {
      console.error("fit encode failed, sending text only", e);
    }
    return Connect.request("/api/push", { method: "POST", body: JSON.stringify(payload) });
  },
};

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000; // avoid blowing the argument limit on big files
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

/* ---------- session -> intervals.icu workout text -------------------------
   intervals.icu describes a structured session in a small plain-text
   language, one step per line, indented lines belonging to a repeat:

       Warmup
       - 15m
       15x
       - 100m 3:20-3:30/km
       - 1m
       Cooldown
       - 15m

   Pace targets go through as a /km (or /mi) range, which intervals.icu
   converts to the watch's own target when it uploads to Garmin.
   -------------------------------------------------------------------------- */

function toIntervalsText(w) {
  const lines = [];
  const step = (s, indent) => {
    const bits = [];
    if (s.durType === "time") bits.push(Math.round(s.seconds) + "s");
    else if (s.durType === "distance") bits.push(Math.round(s.meters) + "m");
    else bits.push(s.estSeconds ? Math.round(s.estSeconds) + "s" : "60s"); // lap-button: use the hint

    const t = s.target;
    if (t && t.kind === "pace") {
      bits.push(fmtClock(t.fast) + "-" + fmtClock(t.slow) + "/" + w.units);
    } else if (t && t.kind === "hr") {
      bits.push(t.low + "-" + t.high + "bpm");
    }

    const name = s.label || KINDS[s.type].label;
    lines.push(indent + "- " + bits.join(" ") + " " + name + (s.note ? " (" + s.note + ")" : ""));
  };

  for (const b of w.blocks) {
    if (b.kind === "repeat") {
      lines.push(b.reps + "x");
      for (const s of b.steps) step(s, "");
    } else {
      step(b, "");
    }
  }
  return lines.join("\n");
}
