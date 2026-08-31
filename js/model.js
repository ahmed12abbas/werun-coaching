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
  if (sec < 120) return sec + t("uSec");                       // coaches say "90 sec", not "1:30"
  if (sec < 600) return sec % 60 === 0 ? sec / 60 + t("uMin") : fmtClock(sec) + t("uMin");
  if (sec < 3600) return Math.round(sec / 60) + t("uMin");     // long enough that seconds are noise
  return Math.floor(sec / 3600) + t("uHour") + pad2(Math.round((sec % 3600) / 60));
}

function fmtDistance(m, units) {
  if (units === "mi") {
    const mi = m / METERS.mi;
    return mi < 0.25 ? Math.round(m) + t("uM") : +mi.toFixed(2) + t("uMi");
  }
  return m < 1000 ? Math.round(m) + t("uM") : +(m / 1000).toFixed(2) + t("uKm");
}

const fmtPace = (sec, units) => fmtClock(sec) + " /" + unitLabel(units);

/** Human phrase for a step's length, e.g. "400 m", "90 sec", "lap button". */
function stepAmount(s, units) {
  if (s.durType === "distance") return fmtDistance(s.meters, units);
  if (s.durType === "time") return fmtDuration(s.seconds);
  // Lap-button steps have no fixed length; the coach's estimate is only a hint.
  return s.estSeconds ? t("uLapEst") + fmtDuration(s.estSeconds) : t("uLap");
}

/** Human phrase for a step's target, e.g. "3:30-3:45 /km"; "" when open. */
function stepTarget(s, units) {
  const g = s.target;
  if (!g || g.kind === "none") return "";
  if (g.kind === "pace") {
    return g.fast === g.slow
      ? fmtPace(g.fast, units)
      : fmtClock(g.fast) + "-" + fmtClock(g.slow) + " /" + unitLabel(units);
  }
  return g.low === g.high ? g.low + t("uBpm") : g.low + "-" + g.high + t("uBpm");
}

/** "km" / "كم" — the bare unit, for pace strings like "3:45 /km". */
function unitLabel(units) {
  return (units === "mi" ? t("uMi") : t("uKm")).trim();
}

function prettyDate(iso) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  const locale = I18N.lang === "ar" ? "ar" : undefined;
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
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

/* ---------- the club's standing sessions ----------------------------------
   The builder opens on the first one; the picker at the top of it swaps
   between them. Adding a day means writing a builder function and adding a
   line to SESSIONS — nothing else knows how many there are.
   ------------------------------------------------------------------------- */

const sessionShell = (name, note, blocks) => ({
  name: name,
  date: "",
  coach: "",
  note: note,
  units: CONFIG.units === "mi" ? "mi" : "km",
  blocks: blocks,
});

/** Monday: a 1-6 minute ladder at 5 K pace. */
function mondayLadder() {
  // Each rung is [work seconds, the recovery that follows it].
  const ladder = [[60, 60], [120, 60], [180, 90], [240, 120], [300, 120], [360, 120]];
  const blocks = [
    Object.assign(blankStep("warmup"), { seconds: 600 }),
    Object.assign(blankStep("rest"), { durType: "open", note: "ABC drills + strides" }),
  ];
  for (const rung of ladder) {
    blocks.push(
      Object.assign(blankStep("work"), { durType: "time", seconds: rung[0], note: "@5 K pace" })
    );
    blocks.push(Object.assign(blankStep("rest"), { seconds: rung[1] }));
  }
  blocks.push(Object.assign(blankStep("cooldown"), { seconds: 600 }));
  return sessionShell("Monday | WeRUN", "Ladder Intervals", blocks);
}

/**
 * Thursday: 12 x 200 m hill repeats. Everything except the reps themselves
 * ends on the lap button, because a hill is only as long as it is — the
 * 10 min is the coach's estimate, not something that stops the step.
 */
