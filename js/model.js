"use strict";

/* =========================================================================
   WE RUN Coaching — the session model.

   Two modes in one page:
     - no URL fragment  -> builder (the coach)
     - #w=<payload>     -> viewer (the athlete)

   The whole session is encoded into the fragment, so the link IS the
   session: no database, and links keep working forever.
   ========================================================================= */

/* ---------- vocabulary ---------------------------------------------------- */

const KINDS = {
  warmup:   { label: "Warm Up",   color: "var(--warmup)",   gc: "Warm Up" },
  work:     { label: "Run",       color: "var(--work)",     gc: "Run" },
  recovery: { label: "Recover",   color: "var(--recovery)", gc: "Recover" },
  cooldown: { label: "Cool Down", color: "var(--cooldown)", gc: "Cool Down" },
  rest:     { label: "Rest",      color: "var(--rest)",     gc: "Rest" },
  other:    { label: "Other",     color: "var(--other)",    gc: "Other" },
};
// Append-only: the index into this list is encoded into every share link,
// so reordering it would break links already sent to the group.
const KIND_ORDER = ["warmup", "work", "recovery", "cooldown", "rest", "other"];
const METERS = { km: 1000, mi: 1609.344 };

/* ---------- formatting ---------------------------------------------------- */

const pad2 = (n) => String(n).padStart(2, "0");

/** "3:45" | "225" | "1:02:30" -> seconds; null when unparseable. */
function parseClock(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const parts = s.split(":");
  for (const p of parts) if (!/^\d+(\.\d+)?$/.test(p.trim())) return null;
  return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}

function fmtClock(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? h + ":" + pad2(m) + ":" + pad2(s) : m + ":" + pad2(s);
}

function fmtDuration(sec) {
  sec = Math.round(sec);
  if (sec < 120) return sec + " sec";                       // coaches say "90 sec", not "1:30"
  if (sec < 600) return sec % 60 === 0 ? sec / 60 + " min" : fmtClock(sec) + " min";
  if (sec < 3600) return Math.round(sec / 60) + " min";     // long enough that seconds are noise
  return Math.floor(sec / 3600) + "h " + pad2(Math.round((sec % 3600) / 60));
}

function fmtDistance(m, units) {
  if (units === "mi") {
    const mi = m / METERS.mi;
    return mi < 0.25 ? Math.round(m) + " m" : +mi.toFixed(2) + " mi";
  }
  return m < 1000 ? Math.round(m) + " m" : +(m / 1000).toFixed(2) + " km";
}

const fmtPace = (sec, units) => fmtClock(sec) + " /" + units;

/** Human phrase for a step's length, e.g. "400 m", "90 sec", "lap button". */
function stepAmount(s, units) {
  if (s.durType === "distance") return fmtDistance(s.meters, units);
  if (s.durType === "time") return fmtDuration(s.seconds);
  // Lap-button steps have no fixed length; the coach's estimate is only a hint.
  return s.estSeconds ? "lap button, ~" + fmtDuration(s.estSeconds) : "lap button";
}

/** Human phrase for a step's target, e.g. "3:30-3:45 /km"; "" when open. */
function stepTarget(s, units) {
  const t = s.target;
  if (!t || t.kind === "none") return "";
  if (t.kind === "pace") {
    return t.fast === t.slow
      ? fmtPace(t.fast, units)
      : fmtClock(t.fast) + "-" + fmtClock(t.slow) + " /" + units;
  }
  return t.low === t.high ? t.low + " bpm" : t.low + "-" + t.high + " bpm";
}

function prettyDate(iso) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/* ---------- model --------------------------------------------------------- */

function blankStep(type) {
  const easy = type === "warmup" || type === "cooldown" || type === "recovery" || type === "rest";
  return {
    kind: "step",
    type: type || "work",
    label: "",
    note: "",
    durType: easy ? "time" : "distance",
    seconds: type === "recovery" || type === "rest" ? 60 : 600,
    meters: 400,
    estSeconds: 0, // planning hint for lap-button steps only
    target: { kind: "none" },
  };
}

/** The club's standing Tuesday session. */
function defaultWorkout() {
  return {
    name: "Tuesday | WeRUN",
    date: "",
    coach: "",
    note: "W12 Intervals",
    units: CONFIG.units === "mi" ? "mi" : "km",
    blocks: [
      Object.assign(blankStep("warmup"), { durType: "open", estSeconds: 900 }),
      Object.assign(blankStep("rest"), { durType: "open", note: "ABC drills" }),
      {
        kind: "repeat",
        reps: 15,
        steps: [
          Object.assign(blankStep("work"), { meters: 100, note: "@mile pace" }),
          Object.assign(blankStep("rest"), { seconds: 60 }),
        ],
      },
      Object.assign(blankStep("cooldown"), { durType: "open", estSeconds: 900 }),
    ],
  };
}

/**
 * Rough session totals.
 *   seconds     — total session time. `exact` is false when a step's length
 *                 had to be guessed from a pace, or is open-ended.
 *   workMeters  — distance of the hard running only, which is the number a
 *                 coach actually quotes ("6 x 400").
 *   steps       — steps as the athlete experiences them, repeats expanded.
 */
