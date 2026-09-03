/**
 * Stamps each <script src="js/…"> and <link href="assets/…css"> with a ?v= content hash.
 *
 * Both hosts serve the js files with a ten-minute max-age and no way to purge:
 * GitHub Pages sends `Cache-Control: max-age=600` and Cloudflare Pages caches
 * on its own. Without a version in the URL a returning visitor can end up
 * running yesterday's javascript against today's html — which is exactly what
 * happened when the COROS box went live and the picker kept rendering two.
 *
 * The hash is of the file's own bytes, so the query only changes when the file
 * does and unchanged files stay cached. Run this after editing anything in js/
 * and before committing:
 *
 *   node tools/version-assets.js
 *
 * It rewrites the pages in place and prints what moved. Safe to run twice.
 *
 * All three pages are covered, not just index.html: admin.html and tips.html
 * are otherwise standalone, but both now load js/tipfmt.js, and a stale copy
 * of the formatting rules there would quietly disagree with what athletes see.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const PAGES = ["index.html", "admin.html", "tips.html", "app.html"];

// Matches src="js/anything.js" and stylesheet href="assets/anything.css", with
// or without a version already on it, so a second run replaces the old stamp
// rather than stacking another one.
const TAG = /(<script\s+src="|<link\s+rel="stylesheet"\s+href=")((?:js|assets)\/[^"?]+\.(?:js|css))(\?v=[^"]*)?(")/g;

let touched = false;

for (const name of PAGES) {
  const page = path.join(root, name);
  if (!fs.existsSync(page)) {
    console.warn("skipped " + name + " — no such file");
    continue;
  }

  const html = fs.readFileSync(page, "utf8");
  const changes = [];

  const updated = html.replace(TAG, (whole, open, src, oldQuery, close) => {
    const file = path.join(root, src);
    if (!fs.existsSync(file)) {
      console.warn("skipped " + src + " — no such file");
      return whole;
    }
    // Hash the LF form, not the bytes on disk. core.autocrlf hands Windows a
    // CRLF working copy while the repo and the Linux runner both hold LF, and
    // a raw byte hash would differ per machine — failing the deploy check on
    // every run and reshuffling the stamps for no reason.
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 8);
    const was = oldQuery ? oldQuery.slice(3) : "none";
    if (was !== hash) changes.push(src + ": " + was + " -> " + hash);
    return open + src + "?v=" + hash + close;
  });

  if (updated === html) {
    console.log(name + " already up to date.");
  } else {
    fs.writeFileSync(page, updated);
    touched = true;
    console.log(name + " stamped:");
    for (const line of changes) console.log("  " + line);
  }
}

if (!touched) console.log("Nothing to do.");
