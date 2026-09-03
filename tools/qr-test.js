/**
 * Checks js/qr.js by decoding what it draws.
 *
 *   npm i --no-save jsqr && node tools/qr-test.js
 *
 * The encoder is written from the standard rather than taken from a library,
 * so "it looks like a QR code" is not evidence. This renders each matrix to a
 * bitmap and hands it to a real decoder; a round trip that comes back with
 * the same string is the only proof worth having.
 *
 * jsqr is a dev dependency and never ships: the site loads no third-party
 * script at all.
 */
const path = require("path");
const { qrMatrix, qrSvg } = require(path.join(__dirname, "..", "js", "qr.js"));

let jsQR;
try {
  jsQR = require("jsqr");
  if (jsQR.default) jsQR = jsQR.default;
} catch (e) {
  console.error("qr-test needs jsqr:  npm i --no-save jsqr");
  process.exit(2);
}

/** Modules -> RGBA pixels, `scale` pixels per module, with a quiet zone. */
function bitmap(grid, scale) {
  const size = grid.length;
  const quiet = 4;
  const span = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(span * span * 4).fill(255);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = ((r + quiet) * scale + y) * span + ((c + quiet) * scale + x);
          data[px * 4] = 0;
          data[px * 4 + 1] = 0;
          data[px * 4 + 2] = 0;
        }
      }
    }
  }
  return { data, width: span, height: span };
}

const CASES = [
  ["short", "hello"],
  ["a real check-in link", "https://weruncoaching.pages.dev/app.html#/c/6f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f607/58612345/a1b2c3d4e5f60718"],
  ["the same at level L", "https://weruncoaching.pages.dev/app.html#/c/6f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f607/58612345/a1b2c3d4e5f60718", "L"],
  ["arabic", "الاثنين | وي رَن — سجل حضورك"],
  ["a long one", "https://weruncoaching.pages.dev/app.html#/c/" + "x".repeat(120)],
  ["one character", "1"],
  ["digits", "1234567890".repeat(8)],
];

let failures = 0;
for (const [name, text, level] of CASES) {
  let got = null;
  let matrix = null;
  try {
    matrix = qrMatrix(text, level);
    const img = bitmap(matrix, 4);
    const found = jsQR(img.data, img.width, img.height);
    got = found && found.data;
  } catch (e) {
    got = "threw: " + e.message;
  }
  const ok = got === text;
  if (!ok) failures++;
  console.log(
    (ok ? "PASS " : "FAIL ") + name +
      (matrix ? "  (" + matrix.length + "x" + matrix.length + ")" : "") +
      (ok ? "" : "\n  wanted: " + text + "\n  got:    " + got)
  );
}

// Anything past version 10 must say so rather than draw something wrong.
try {
  qrMatrix("x".repeat(400));
  console.log("FAIL too-long input was not refused");
  failures++;
} catch (e) {
  console.log("PASS too-long input is refused: " + e.message);
}

// And the svg wrapper produces something a browser will take.
const svg = qrSvg("https://weruncoaching.pages.dev/app.html#/c/abc/1/2");
const svgOk = svg.startsWith("<svg") && svg.includes("viewBox") && svg.endsWith("</svg>");
console.log((svgOk ? "PASS " : "FAIL ") + "qrSvg returns an svg element (" + svg.length + " chars)");
if (!svgOk) failures++;

console.log(failures ? "\n" + failures + " failure(s)." : "\nAll passed.");
process.exit(failures ? 1 : 0);