function estimate(w) {
  const unit = METERS[w.units];
  let seconds = 0;
  let workMeters = 0;
  let steps = 0;
  let exact = true;
  const add = (s, times) => {
    steps += times;
    if (s.type === "work" && s.durType === "distance") workMeters += s.meters * times;

    if (s.durType === "time") {
      seconds += s.seconds * times;
    } else if (s.durType === "distance") {
      if (s.target && s.target.kind === "pace") {
        // Derived from the target pace, so the total is an estimate.
        seconds += (s.meters / unit) * ((s.target.fast + s.target.slow) / 2) * times;
      }
      exact = false;
    } else {
      // Lap-button step: only as good as the coach's estimate, if they gave one.
      seconds += (s.estSeconds || 0) * times;
      exact = false;
    }
  };
  for (const b of w.blocks) {
    if (b.kind === "repeat") for (const s of b.steps) add(s, b.reps);
    else add(b, 1);
  }
  return { seconds: seconds, workMeters: workMeters, steps: steps, exact: exact };
}

/** Steps as the athlete experiences them, repeats expanded. */
function flatSteps(w) {
  const out = [];
  for (const b of w.blocks) {
    if (b.kind === "repeat") {
      for (let i = 0; i < b.reps; i++) for (const s of b.steps) out.push(s);
    } else out.push(b);
  }
  return out;
}

/* ---------- URL encoding -------------------------------------------------- */

const b64url = {
  encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(s) {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b + "===".slice((b.length + 3) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  },
};

/** Compact the model so links stay short enough for WhatsApp. */
function encodeWorkout(w) {
  const packStep = (s) => {
    const o = { t: KIND_ORDER.indexOf(s.type) };
    if (s.durType === "time") o.s = Math.round(s.seconds);
    else if (s.durType === "distance") o.m = Math.round(s.meters);
    else {
      o.o = 1;
      if (s.estSeconds) o.e = Math.round(s.estSeconds);
    }
    if (s.label) o.l = s.label;
    if (s.note) o.q = s.note;
    const g = s.target;
    if (g && g.kind === "pace") o.p = [Math.round(g.fast), Math.round(g.slow)];
    else if (g && g.kind === "hr") o.h = [g.low, g.high];
    return o;
  };
  const d = { n: w.name, b: [] };
  if (w.units !== "km") d.u = w.units;
  if (w.date) d.d = w.date;
  if (w.coach) d.c = w.coach;
  if (w.note) d.x = w.note;
  for (const b of w.blocks) {
    if (b.kind === "repeat") d.b.push({ r: b.reps, s: b.steps.map(packStep) });
    else d.b.push(packStep(b));
  }
  return b64url.encode(JSON.stringify(d));
}

function decodeWorkout(payload) {
  const d = JSON.parse(b64url.decode(payload));
  const unpackStep = (o) => {
    const s = blankStep(KIND_ORDER[o.t] || "work");
    s.label = o.l || "";
    s.note = o.q || "";
    if (o.s != null) {
      s.durType = "time";
      s.seconds = o.s;
    } else if (o.m != null) {
      s.durType = "distance";
      s.meters = o.m;
    } else {
      s.durType = "open";
      s.estSeconds = o.e || 0;
    }
    if (o.p) s.target = { kind: "pace", fast: o.p[0], slow: o.p[1] };
    else if (o.h) s.target = { kind: "hr", low: o.h[0], high: o.h[1] };
    else s.target = { kind: "none" };
    return s;
  };
  return {
    name: d.n || "Speed Session",
    date: d.d || "",
    coach: d.c || "",
    note: d.x || "",
    units: d.u === "mi" ? "mi" : "km",
    blocks: (d.b || []).map((b) =>
      b.r ? { kind: "repeat", reps: b.r, steps: (b.s || []).map(unpackStep) } : unpackStep(b)
    ),
  };
}

function shareUrl(w) {
  return location.origin + location.pathname + "#w=" + encodeWorkout(w);
}

/* ---------- plain-text version (for WhatsApp / the group chat) ------------- */

function asText(w) {
  const lines = [];
  lines.push(w.name.toUpperCase());
  if (w.date) lines.push(prettyDate(w.date));
  lines.push("");
  const line = (s, prefix) => {
    const k = KINDS[s.type];
    const t = stepTarget(s, w.units);
    return (
      (prefix || "") + (s.label || k.label) + " - " + stepAmount(s, w.units) +
      (t ? " @ " + t : "") + (s.note ? " (" + s.note + ")" : "")
    );
  };
  for (const b of w.blocks) {
    if (b.kind === "repeat") {
      lines.push(b.reps + "x:");
      for (const s of b.steps) lines.push(line(s, "   - "));
    } else {
      lines.push(line(b, "- "));
    }
  }
  const est = estimate(w);
  lines.push("");
  lines.push(
    "About " + fmtDuration(est.seconds) +
      (est.workMeters ? ", " + fmtDistance(est.workMeters, w.units) + " of it hard" : "")
  );
  if (w.note) {
    lines.push("");
    lines.push(w.note);
  }
  return lines.join("\n");
}

/* ---------- misc UI helpers ----------------------------------------------- */

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2200);
}

async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = el("textarea", { style: "position:fixed;opacity:0" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(msg || "Copied");
}

function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const slug = (s) =>
  (s || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "session";
