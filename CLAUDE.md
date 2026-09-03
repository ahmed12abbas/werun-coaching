# WE RUN Coaching — working notes for Claude

The README is the full story; this is only what is not obvious from the code.

## What this is
A static site on Cloudflare Pages that encodes a weekly running session into a
share link, plus two small server pieces:
- `_worker.js/` — Pages advanced-mode Worker as a module directory: `index.js` routes, `lib/` shared helpers, `routes/` one file per feature. Bindings: `STATS` KV, `DB` D1, secrets `ADMIN_PASSWORD`, `TIPS_PASSWORD`, `QR_SECRET`. Schema in `migrations/`.
- `docs/PLATFORM-PLAN.md` — the platform plan (accounts, QR check-in, points, feed, store) and which decisions are settled.
- `worker/` — a separate Worker for the intervals.icu OAuth bridge. Different deploy, different bindings.
- `garmin-mcp/` — the coach's personal Garmin tooling. Gitignored on purpose; never commit it or reference its paths in shipped code.

No bundler, no framework, no `package.json`. Plain `"use strict"` scripts loaded in order from `index.html`; everything shares one global scope.

## Rules that CI or athletes will catch
- **Every user-facing string goes through `t("key")`** with both `en` and `ar` in `js/i18n.js`. Arabic uses the club's running vocabulary (إحماء / جري / استشفاء / تهدئة), not literal translation — copy the register already there.
- **After editing anything in `js/`, run `node tools/version-assets.js`** and commit the re-stamped `index.html`, `admin.html`, `tips.html`. The deploy fails on stale `?v=` stamps. (A PostToolUse hook does this automatically.)
- **`git push` to `main` is a production deploy** to https://weruncoaching.pages.dev. There is no staging.
- Layout must work RTL: icons drawn in profile are mirrored per `PACE_SPRITES`; check both directions.
- Respect `prefers-reduced-motion` for anything that moves.
- Old share links must keep decoding forever — changes to the link format in `js/model.js` need a decoder for the old version, and fixtures regenerated with `garmin-mcp/tools/encode_cases.js`.

## Server-side conventions (`_worker.js`)
- Passwords travel in a POST body, never a URL; compare with `safeEqual`.
- Everything a visitor can write has a hard cap (`FB_MAX`, `TIP_MAX`) and a per-IP rate limit — KV values must not be able to grow without bound.
- Missing bindings degrade, they don't crash: no KV → sharing is uncounted; no password → admin stays locked.
- Secrets are set with `wrangler secret put` / repo secrets, never in `[vars]` or committed files.

## Local preview
`.claude/launch.json` defines `werun-preview` (static only, :4322) and `werun-api` (`node tools/dev.js` → wrangler with KV + D1 emulated, :4323 — use this for anything touching `/api`). Use `preview_start` rather than a shell server. `/api/health` shows which bindings the Worker sees.

## Tests
```
node garmin-mcp/tools/encode_cases.js garmin-mcp/tools/cases.json
uv run --project garmin-mcp python garmin-mcp/test_convert.py garmin-mcp/tools/cases.json
node .claude/skills/i18n-check/scripts/check.js
```

## Style
Commit messages are one short plain-English sentence, like the existing history. Comments explain *why*; the code already says what.
