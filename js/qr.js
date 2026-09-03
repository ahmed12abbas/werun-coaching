"use strict";

/* =========================================================================
   WE RUN Coaching — a QR code, written out.

   The check-in code has to render on the coach's phone at the track, on a
   patchy connection, every thirty seconds. So it is drawn here rather than
   fetched: no CDN (the site loads none), no image service (the code carries
   a signature and has no business leaving the club), and no library for
   something a page needs once.

   Only what a URL needs: byte mode, versions 1 to 10, error correction L or
   M. That reaches 271 characters at L, where the longest check-in link is
   about 110. Anything longer throws rather than quietly truncating.

   The pieces, in the order the standard builds them:
     encode()      text  -> data codewords
     eccFor()      data  -> data + error correction, interleaved
     matrixFor()   bits  -> the module grid, masked and formatted
     qrSvg()       grid  -> an <svg> string

   Reference: ISO/IEC 18004. The tables below are that document's, for the
   ten versions this file covers.
   ========================================================================= */

/* Total data codewords, and how they are split into blocks, per version and
   level: [ecPerBlock, blocks1, dataPerBlock1, blocks2, dataPerBlock2]. */
const QR_BLOCKS = {
  L: [
    null,
    [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
  ],
  M: [
    null,
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
  ],
};

/** Centres of the alignment patterns, per version. */
const QR_ALIGN = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/* ---------- the field ----------------------------------------------------
   Reed-Solomon over GF(256) with the QR polynomial, x^8+x^4+x^3+x^2+1.
   Logs and antilogs built once, so the generator work below is addition. */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function buildField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

/**
 * The generator polynomial for `n` error correction codewords: the product
 * of (x - α^i) for i in 0..n-1.
 *
 * Coefficients run highest degree first, so poly[0] is the leading 1 that
 * the division below relies on.
 */
function generatorPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]; // times x
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]); // times α^i
    }
    poly = next;
  }
  return poly;
}

/** Long division by the generator; the remainder is the check codewords. */
function remainder(data, n) {
  const gen = generatorPoly(n);
  const buf = new Uint8Array(data.length + n);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const lead = buf[i];
    if (!lead) continue;
    for (let j = 0; j < gen.length; j++) buf[i + j] ^= gfMul(gen[j], lead);
  }
  return buf.slice(data.length);
}

/* ---------- bits ---------------------------------------------------------- */

function BitWriter() {
  this.bytes = [];
  this.length = 0; // in bits
}
BitWriter.prototype.put = function (value, bits) {
  for (let i = bits - 1; i >= 0; i--) {
    const bit = (value >>> i) & 1;
    const at = this.length >> 3;
    if (this.bytes.length <= at) this.bytes.push(0);
    if (bit) this.bytes[at] |= 0x80 >>> this.length % 8;
    this.length++;
  }
};

/* ---------- data ---------------------------------------------------------- */

/** The smallest version in 1..10 that holds `bytes` at this level. */
function versionFor(byteLength, level) {
  for (let v = 1; v <= 10; v++) {
    const [ec, b1, d1, b2, d2] = QR_BLOCKS[level][v];
    const capacity = b1 * d1 + b2 * d2;
    const header = 4 + (v < 10 ? 8 : 16);
    if (byteLength + Math.ceil(header / 8) <= capacity) return v;
    void ec;
  }
  throw new Error("qr: " + byteLength + " bytes is more than version 10 holds at level " + level);
}

/** Text -> the data codewords for `version`, padded to its capacity. */
function encode(text, version, level) {
  const bytes = new TextEncoder().encode(text);
  const [, b1, d1, b2, d2] = QR_BLOCKS[level][version];
  const capacity = b1 * d1 + b2 * d2;

  const w = new BitWriter();
  w.put(0b0100, 4); // byte mode
  w.put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) w.put(b, 8);
  // Terminator, then up to a byte boundary.
  w.put(0, Math.min(4, capacity * 8 - w.length));
  while (w.length % 8) w.put(0, 1);

  const out = new Uint8Array(capacity);
  out.set(w.bytes.slice(0, capacity));
  // The standard's own filler, alternating, from the end of the data.
  for (let i = w.bytes.length; i < capacity; i++) out[i] = (i - w.bytes.length) % 2 ? 0x11 : 0xec;
  return out;
}