function thursdayHills() {
  return sessionShell("Thursday | WeRUN", "Hill Repeats", [
    Object.assign(blankStep("warmup"), { durType: "open", estSeconds: 600 }),
    Object.assign(blankStep("rest"), { durType: "open", note: "ABC drills + strides" }),
    {
      kind: "repeat",
      reps: 12,
      steps: [
        Object.assign(blankStep("work"), { meters: 200, label: "Hill" }),
        Object.assign(blankStep("recovery"), { durType: "open", note: "walk/jog down" }),
      ],
    },
    Object.assign(blankStep("cooldown"), { durType: "open", estSeconds: 600 }),
  ]);
}

// Order is the order of the picker buttons. `day` is an i18n key so the
// picker reads in Arabic too; the session's own name is the coach's to edit.
const SESSIONS = [
  { id: "monday", day: "sMonday", build: mondayLadder },
  { id: "thursday", day: "sThursday", build: thursdayHills },
];

/** What the builder opens on with no link and no edits yet. */
function defaultWorkout() {
  const w = SESSIONS[0].build();
  w.preset = SESSIONS[0].id;
  return w;
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

/* ---------- raw DEFLATE (RFC 1951) ---------------------------------------
   The link is rebuilt on every keystroke, so this has to be synchronous —
   CompressionStream is not. A session is a few hundred bytes of very
   repetitive JSON, so a plain hash-chain matcher over the fixed Huffman table
   gets almost all of the win for very little code. The output is ordinary raw
   deflate, so zlib (the Python tooling) and DecompressionStream read it too.
   ------------------------------------------------------------------------- */

// prettier-ignore
const LEN_BASE   = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
// prettier-ignore
const LEN_EXTRA  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
// prettier-ignore
const DIST_BASE  = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
// prettier-ignore
const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

/** Bytes -> one final fixed-Huffman deflate block.
    `dict`, when given, is history the decoder already has: matches may point
    back into it, but it is not part of the output. Same idea as zlib's preset
    dictionary, and byte-for-byte compatible with it. */
function deflateRaw(src, dict) {
  const out = [];
  let bitBuf = 0;
  let bitCnt = 0;

  // Everything except a Huffman code goes out low bit first.
  const putBits = (v, n) => {
    bitBuf |= v << bitCnt;
    bitCnt += n;
    while (bitCnt >= 8) {
      out.push(bitBuf & 255);
      bitBuf >>>= 8;
      bitCnt -= 8;
    }
  };
  // Huffman codes are the exception: high bit first.
  const putCode = (code, n) => {
    for (let i = n - 1; i >= 0; i--) putBits((code >>> i) & 1, 1);
  };
  // The fixed literal/length table, RFC 1951 section 3.2.6.
  const putSym = (sym) => {
    if (sym < 144) putCode(0x30 + sym, 8);
    else if (sym < 256) putCode(0x190 + sym - 144, 9);
    else if (sym < 280) putCode(sym - 256, 7);
    else putCode(0xc0 + sym - 280, 8);
  };
  const putMatch = (len, dist) => {
    let lc = 28;
    while (LEN_BASE[lc] > len) lc--;
    putSym(257 + lc);
    putBits(len - LEN_BASE[lc], LEN_EXTRA[lc]);
    let dc = 29;
    while (DIST_BASE[dc] > dist) dc--;
    putCode(dc, 5);
    putBits(dist - DIST_BASE[dc], DIST_EXTRA[dc]);
  };

  putBits(1, 1); // BFINAL: one block, and it is the last
  putBits(1, 2); // BTYPE = 01, fixed Huffman

  // The dictionary sits in front of the payload: the matcher walks over both,
  // but only the payload is ever emitted.
  const pre = dict ? dict.length : 0;
  let buf = src;
  if (pre) {
    buf = new Uint8Array(pre + src.length);
    buf.set(dict, 0);
    buf.set(src, pre);
  }

  const n = buf.length;
  const head = new Int32Array(1 << 15).fill(-1);
  const prev = new Int32Array(n || 1).fill(-1);
  const hash = (i) => ((buf[i] << 10) ^ (buf[i + 1] << 5) ^ buf[i + 2]) & 0x7fff;

  // Positions below `ins` are in the hash chains; a match only ever looks back.
  let ins = 0;
  const insertUpTo = (end) => {
    while (ins < end && ins + 2 < n) {
      const h = hash(ins);
      prev[ins] = head[h];
      head[h] = ins;
      ins++;
    }
  };

  const CHAIN = 128; // more than enough for a payload this size
  const longestAt = (i) => {
    if (i + 2 >= n) return [0, 0];
    const maxLen = Math.min(258, n - i);
    let best = 0;
    let bestDist = 0;
    let chain = CHAIN;
    for (let j = head[hash(i)]; j >= 0 && chain-- > 0; j = prev[j]) {
      if (i - j > 32768) break;
      let l = 0;
      while (l < maxLen && buf[j + l] === buf[i + l]) l++;
      if (l > best) {
        best = l;
        bestDist = i - j;
        if (l === maxLen) break;
      }
    }
    return best >= 3 ? [best, bestDist] : [0, 0];
  };

  let i = pre;
  while (i < n) {
    insertUpTo(i);
    let found = longestAt(i);
    if (found[0] >= 3) {
      // Lazy match: a longer run one byte along usually pays for the literal.
      insertUpTo(i + 1);
      const next = longestAt(i + 1);
      if (next[0] > found[0]) {
        putSym(buf[i]);
        i++;
        found = next;
      }
    }
    if (found[0] >= 3) {
      putMatch(found[0], found[1]);
      i += found[0];
    } else {
      putSym(buf[i]);
      i++;
    }
  }

  putSym(256); // end of block
  if (bitCnt) out.push(bitBuf & 255);
  return Uint8Array.from(out);
}

/** The other direction, with the same optional dictionary. It handles all three
    block types, so a payload packed by zlib elsewhere decodes here just as
    well. */
function inflateRaw(src, dict) {
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(1024);
  let len = 0;

  const need = (extra) => {
    if (len + extra <= out.length) return;
    let size = out.length;
    while (size < len + extra) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(out.subarray(0, len));
    out = bigger;
  };
  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error("deflate: out of input");
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };

  // Canonical Huffman, walked one bit at a time (Mark Adler's "puff").
  const build = (lengths) => {
    const count = new Int32Array(16);
    for (const l of lengths) if (l) count[l]++;
    const offs = new Int32Array(16);
    for (let l = 1; l < 15; l++) offs[l + 1] = offs[l] + count[l];
    const symbol = new Int32Array(lengths.length);
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
    return { count: count, symbol: symbol };
  };
  const decode = (h) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let l = 1; l <= 15; l++) {
      code |= bits(1);
      const count = h.count[l];
      if (code - first < count) return h.symbol[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error("deflate: bad code");
  };

  const fixedLit = build(
    Array.from({ length: 288 }, (_, s) => (s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8))
  );
  const fixedDist = build(new Array(30).fill(5));
  const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  // The dictionary is history the encoder could point back into: lay it down
  // first and hand back only what comes after it.
  const pre = dict ? dict.length : 0;
  if (pre) {
    need(pre);
    out.set(dict, 0);
    len = pre;
  }

  for (;;) {
    const last = bits(1);
    const type = bits(2);

    if (type === 0) {
      // Stored: drop to the byte boundary, then a plain length-prefixed copy.
      bitBuf = 0;
      bitCnt = 0;
      const n = src[pos] | (src[pos + 1] << 8);
      pos += 4; // the length, then its one's complement
      need(n);
      out.set(src.subarray(pos, pos + n), len);
      pos += n;
      len += n;
    } else {
      let lit;
      let dist;
      if (type === 1) {
        lit = fixedLit;
        dist = fixedDist;
      } else if (type === 2) {
        const nlen = bits(5) + 257;
        const ndist = bits(5) + 1;
        const ncode = bits(4) + 4;
        const clens = new Array(19).fill(0);
        for (let i = 0; i < ncode; i++) clens[CLEN_ORDER[i]] = bits(3);
        const cl = build(clens);
        const lengths = new Array(nlen + ndist).fill(0);
        for (let i = 0; i < lengths.length; ) {
          const sym = decode(cl);
          if (sym < 16) lengths[i++] = sym;
          else if (sym === 16) {
            const p = lengths[i - 1];
            for (let r = bits(2) + 3; r > 0; r--) lengths[i++] = p;
          } else if (sym === 17) {
            for (let r = bits(3) + 3; r > 0; r--) lengths[i++] = 0;
          } else {
            for (let r = bits(7) + 11; r > 0; r--) lengths[i++] = 0;
          }
        }
        lit = build(lengths.slice(0, nlen));
        dist = build(lengths.slice(nlen));
      } else {
        throw new Error("deflate: bad block type");
      }

      for (;;) {
        const sym = decode(lit);
        if (sym === 256) break;
        if (sym < 256) {
          need(1);
          out[len++] = sym;
        } else {
          const lc = sym - 257;
          if (lc >= LEN_BASE.length) throw new Error("deflate: bad length code");
          const n = LEN_BASE[lc] + bits(LEN_EXTRA[lc]);
          const dc = decode(dist);
          const d = DIST_BASE[dc] + bits(DIST_EXTRA[dc]);
          if (d > len) throw new Error("deflate: distance past start");
          need(n);
          for (let k = 0; k < n; k++, len++) out[len] = out[len - d];
        }
      }
    }
    if (last) break;
  }
  return out.subarray(pre, len);
}

