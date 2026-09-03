/**
 * PreToolUse hook (Bash): a `git push` here is a production deploy — every
 * push to main goes live at https://weruncoaching.pages.dev with no staging
 * in between. So before one goes out:
 *
 *   1. the ?v= stamps are checked (and fixed) — stale stamps fail the deploy
 *      workflow, so a push with them is a wasted Actions run;
 *   2. the push is turned into an explicit confirmation, whatever the
 *      permission mode, with the deploy consequence spelled out.
 *
 * Anything that is not a git push passes straight through.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const PAGES = ["index.html", "admin.html", "tips.html"];

function decide(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })
  );
}

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
  const cmd = String((input.tool_input && input.tool_input.command) || "");
  if (!/\bgit\b[^\n;&|]*\bpush\b/.test(cmd)) return;

  // 1. Stamps. version-assets rewrites in place, so if it changed anything
  //    the fix is already on disk — it just is not committed yet.
  let out = "";
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, "tools", "version-assets.js")], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch (e) {
    decide("deny", "Could not run tools/version-assets.js: " + (e.stdout || e.message));
    return;
  }
  if (!/Nothing to do/.test(out)) {
    decide(
      "deny",
      "The ?v= stamps were stale and have just been rewritten — the deploy would have failed. " +
        "Commit " + PAGES.join(", ") + " and push again.\n" + out.trim()
    );
    return;
  }

  // Stamps that are correct on disk but not yet committed fail CI just the same.
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--"].concat(PAGES), { cwd: ROOT, stdio: "ignore" });
  } catch (e) {
    decide(
      "ask",
      "Pushing to main deploys to https://weruncoaching.pages.dev. Note: " + PAGES.join("/") +
        " have uncommitted changes — if those are re-stamps, commit them first or the deploy check fails."
    );
    return;
  }

  // 2. Make it deliberate.
  const force = /(^|\s)(--force|-f|--force-with-lease)(\s|$)/.test(cmd);
  decide(
    "ask",
    (force ? "FORCE push — " : "") +
      "git push to main is a production deploy to https://weruncoaching.pages.dev (no staging). Stamps are current."
  );
});
