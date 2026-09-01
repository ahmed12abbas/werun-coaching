/**
 * Stamps each <script src="js/…"> in index.html with a ?v= content hash.
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
 * It rewrites index.html in place and prints what moved. Safe to run twice.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const page = path.join(root, "index.html");

const html = fs.readFileSync(page, "utf8");
const changes = [];

// Matches src="js/anything.js" with or without a version already on it, so a
// second run replaces the old stamp rather than stacking another one.
const updated = html.replace(
  /(<script\s+src=")(js\/[^"?]+\.js)(\?v=[^"]*)?(")/g,
  (whole, open, src, oldQuery, close) => {
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
  }
);

if (updated === html) {
  console.log("index.html already up to date.");
} else {
  fs.writeFileSync(page, updated);
  console.log("index.html stamped:");
  for (const line of changes) console.log("  " + line);
}