/* ---------- URL encoding -------------------------------------------------- */

const b64url = {
  fromBytes(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  toBytes(s) {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b + "===".slice((b.length + 3) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  },
  encode(str) {
    return this.fromBytes(new TextEncoder().encode(str));
  },
  decode(s) {
    return new TextDecoder().decode(this.toBytes(s));
  },
};

// Payload versions. The first links carried bare base64 JSON with no marker at
// all, so version 0 is "no prefix" and stays readable forever; anything newer
// announces itself up front. A "." can never occur in base64url, so the two are
// always told apart.
const PAYLOAD_V1 = "1."; // JSON, raw-deflated against LINK_DICT

// Sessions are only ~200 bytes, far too short for deflate to learn the shape of
// them on its own, so it starts with this as history: the punctuation every
// session repeats, then the words this club actually types. It saves about a
// third again on top of plain deflate.
//
// FROZEN. Every v1 link ever sent is decoded against these exact bytes — one
// character changed here and those links turn to noise. Improvements go in a
// LINK_DICT_V2 behind a "2." marker, never here. Rarest first: the closer to
// the end a string sits, the cheaper it is to point at.
const LINK_DICT =
  '"u":"mi","d":"2026-","c":"","x":""' +
  "Warm UpCool DownRecoverIntervals drillsRep@mile pace@10k pace" +
  "إحماءتهدئةراحةتكراراتمترالثلاثاء | وي رَن" +
  '{"n":"Tuesday | WeRUN","b":[' +
  ',"l":"",,"h":[,],"p":[,],"e":900,"q":"",{"r":,"s":[{"t":,"o":1,"m":,"s":' +
  '},{"t":0},{"t":1},{"t":3},{"t":4}]},{"t":';
const linkDictBytes = new TextEncoder().encode(LINK_DICT);

/** Compact the model so links stay short enough for WhatsApp. */
function packWorkout(w) {
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
  return d;
}

function encodeWorkout(w) {
  const json = JSON.stringify(packWorkout(w));
  const plain = b64url.encode(json);
  try {
    const bytes = new TextEncoder().encode(json);
    const packed = PAYLOAD_V1 + b64url.fromBytes(deflateRaw(bytes, linkDictBytes));
    // Compression loses on the very shortest sessions; send whichever is shorter.
    return packed.length < plain.length ? packed : plain;
  } catch (e) {
    console.error(e); // a shorter link is never worth a broken one
    return plain;
  }
}

function decodeWorkout(payload) {
  const json =
    payload.slice(0, PAYLOAD_V1.length) === PAYLOAD_V1
      ? new TextDecoder().decode(
          inflateRaw(b64url.toBytes(payload.slice(PAYLOAD_V1.length)), linkDictBytes)
        )
      : b64url.decode(payload);
  const d = JSON.parse(json);
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
      (prefix || "") + (s.label || kindLabel(s.type)) + " - " + stepAmount(s, w.units) +
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
    t("txtAbout") + fmtDuration(est.seconds) +
      (est.workMeters ? ", " + fmtDistance(est.workMeters, w.units) + t("txtHard") : "")
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
