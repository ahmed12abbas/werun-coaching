/**
 * Concatenates app.html's <script src="js/…"> tags into one js/app.bundle.js,
 * and rewrites app.html to load that instead of the sixteen files one at a
 * time. Sixteen requests over the same connection already run in parallel,
 * but each still costs its own round of TCP/TLS bookkeeping and HTML
 * parsing pauses to discover it — one file removes that, and it is the one
 * saving available without a bundler: the project deliberately has no build
 * step (see CLAUDE.md), so this runs only against the deploy's own copy of
 * the site, never the checked-in one.
 *
 * Run against _site/ in .github/workflows/deploy.yml, after "Assemble the
 * site" has copied it there:
 *
 *   node tools/bundle-app.js _site
 *
 * The checked-in app.html and the sixteen files in js/ are untouched —
 * local dev (werun-preview, werun-api) still loads them one at a time,
 * unbundled, so editing one is a save and a reload and a stack trace names
 * the file it came from.
 *
 * Safe to concatenate: none of the sixteen are modules and none carry
 * defer/async, so they already run in one shared global scope, in document
 * order — exactly what concatenation reproduces. Each still opens with its
 * own "use strict"; a repeated directive prologue is a no-op, not an error.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const site = process.argv[2];
if (!site) {
  console.error("usage: node tools/bundle-app.js <site-dir>");
  process.exit(1);
}

const appHtmlPath = path.join(site, "app.html");
const html = fs.readFileSync(appHtmlPath, "utf8");

const TAG = /<script src="(js\/[^"?]+\.js)(?:\?v=[^"]*)?"><\/script>\n?/g;
const matches = [...html.matchAll(TAG)];
if (!matches.length) {
  console.error("no <script src=\"js/….js\"> tags found in " + appHtmlPath);
  process.exit(1);
}

const files = matches.map((m) => m[1]);
const start = matches[0].index;
const end = matches[matches.length - 1].index + matches[matches.length - 1][0].length;

const bundle = files.map((f) => fs.readFileSync(path.join(site, f), "utf8")).join("\n");

// A parse-only check: catches a bad join (a missing semicolon ASI can't
// paper over) before it ships, without executing code that expects a
// browser's window/document to exist.
try {
  new vm.Script(bundle, { filename: "app.bundle.js" });
} catch (e) {
  console.error("app.bundle.js does not parse: " + e.message);
  process.exit(1);
}

const hash = crypto.createHash("sha256").update(bundle.replace(/\r\n/g, "\n")).digest("hex").slice(0, 8);
fs.writeFileSync(path.join(site, "js", "app.bundle.js"), bundle);

const tag = '<script src="js/app.bundle.js?v=' + hash + '"></script>\n';
const updated = html.slice(0, start) + tag + html.slice(end);
fs.writeFileSync(appHtmlPath, updated);

// Re-read what was just written, the same way a browser would parse it, as
// the check that the splice landed cleanly: exactly the one bundle tag, none
// of the sixteen left behind.
const after = fs.readFileSync(appHtmlPath, "utf8");
const remaining = [...after.matchAll(TAG)].filter((m) => m[1] !== "js/app.bundle.js");
if (remaining.length || !after.includes('src="js/app.bundle.js?v=' + hash + '"')) {
  console.error("app.html was not rewritten cleanly — leaving it as-is would ship a broken page.");
  process.exit(1);
}

console.log("bundled " + files.length + " files -> js/app.bundle.js?v=" + hash + " (" + bundle.length + " bytes)");