/** Split into blocks, add the check codewords, and interleave as required. */
function eccFor(data, version, level) {
  const [ec, b1, d1, b2, d2] = QR_BLOCKS[level][version];
  const blocks = [];
  let at = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const size = i < b1 ? d1 : d2;
    const chunk = data.slice(at, at + size);
    at += size;
    blocks.push({ data: chunk, ec: remainder(chunk, ec) });
  }

  const out = [];
  const longest = Math.max(d1, d2);
  for (let i = 0; i < longest; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  }
  for (let i = 0; i < ec; i++) {
    for (const b of blocks) out.push(b.ec[i]);
  }
  return Uint8Array.from(out);
}

/* ---------- the grid ------------------------------------------------------ */

/* Each cell is 0 or 1 once set; `fixed` marks the patterns, which the mask
   must not touch and the data must skip. */
function blankGrid(size) {
  const grid = [];
  const fixed = [];
  for (let r = 0; r < size; r++) {
    grid.push(new Uint8Array(size));
    fixed.push(new Uint8Array(size));
  }
  return { grid, fixed };
}

function placeFinder(g, size, top, left) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const y = top + r;
      const x = left + c;
      if (y < 0 || y >= size || x < 0 || x >= size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      g.grid[y][x] = inRing || inCore ? 1 : 0;
      g.fixed[y][x] = 1;
    }
  }
}

function placeAlignment(g, version) {
  const centres = QR_ALIGN[version];
  for (const r of centres) {
    for (const c of centres) {
      // The three corners already carry finders.
      if (g.fixed[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          g.grid[r + dr][c + dc] = ring !== 1 ? 1 : 0;
          g.fixed[r + dr][c + dc] = 1;
        }
      }
    }
  }
}

function placeTiming(g, size) {
  for (let i = 8; i < size - 8; i++) {
    const on = i % 2 === 0 ? 1 : 0;
    g.grid[6][i] = on;
    g.fixed[6][i] = 1;
    g.grid[i][6] = on;
    g.fixed[i][6] = 1;
  }
}

/** Reserve the format and version areas so the data placement steps over them. */
function reserveInfo(g, size, version) {
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      g.fixed[8][i] = 1;
      g.fixed[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    g.fixed[8][size - 1 - i] = 1;
    g.fixed[size - 1 - i][8] = 1;
  }
  // The dark module, which is always on.
  g.grid[size - 8][8] = 1;
  g.fixed[size - 8][8] = 1;

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      g.fixed[r][size - 11 + c] = 1;
      g.fixed[size - 11 + c][r] = 1;
    }
  }
}

/** The zigzag: two columns at a time, right to left, skipping column 6. */
function placeData(g, size, bytes) {
  let bit = 0;
  const total = bytes.length * 8;
  let up = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the vertical timing line is not a data column
    for (let step = 0; step < size; step++) {
      const r = up ? size - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (g.fixed[r][c]) continue;
        let on = 0;
        if (bit < total) on = (bytes[bit >> 3] >>> (7 - (bit % 8))) & 1;
        g.grid[r][c] = on;
        bit++;
      }
    }
    up = !up;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** The standard's four penalties, added up; lower is the mask to keep. */
