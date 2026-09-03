/**
 * i18n-check — see ../SKILL.md.
 *
 * Loads js/i18n.js for real (in a vm sandbox) so the tables are the actual
 * ones, then scans the other scripts and pages for how they are used.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

/* ---------- load the tables ---------------------------------------------- */

function loadStrings() {
  const src = fs.readFileSync(path.join(ROOT, "js", "i18n.js"), "utf8");
  const noop = () => {};
  const media = () => ({ matches: false, addEventListener: noop, addListener: noop });
  const sandbox = {
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: { language: "en" },
    document: {
      documentElement: {
        setAttribute: noop,
        getAttribute: () => null,
        classList: { add: noop, remove: noop, toggle: noop },
      },
    },
    window: { matchMedia: media },
    matchMedia: media,
    console,
    __out: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    src +
      "\n;__out.STRINGS = STRINGS;" +
      "__out.KIND_LABELS = typeof KIND_LABELS === 'undefined' ? null : KIND_LABELS;",
    sandbox,
    { filename: "js/i18n.js" }
  );
  return sandbox.__out;
}

/* ---------- scan sources ------------------------------------------------- */

function sourceFiles() {
  const js = fs
    .readdirSync(path.join(ROOT, "js"))
    .filter((f) => f.endsWith(".js") && f !== "i18n.js")
    .map((f) => path.join(ROOT, "js", f));
  const html = ["index.html", "admin.html", "tips.html"]
    .map((f) => path.join(ROOT, f))
    .filter(fs.existsSync);
  return js.concat(html);
}

function lineOf(text, idx) {
  return text.slice(0, idx).split("\n").length;
}

const T_CALL = /\bt\(\s*"([A-Za-z0-9_.-]+)"/g;

// Assignments and calls that put a literal into something a person reads.
const RAW_TEXT = [
  /\.(textContent|innerText|placeholder|title|ariaLabel)\s*=\s*"([^"\n]*)"/g,
  /\.setAttribute\(\s*"(aria-label|title|placeholder|alt)"\s*,\s*"([^"\n]*)"/g,
  /\b(alert|confirm|prompt)\(\s*"([^"\n]*)"/g,
];
// A literal is suspect if it holds a word of three or more letters (Latin or
// Arabic). "", "—", "0:00", a colour, or a single glyph are fine.
const LOOKS_LIKE_WORDS = /[A-Za-z؀-ۿ]{3,}/;

/* ---------- run ---------------------------------------------------------- */

const { STRINGS, KIND_LABELS } = loadStrings();
const en = STRINGS.en || {};
const ar = STRINGS.ar || {};
const skip = new Set(["dir"]);

const problems = { missingAr: [], missingEn: [], unknown: [], placeholders: [] };
const warnings = [];

for (const k of Object.keys(en)) if (!skip.has(k) && !(k in ar)) problems.missingAr.push(k);
for (const k of Object.keys(ar)) if (!skip.has(k) && !(k in en)) problems.missingEn.push(k);

const vars = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(" ");
for (const k of Object.keys(en)) {
  if (k in ar && vars(en[k]) !== vars(ar[k])) {
    problems.placeholders.push(
      k + ": en " + (vars(en[k]) || "(none)") + " / ar " + (vars(ar[k]) || "(none)")
    );
  }
}
if (KIND_LABELS) {
  for (const k of Object.keys(KIND_LABELS.en || {})) {
    if (!(k in (KIND_LABELS.ar || {}))) problems.missingAr.push("KIND_LABELS." + k);
  }
}

const unknown = new Map(); // key -> first location
for (const file of sourceFiles()) {
  const text = fs.readFileSync(file, "utf8");
  let m;
  T_CALL.lastIndex = 0;
  while ((m = T_CALL.exec(text))) {
    if (!(m[1] in en) && !unknown.has(m[1])) {
      unknown.set(m[1], rel(file) + ":" + lineOf(text, m.index));
    }
  }
  for (const re of RAW_TEXT) {
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (LOOKS_LIKE_WORDS.test(m[2])) {
        warnings.push(rel(file) + ":" + lineOf(text, m.index) + "  " + m[0].trim().slice(0, 90));
      }
    }
  }
}
for (const [k, where] of unknown) problems.unknown.push(k + "  (" + where + ")");

/* ---------- report ------------------------------------------------------- */

function section(title, items) {
  if (!items.length) return;
  console.log("\n" + title + " (" + items.length + ")");
  for (const it of items) console.log("  " + it);
}

console.log(
  "i18n-check: " + Object.keys(en).length + " en keys, " + Object.keys(ar).length + " ar keys"
);
section("Missing in ar", problems.missingAr);
section("Missing in en", problems.missingEn);
section("Unknown key passed to t()", problems.unknown);
section("Placeholder mismatch", problems.placeholders);
section("Possible hard-coded text (review, not necessarily wrong)", warnings);

const hard =
  problems.missingAr.length +
  problems.missingEn.length +
  problems.unknown.length +
  problems.placeholders.length;
if (hard) {
  console.log("\n" + hard + " problem(s).");
  process.exit(1);
}
console.log(
  warnings.length ? "\nTables consistent; " + warnings.length + " literal(s) to review." : "\nAll good."
);
