"use strict";

/* =========================================================================
   FIT workout file encoder.

   Implements just enough of the FIT binary protocol to emit a valid
   file_id + workout + workout_step file that a Garmin device will read
   when copied into its GARMIN/NewFiles folder.

   Reference: FIT Protocol / Profile, global messages 0, 26, 27.
   ========================================================================= */

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z, in Unix seconds

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function fitCrc(bytes, crc = 0) {
  for (const b of bytes) {
    let t = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ t ^ CRC_TABLE[b & 0xf];
    t = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ t ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc & 0xffff;
}

// FIT base types
const T = {
  enum: 0x00,
  uint8: 0x02,
  string: 0x07,
  uint16: 0x84,
  uint32: 0x86,
  uint32z: 0x8c,
};
const INVALID_ENUM = 0xff;
const INVALID_U32 = 0xffffffff;

const sizeOf = (t) => (t === T.enum || t === T.uint8 ? 1 : t === T.uint16 ? 2 : 4);

class Buf {
  constructor() {
    this.b = [];
  }
  u8(v) {
    this.b.push(v & 0xff);
    return this;
  }
  u16(v) {
    return this.u8(v).u8(v >>> 8);
  }
  u32(v) {
    return this.u8(v).u8(v >>> 8).u8(v >>> 16).u8(v >>> 24);
  }
  /** Fixed-width, null-terminated UTF-8 string field. */
  str(s, len) {
    const enc = new TextEncoder().encode(String(s == null ? "" : s));
    for (let i = 0; i < len - 1; i++) this.u8(i < enc.length ? enc[i] : 0);
    return this.u8(0);
  }
  bytes() {
    return Uint8Array.from(this.b);
  }
}

/** Definition message for one local message type. */
function fitDef(buf, local, globalNum, fields) {
  buf.u8(0x40 | local).u8(0).u8(0).u16(globalNum).u8(fields.length);
  for (const f of fields) buf.u8(f.n).u8(f.size || sizeOf(f.t)).u8(f.t);
}

/**
 * Flatten repeat groups into the linear step list FIT expects: the children
 * are emitted inline, followed by a repeat step pointing back at the first.
 */
function flattenForFit(workout) {
  const out = [];
  for (const blk of workout.blocks) {
    if (blk.kind === "repeat") {
      const from = out.length;
      for (const s of blk.steps) out.push(s);
      out.push({ _repeat: true, from: from, reps: blk.reps });
    } else {
      out.push(blk);
    }
  }
  return out;
}

/**
 * @param {object} workout  normalised workout (see model.js)
 * @returns {Uint8Array}    complete .FIT file bytes
 */
function buildFitFile(workout) {
  const steps = flattenForFit(workout);
  const unitMeters = workout.units === "mi" ? 1609.344 : 1000;
  const d = new Buf();

  // --- file_id (global 0) -------------------------------------------------
  fitDef(d, 0, 0, [
    { n: 0, t: T.enum },    // type = 5 (workout)
    { n: 1, t: T.uint16 },  // manufacturer
    { n: 2, t: T.uint16 },  // product
    { n: 3, t: T.uint32z }, // serial_number
    { n: 4, t: T.uint32 },  // time_created
  ]);
  d.u8(0)
    .u8(5)
    .u16(1) // manufacturer: garmin
    .u16(0)
    .u32(0)
    .u32(Math.max(0, Math.floor(Date.now() / 1000) - FIT_EPOCH));

  // --- workout (global 26) ------------------------------------------------
  fitDef(d, 1, 26, [
    { n: 4, t: T.enum },             // sport = 1 (running)
    { n: 5, t: T.uint32z },          // capabilities
    { n: 6, t: T.uint16 },           // num_valid_steps
    { n: 8, t: T.string, size: 32 }, // wkt_name
  ]);
  d.u8(1).u8(1).u32(0).u16(steps.length).str(workout.name || "Speed Session", 32);

  // --- workout_step (global 27) -------------------------------------------
  fitDef(d, 2, 27, [
    { n: 254, t: T.uint16 },           // message_index
    { n: 0, t: T.string, size: 24 },   // wkt_step_name
    { n: 1, t: T.enum },               // duration_type
    { n: 2, t: T.uint32 },             // duration_value
    { n: 3, t: T.enum },               // target_type
    { n: 4, t: T.uint32 },             // target_value
    { n: 5, t: T.uint32 },             // custom_target_value_low
    { n: 6, t: T.uint32 },             // custom_target_value_high
    { n: 7, t: T.enum },               // intensity
    { n: 8, t: T.string, size: 40 },   // notes
  ]);

  steps.forEach((s, i) => {
    d.u8(2).u16(i);

    if (s._repeat) {
      // duration_type 6 = repeat_until_steps_cmplt.
      // duration_value doubles as the step index to jump back to, and
      // target_value doubles as the iteration count.
      d.str("", 24)
        .u8(6)
        .u32(s.from)
        .u8(2) // target_type: open
        .u32(s.reps)
        .u32(INVALID_U32)
        .u32(INVALID_U32)
        .u8(INVALID_ENUM)
        .str("", 40);
      return;
    }

    const intensity = FIT_INTENSITY[s.type] != null ? FIT_INTENSITY[s.type] : 0;
    d.str(s.label || FIT_STEP_NAME[s.type] || "Run", 24);

    // duration
    if (s.durType === "distance") {
      d.u8(1).u32(Math.round(s.meters * 100)); // centimetres
    } else if (s.durType === "time") {
      d.u8(0).u32(Math.round(s.seconds * 1000)); // milliseconds
    } else {
      d.u8(5).u32(INVALID_U32); // open — advance on lap button
    }

    // target
    const t = s.target;
    if (t && t.kind === "pace") {
      // FIT stores speed, not pace, so the slower pace is the LOW bound.
      const lo = Math.round((unitMeters / t.slow) * 1000);
      const hi = Math.round((unitMeters / t.fast) * 1000);
      d.u8(0).u32(0).u32(lo).u32(hi);
    } else if (t && t.kind === "hr") {
      // 1-100 reads as %max, 101-255 as absolute bpm, hence the +100 offset.
      d.u8(1).u32(0).u32(t.low + 100).u32(t.high + 100);
    } else {
      d.u8(2).u32(0).u32(0).u32(0); // open target
    }

    d.u8(intensity).str(s.note || "", 40);
  });

  // --- header + CRCs ------------------------------------------------------
  const data = d.bytes();
  const h = new Buf();
  h.u8(14).u8(0x20).u16(2140).u32(data.length);
  for (const c of ".FIT") h.u8(c.charCodeAt(0));
  const head = h.bytes();

  const out = new Uint8Array(14 + data.length + 2);
  out.set(head, 0);
  const headCrc = fitCrc(head);
  out[12] = headCrc & 0xff;
  out[13] = (headCrc >>> 8) & 0xff;
  out.set(data, 14);
  const crc = fitCrc(out.subarray(0, 14 + data.length));
  out[14 + data.length] = crc & 0xff;
  out[15 + data.length] = (crc >>> 8) & 0xff;
  return out;
}

// intensity enum: 0 active, 1 rest, 2 warmup, 3 cooldown, 4 recovery, 6 other.
// Recover/Rest both map to 1: it is the value every Garmin device handles, where
// 4 and 6 are patchier across older watches.
const FIT_INTENSITY = { warmup: 2, work: 0, recovery: 1, cooldown: 3, rest: 1, other: 0 };

// Fallback step names, so the watch shows something readable per step.
const FIT_STEP_NAME = {
  warmup: "Warm Up",
  work: "Run",
  recovery: "Recover",
  cooldown: "Cool Down",
  rest: "Rest",
  other: "Other",
};