function penalty(grid, size) {
  let score = 0;

  // 1: runs of five or more of one colour, in both directions.
  for (let i = 0; i < size; i++) {
    for (const line of [
      (j) => grid[i][j],
      (j) => grid[j][i],
    ]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (line(j) === line(j - 1)) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // 2: any 2x2 block of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }

  // 3: the finder-lookalike, 1011101 with four light either side.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      let rowA = true, rowB = true, colA = true, colB = true;
      for (let k = 0; k < 11; k++) {
        if (grid[i][j + k] !== A[k]) rowA = false;
        if (grid[i][j + k] !== B[k]) rowB = false;
        if (grid[j + k][i] !== A[k]) colA = false;
        if (grid[j + k][i] !== B[k]) colB = false;
      }
      if (rowA) score += 40;
      if (rowB) score += 40;
      if (colA) score += 40;
      if (colB) score += 40;
    }
  }

  // 4: how far the dark share is from half.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += grid[r][c];
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

function formatBits(level, mask) {
  const levelBits = level === "L" ? 0b01 : 0b00;
  const data = (levelBits << 3) | mask;
  let v = data << 10;
  for (let i = 14; i >= 10; i--) if (v & (1 << i)) v ^= 0x537 << (i - 10);
  return ((data << 10) | v) ^ 0x5412;
}

function versionBits(version) {
  let v = version << 12;
  for (let i = 17; i >= 12; i--) if (v & (1 << i)) v ^= 0x1f25 << (i - 12);
  return (version << 12) | v;
}

function writeFormat(grid, size, level, mask) {
  const bits = formatBits(level, mask);
  // Placed most significant first: position 0 in the sequence carries bit 14.
  const at = (k) => (bits >>> (14 - k)) & 1;

  for (let k = 0; k <= 5; k++) grid[8][k] = at(k);
  grid[8][7] = at(6);
  grid[8][8] = at(7);
  grid[7][8] = at(8);
  for (let k = 9; k <= 14; k++) grid[14 - k][8] = at(k);

  // The second copy is 7 modules up the left of the bottom-right finder and 8
  // along the top of it — not 8 and 7. The dark module sits between the two
  // runs, at (size-8, 8), and is never a format bit.
  for (let k = 0; k <= 6; k++) grid[size - 1 - k][8] = at(k);
  for (let k = 7; k <= 14; k++) grid[8][size - 15 + k] = at(k);
}

function writeVersion(grid, size, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const on = (bits >>> i) & 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    grid[r][size - 11 + c] = on;
    grid[size - 11 + c][r] = on;
  }
}

/**
 * The finished module grid for `text`, as an array of Uint8Arrays.
 * `level` is "L" or "M"; M is the default, and what a phone screen wants.
 */
function qrMatrix(text, level) {
  const lvl = level === "L" ? "L" : "M";
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length, lvl);
  const size = 17 + version * 4;

  const base = blankGrid(size);
  placeFinder(base, size, 0, 0);
  placeFinder(base, size, 0, size - 7);
  placeFinder(base, size, size - 7, 0);
  placeAlignment(base, version);
  placeTiming(base, size);
  reserveInfo(base, size, version);
  placeData(base, size, eccFor(encode(text, version, lvl), version, lvl));

  // Eight candidates, and the one the standard likes best wins.
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const grid = base.grid.map((row) => Uint8Array.from(row));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!base.fixed[r][c] && MASKS[mask](r, c)) grid[r][c] ^= 1;
      }
    }
    writeFormat(grid, size, lvl, mask);
    writeVersion(grid, size, version);
    const score = penalty(grid, size);
    if (!best || score < best.score) best = { grid, score, mask };
  }
  return best.grid;
}

/**
 * The same as one <svg> string, sized to whatever box it is dropped into.
 * One path for every dark module: fewer nodes than a rect each, and it
 * scales without seams between them.
 */
function qrSvg(text, level) {
  const grid = qrMatrix(text, level);
  const size = grid.length;
  const quiet = 4; // the standard's margin, without which some scanners miss it
  const span = size + quiet * 2;

  let d = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + span + " " + span + '" ' +
    'shape-rendering="crispEdges" role="img" aria-label="QR code">' +
    '<rect width="' + span + '" height="' + span + '" fill="#fff"/>' +
    '<path d="' + d + '" fill="#000"/></svg>'
  );
}

/* Node loads this file to test the encoder; a browser just defines it. */
if (typeof module !== "undefined" && module.exports) module.exports = { qrMatrix, qrSvg };
