/**
 * Local development: the real Worker in front of the real pages, with KV and
 * D1 emulated by wrangler, the same way Pages runs them.
 *
 *   node tools/dev.js [port]        (default 4323)
 *
 * What it does
 *   1. assembles _site/ exactly as the deploy workflow does — pages, js/,
 *      assets/ and the _worker.js/ directory — and keeps it fresh: any edit
 *      under those paths is copied across, and wrangler reloads the Worker;
 *   2. applies migrations/ to the local D1 file, so the schema is always the
 *      one in the repo;
 *   3. runs `wrangler pages dev _site` with STATS (KV) and DB (D1) bound and
 *      the secrets from .dev.vars.
 *
 * State lives in .wrangler/state (gitignored). Delete it to start clean.
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "_site");
const PORT = process.argv[2] || "4323";
const PAGES = ["index.html", "admin.html", "tips.html", "app.html"];
const DIRS = ["js", "assets", "_worker.js"];
const STATE = ".wrangler/state";

function assemble() {
  fs.mkdirSync(SITE, { recursive: true });
  for (const f of PAGES) fs.copyFileSync(path.join(ROOT, f), path.join(SITE, f));
  for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(SITE, d), { recursive: true, force: true });
}

function migrate() {
  const r = spawnSync(
    "npx",
    ["--yes", "wrangler@4", "d1", "migrations", "apply", "werun-db", "--local",
     "-c", "tools/wrangler.dev.toml", "--persist-to", STATE],
    { cwd: ROOT, stdio: "inherit", shell: true }
  );
  if (r.status !== 0) {
    console.error("dev: migrations failed — fix migrations/ and try again");
    process.exit(r.status || 1);
  }
}

fs.rmSync(SITE, { recursive: true, force: true }); // start from what is in the repo
assemble();
migrate();

// One copy per burst of saves, not one per keystroke of the editor.
let pending = null;
fs.watch(ROOT, { recursive: true }, (event, file) => {
  const f = String(file || "").replace(/\\/g, "/");
  const ours = PAGES.includes(f) || DIRS.some((d) => f === d || f.startsWith(d + "/"));
  if (!ours) return;
  clearTimeout(pending);
  pending = setTimeout(() => {
    try {
      assemble();
      console.log("dev: copied " + f);
    } catch (e) {
      console.error("dev: copy failed — " + e.message);
    }
  }, 150);
});

const wrangler = spawn(
  "npx",
  ["--yes", "wrangler@4", "pages", "dev", "_site",
   "--port", PORT, "--ip", "127.0.0.1",
   "--kv", "STATS", "--d1", "DB=werun-db-local",
   "--persist-to", STATE,
   "--compatibility-date", "2026-08-01"],
  { cwd: ROOT, stdio: "inherit", shell: true }
);
wrangler.on("exit", (code) => process.exit(code || 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => wrangler.kill());
