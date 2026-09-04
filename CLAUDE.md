# WE RUN Coaching — working notes for Claude

The README is the full story; this is only what is not obvious from the code.

## What this is
A static site on Cloudflare Pages that encodes a weekly running session into a
share link, plus two small server pieces:
- `_worker.js/` — Pages advanced-mode Worker as a module directory: `index.js` routes, `lib/` shared helpers, `routes/` one file per feature. Bindings: `STATS` KV, `DB` D1, secrets `ADMIN_PASSWORD`, `TIPS_PASSWORD`, `QR_SECRET`. Schema in `migrations/`.
- `app.html` + `js/app.js` — the members' app (hash routes; `js/api.js` for fetches, `js/auth.js` for the current user). CSS is `assets/site.css` (shared with index.html) + `assets/app.css`.
- `js/qr.js` — the check-in QR code, written from the standard rather than fetched. Change nothing in it without running `node tools/qr-test.js`, which decodes what it draws.
- A code can be shown for **any** session, not only a published one: `action: "open"` on `/api/admin/sessions` finds-or-creates the `club_sessions` row for a standing slot and date. Such a row has `payload = ''` — it is a real session with a window, points and a roster, and no steps. Anything reading `payload` must expect empty (`has_steps` on the week item, `noStepsCard()` in `js/app.js`), and the steps lookup filters `payload <> ''` so a codeless session never becomes another day's workout.
- The club's eight meeting points and their map pins live in `tools/places.js`, keyed on `place_en`, so `seed-schedule.js` and `seed-sql.js` cannot drift to different corners of the same park.
- `js/scan.js` reads the coach's code with the phone's own camera (`BarcodeDetector`, no library) and hands the result to the same `#/c/` route the camera app would have followed — so check-in itself is unchanged. It follows a check-in link on this origin and nothing else. Unsupported (iOS Safari) and refused-camera both fall back to a panel saying to use the camera app.
- Check-in codes are signed with `QR_SECRET` and expire in 30 seconds (`_worker.js/lib/checkin.js`). Points are a ledger, never a stored total (`_worker.js/lib/points.js`): taking something back is another row.
- `/admin` takes either a coach's login or `ADMIN_PASSWORD` — `refuseUnlessCoach()` in `_worker.js/lib/auth.js`. The password stays because it makes the *first* coach and is the way back in if an account is lost; do not "finish the migration" by deleting it.
- New columns go behind `hasColumn()` (`_worker.js/lib/columns.js`) and new tables behind a try/catch, for the window between a deploy and its migration. Take the branch out once the migration is in. `/api/health` lists `table_names`, which is how you tell whether it has.
- **Migrations are applied by hand here** — the deploy's `wrangler d1 migrations apply` is skipped because the API token has no D1 grant (`node tools/schema-dump.js --bare --from 000N` writes the block to paste into the D1 console). So code that reads a new table must tolerate that table not existing yet: the deploy always lands before the migration does. `lib/weekplan.js` shows the shape — the new read is wrapped, logs, and falls back.
- Signup asks gender and birth year, **both optional** — a join form that refuses someone who will not say is one that loses them. Birth year rather than a date of birth: it gives the age group a race entry needs and the club has no use for the day.
- A session starts counting down 8 hours out (`countdownPill` in `js/app.js`), on one ticker for the whole screen rather than one per row.
- Every row in the week opens: a published slot goes to `#/session/<id>`, a standing one to `#/plan/<schedule_id>/<date>` — which reads `/api/week` for that week rather than adding a second way to resolve one day. A session called off stays flat.
- A standing slot's **Steps** button points at the workout published *nearest* that date, within `STEPS_DAYS` either side (`lib/weekplan.js`) — nearest, not newest, or one session published for a race two months out becomes the steps on every week between now and then. The query is bounded on `date` so it uses `club_sessions_date`; there is no index on `schedule_id`.
- `Node.append(null)` writes the word "null" onto the page — `el()` filters nulls, the browser's own `append` does not. Guard before appending, as `appendFoot()` does.
- Retiming a standing session must move the row that exists, not add one beside it: `tools/seed-sql.js` keys slot ids on `KEYED_AT` (the time a slot was minted under, not the one it starts at now) and `tools/seed-schedule.js` falls back to matching on day + place. A session already **published** carries an absolute instant that no route moves — `tools/seed-week.js` warns when one has drifted from its slot.
- The club runs on **Riyadh time, UTC+3, no daylight saving**. Standing times are wall-clock strings (`"04:55"`) and need no timezone; a published session is an absolute instant, so anything building one outside a browser in Riyadh must say `+03:00` — `tools/seed-week.js` does.
- The club's week starts **Sunday** and Friday is the rest day. The standing ten sessions live in `schedule`; a single occurrence moved or called off is a row in `schedule_changes`, never an edit to the pattern. `_worker.js/lib/weekplan.js` merges pattern → change → published session, in that order, and is the only place that decides what is on a given day.
- Athlete reads go through `withMember` (which honours the maintenance switch), account routes through `withUser` (which never does, so nobody is locked out of logging in).
- Email is optional: no `RESEND_API_KEY` and the confirm/reset routes answer `email-off` rather than pretending. `EMAIL_ECHO=1` (in `.dev.vars` only) returns the link in the response so the smoke test can follow it — never set it on Pages, and `/api/health` reports it as a warning if anyone does.
- Confirming an address is **not** a gate on anything: signups are open and mail may never be configured, so it marks the account and nothing more.
- The shop never sees a card: paying happens on Stripe's own page, and an order becomes `paid` only from a webhook whose HMAC signature and timestamp both check out (`_worker.js/lib/stripe.js`). Nothing the browser says on the way back is taken as proof.
- Prices are read from the database at checkout, never from the request, and stock comes down in the webhook rather than at checkout — a payment page that was opened and abandoned must not hold a shirt.
- `STRIPE_API_BASE` exists so `tools/smoke-store.js` can point the flow at its own stub. Like `EMAIL_ECHO` it belongs in `.dev.vars` only; `/api/health` lists both in `warnings`.
- `docs/PLATFORM-PLAN.md` — the platform plan (accounts, QR check-in, points, feed, store) and which decisions are settled.
- `worker/` — a separate Worker for the intervals.icu OAuth bridge. Different deploy, different bindings.
- `garmin-mcp/` — the coach's personal Garmin tooling. Gitignored on purpose; never commit it or reference its paths in shipped code.

