/**
 * PostToolUse hook (Edit|Write): re-stamp the ?v= cache-busters whenever a
 * file under js/ or a stylesheet under assets/ changes, so index/admin/tips.html never go out stale — the
 * deploy workflow rejects them if they do.
 *
 * Reads the hook payload from stdin; does nothing for files outside js/.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch (e) {
    return;
  }
  const file = String((input.tool_input && input.tool_input.file_path) || "").replace(/\\/g, "/");
  if (!/\/(js\/[^/]+\.js|assets\/[^/]+\.css)$/.test(file)) return;

  let out = "";
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, "tools", "version-assets.js")], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch (e) {
    process.stderr.write("version-assets failed: " + (e.stdout || e.message) + "\n");
    return;
  }
  if (!/Nothing to do/.test(out)) {
    process.stdout.write(
      "Re-stamped script tags after editing " + path.basename(file) + ":\n" + out.trim() + "\n"
    );
  }
});
