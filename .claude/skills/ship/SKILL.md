---
name: ship
description: Release what is on main — stamp assets, run the link/i18n checks, commit, push, and watch the Cloudflare Pages deploy through to green.
disable-model-invocation: true
---

# /ship

`git push` to `main` **is** the deploy: GitHub Actions uploads the site to
https://weruncoaching.pages.dev within a minute or two. This skill makes sure
what goes out will pass the deploy checks and that you see it land.

Arguments (optional): a commit message. If none is given, write one in the
repo's style — one short plain sentence, like the existing history.

## Steps

1. **What is going out.** `git status --short` and `git diff --stat`. Stop and
   ask if anything under `garmin-mcp/`, `.mcp.json`, or a file holding a
   token or password is staged or about to be added.

2. **Stamps.** `node tools/version-assets.js`. If it changed a page, those
   pages join the commit.

3. **Checks.** Run each; report failures verbatim and stop unless the user
   says to ship anyway.
   ```
   node .claude/skills/i18n-check/scripts/check.js
   ```
   If `garmin-mcp/` exists locally (it is gitignored, so it may not):
   ```
   node garmin-mcp/tools/encode_cases.js garmin-mcp/tools/cases.json
   uv run --project garmin-mcp python garmin-mcp/test_convert.py garmin-mcp/tools/cases.json
   ```

4. **Commit.** `git add` the intended files (not `-A`), then commit with the
   message and the session's `Co-Authored-By` trailer. If nothing changed
   since the last commit, skip to step 5.

5. **Push.** `git push origin main`. The push-gate hook will ask for
   confirmation — that is expected.

6. **Watch it land.**
   ```
   gh run list --workflow deploy.yml --limit 1
   gh run watch <id> --exit-status
   ```
   Then `curl -sI https://weruncoaching.pages.dev | head -5` for a 200.

7. **Report**: the commit hash, the run URL, pass/fail, and the live URL. If
   the deploy failed, paste the failing step's log and propose the fix — do
   not retry the push blindly.
