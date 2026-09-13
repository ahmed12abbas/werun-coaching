---
name: cleanup-audit
description: Whole-codebase maintainability review as a senior engineer — dead code, duplicate logic, unused UI, over-complex code, legacy leftovers, redundant queries/API calls, abandoned files — with impact, risk and a cleanup plan for each. Report only; changes nothing.
disable-model-invocation: true
---

# /cleanup-audit

Act as a senior software engineer performing a code quality and
maintainability review. Analyze the **entire** codebase, not a diff.

Arguments (optional): a path or area to limit the review to.

## Find

1. **Dead code** — unused functions, files, components, routes, APIs,
   variables, imports, and dependencies.
2. **Duplicate logic** that should be consolidated.
3. **Unused UI components.**
4. **Overly complex implementations** that can be simplified.
5. **Legacy code** that is no longer needed.
6. **Redundant database queries or API calls.**
7. **Files that appear abandoned** or disconnected from the application.
8. **Opportunities to reduce technical debt.**

Be aggressive but safe. The goal is to simplify the codebase, improve
maintainability, and remove anything that does not provide value.

## How to prove something is dead

There is no bundler: every `js/` script shares one global scope and is
loaded by `<script>` tags, so "unused" means **no reference anywhere** —
grep the name across `*.html`, `js/`, `_worker.js/`, `tools/`, `sw.js`,
`.github/` and `.claude/` before calling it dead. Check the reverse too:
a route in `_worker.js/routes/` is only dead if no page, script, tool,
smoke test or workflow calls its path. Dynamic uses (`t("key")` built from
a string, `SCREENS[name]`, hash routes, `data-*` lookups) count as uses.

## Looks dead, is not — do not propose removing

- Old share-link decoders in `js/model.js` — old links must decode forever.
- `hasColumn()` / try-catch fallbacks for tables — they cover the window
  between a deploy and its hand-applied migration. Only propose removing
  one after confirming the migration is in (`/api/health` → `table_names`).
- `ADMIN_PASSWORD` login paths — the way back in if an account is lost.
- `window_open_at`/`window_close_at` columns — still written on purpose.
- The `AVATARS` list duplicated in `_worker.js/routes/auth.js`, and other
  copies CLAUDE.md explains (no bundler to share one).
- `js/vendor/`, `sw.js`, `tools/` scripts run by hand or by workflows.
- `garmin-mcp/` — gitignored personal tooling; out of scope.

If CLAUDE.md or a code comment gives a reason for something odd, that is
not a finding unless the reason no longer holds — say which.

## For each issue

- **What / where** — `file:line`.
- **Why it is unnecessary** — the evidence (grep result, caller count).
- **Impact of removing it** — lines/files gone, bytes shipped, queries saved.
- **Risks before deletion** — who might still call it, migrations, old
  links, cached service-worker assets, production data.
- **Cleanup plan** — the concrete steps, and the check that proves it
  (`node tools/smoke-*.js`, `node tools/qr-test.js`, i18n check).

## Report

Group by the eight categories, rank within each by value ÷ risk, and end
with a short ordered cleanup plan: safe deletions first, consolidations
next, anything touching the schema or the link format last. Mark each
finding **confirmed** (grep-proven) or **suspected**. Change no files —
the user picks what to act on.