No bundler, no framework, no `package.json`. Plain `"use strict"` scripts loaded in order from `index.html`; everything shares one global scope.

## Rules that CI or athletes will catch
- **Every user-facing string goes through `t("key")`** with both `en` and `ar` in `js/i18n.js`. Arabic uses the club's running vocabulary (إحماء / جري / استشفاء / تهدئة), not literal translation — copy the register already there.
- **After editing anything in `js/` or `assets/*.css`, run `node tools/version-assets.js`** and commit the re-stamped `index.html`, `admin.html`, `tips.html`. The deploy fails on stale `?v=` stamps. (A PostToolUse hook does this automatically.)
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

Run `npm install` once: the site itself still ships no dependencies — every
file in `js/` is plain unbundled JavaScript — but the tools need wrangler (the
local Worker, D1 and migrations) and two libraries the QR test uses.
`.claude/launch.json` defines `werun-preview` (static only, :4322) and `werun-api` (`node tools/dev.js` → wrangler with KV + D1 emulated, :4323 — use this for anything touching `/api`). Use `preview_start` rather than a shell server. `/api/health` shows which bindings the Worker sees.

## Tests
```
node garmin-mcp/tools/encode_cases.js garmin-mcp/tools/cases.json
uv run --project garmin-mcp python garmin-mcp/test_convert.py garmin-mcp/tools/cases.json
node .claude/skills/i18n-check/scripts/check.js
node tools/smoke.js            # accounts end to end, against tools/dev.js (needs the server up)
node tools/smoke-checkin.js    # publish, sign a code, scan it, void it
node tools/smoke-feed.js       # coach login, posts, settings, maintenance
node tools/smoke-email.js      # confirm an address, reset a password, the CSVs
node tools/smoke-store.js      # the shop, against a Stripe stub it starts itself
node tools/smoke-plan.js       # the standing week, and one occurrence moved
node tools/seed-schedule.js    # writes the club's ten standing sessions
node tools/seed-week.js        # September's wording, and this week's dated bits
node tools/qr-test.js          # js/qr.js round-tripped through a real decoder
```

## Style
Commit messages are one short plain-English sentence, like the existing history. Comments explain *why*; the code already says what.
