# WE RUN platform — the plan

*Written 2026-09-04. Decisions taken with the coach are marked ✔; everything
else is a proposal and can move.*

## What we are building

The site today does one thing: one link a week, straight to the watch. The
platform wraps a club around it — athletes get an account, see the session,
check in at the track, collect points, read the feed and the coach's tips,
and later buy merch. The coach gets one console to run all of it.

| Decided ✔ | Choice | Why it matters |
|---|---|---|
| Membership | **Fully open signup** | No invite codes or approval queue. Spam is the risk → rate-limited signup from day one, email verification in phase 4, a "signups open" kill switch in settings. |
| Sign-in | **Email + password** | Nothing outside Cloudflare. Password reset needs an email sender (Resend free tier) — phase 4. |
| Check-in | **QR code at the track** | The coach's phone shows a code that changes every 30 s; athletes scan it. Self-verifying, nothing to confirm by hand. |
| Stack | **Same site, no build step, D1** | Stays vanilla JS in the style of the current code. `_worker.js` becomes a directory of modules. D1 (SQLite) holds everything with a row; KV keeps the counters. |

**Confirmed ✔ — "training chart flow"** means two screens in the app:

1. **Weekly plan** — the current week Monday to Sunday, one card per day.
   Published sessions show name, start time, points on offer and the
   athlete's own check-in state (checked in / open now / missed / upcoming);
   other days read "easy run" or "rest" from the settings. Arrows step to
   last week and next. This is the athlete's home screen.
2. **Session detail** — tap a day and you get exactly what the link page
   gives today: the coloured timeline (warm-up / reps / recovery), the
   typed Garmin steps, COROS, the `.fit` download, the Apple Watch guide,
   the connect card, the pace calculator and the coach's tips — reusing
   `js/views.js` as it is, with a "check in" button on top when the window
   is open.

**Priority ✔ — the QR check-in is the reason for the platform.** Phase 1 is
kept to the minimum that check-in needs (an account, a name), and phase 2 is
where the effort goes.

---

## Shape of the finished thing

```
weruncoaching.pages.dev
├── /                 the link builder + athlete viewer   (unchanged)
├── /app.html         the athlete app: one page, hash routes
│     #/signup #/login #/week #/session/<id> #/c/… (check-in) #/points #/feed #/me
├── /tips.html        the coach's article editor          (unchanged, later folded into admin)
├── /admin.html       the coach console: tabs
│     stats · feedback · members · sessions & QR · points · feed · settings
└── /api/…            one Worker, one D1 database, one KV namespace
```

One Pages project, one deploy, one URL to hand out. The GitHub Pages mirror
stays what it is — static pages only, no accounts.

### Server: `_worker.js/` as a directory

Cloudflare Pages accepts `_worker.js/` as a folder with `index.js` and
modules; `wrangler pages deploy` bundles it. The 537-line file splits into:

```
_worker.js/
  index.js          router: GET table, POST table, everything else → ASSETS
  lib/http.js       json(), readBody(), preflight
  lib/crypto.js     safeEqual(), pbkdf2(), randomToken(), hmac()
  lib/limit.js      tooOften() — generalised: per-IP, per-route, KV-backed
  lib/auth.js       cookie ↔ session row ↔ user; requireUser(), requireCoach()
  routes/share.js   /api/share, /api/stats          (moved, not rewritten)
  routes/feedback.js
  routes/tips.js
  routes/auth.js    signup, login, logout, me, password change
  routes/sessions.js publish / list / this week
  routes/checkin.js QR issue + redeem
  routes/points.js  ledger, leaderboard, my points
  routes/feed.js    posts
  routes/admin.js   members, settings, voids, adjustments
```

Existing behaviour moves across unchanged first (phase 0), so `/api/share`,
feedback and tips keep working while the rest is built beside them.

### Auth, concretely

- **Password**: PBKDF2-SHA256, 100 000 iterations, 16-byte per-user salt, via
  WebCrypto. Stored as `pass_salt`, `pass_hash`. Never logged, never returned.
- **Session**: 32 random bytes → cookie `werun_s` (`HttpOnly; Secure;
  SameSite=Lax; Path=/; Max-Age=90d`). Only the SHA-256 of the token is
  stored, so a database read-out does not hand out live sessions. Logout
  deletes the row; "log out everywhere" deletes all rows for the user.
- **Roles**: `athlete` | `coach`. The first coach is promoted by a one-off
  `wrangler d1 execute` — there is no "become coach" endpoint.
- **Admin page**: keeps `ADMIN_PASSWORD` through phases 0–2 so nothing
  breaks; in phase 3 it switches to "logged in as a coach" and the password
  secret retires.
- **Rate limits** (KV, same pattern as `tooOften`): signup 3/hour/IP, login
  10/minute/IP + 20/hour/email, check-in 10/minute/user.

### The QR check-in

```
coach: admin → Sessions & QR → "Tonight: Monday | WeRUN" → Show code
       screen renders a QR of
         https://weruncoaching.pages.dev/app.html#/c/<session>/<slot>/<sig>
       slot = floor(now / 30 s), sig = HMAC-SHA256(QR_SECRET, session:slot)[0..16]
       redraws every 30 s; big, high-contrast, works on a phone held up

athlete: phone camera → link opens the app
         logged in?  → POST /api/checkin {session, slot, sig}
         not yet?    → login/signup, the pending check-in survives in sessionStorage

worker: sig valid · slot within ±1 (90 s of grace) · session's window open
        · no check-in yet for (session, user)  →  insert checkin,
        insert points_ledger(+N), return {points, total, streak}
```

Why this holds up: a screenshot sent to the group is stale in 30 seconds; the
window (default 30 min before to 45 min after start, per settings) stops
check-ins from home; one row per athlete per session is a database
constraint, not a UI rule; the coach can void any check-in and the ledger
row reverses with it. No location permission, no camera permission for the
athlete (the OS camera does the scan).

### Data (D1)

```sql
users          id, email UNIQUE, name, pass_salt, pass_hash, role, lang,
               status ('active'|'blocked'), email_verified_at, created_at, last_seen_at
sessions       token_hash PK, user_id, created_at, expires_at, ua
club_sessions  id, date, day, name, payload (the share-link payload), starts_at,
               window_open_at, window_close_at, points, published_by, created_at
checkins       id, session_id, user_id, at, method, voided_at, voided_by
               UNIQUE(session_id, user_id)
points_ledger  id, user_id, delta, reason ('checkin'|'streak'|'adjust'|'void'),
               ref_id, note, at
posts          id, title_en, title_ar, body_en, body_ar, pinned, published_at,
               author_id, created_at, updated_at
settings       key PK, value (JSON), updated_at
```

Points = `SUM(delta)` per user, streaks computed from `checkins` on the fly
(the club is small; no need to cache). Migrations live in `migrations/` as
numbered SQL files and are applied by the deploy workflow.

Tips stay in KV for now (the editor works and the coach knows it); they show
in the feed by reading the same doc. Migrating them into `posts` is phase 3
housekeeping, not a prerequisite.

### Client

Same idioms as today — `el()`, `t()`, one global scope, scripts in order,
`?v=` stamps (the hook handles those):

```
js/api.js        fetch wrapper: JSON, credentials, one place for error → toast
js/auth.js       current user cache, login/signup/logout, guards for routes
js/app.js        hash router + the screens (split into js/app-*.js as it grows)
js/qr.js         QR renderer for the coach's screen (a small self-contained encoder,
                 like fit.js is for FIT — no CDN)
```

`app.html` loads config, i18n, brand, model, sfx, tipfmt, tips, pace, views,
then api, auth, app. The pace calculator and the tips cloud work in the app
exactly as on the link page.

### Admin settings the coach can change without a deploy

| Setting | Default |
|---|---|
| Points per check-in | 10 |
| Streak bonus (every N consecutive sessions → +M) | 4 → +5 |
| Check-in window (before / after start) | 30 / 45 min |
| Signups open | yes |
| Announcement banner (en/ar) | empty |
| Club name, WhatsApp group link | WE RUN, — |
| Maintenance mode (athletes see a message, coach still in) | off |

Stored as rows in `settings`, read once per request, cached in the Worker
isolate for 60 s.

---

## Phases

Each phase ships on its own and leaves the site working. Order matters:
accounts before check-ins, check-ins before points, points before the feed
only because the feed is the easy one and the QR is the risky one.

### Phase 0 — foundations  ✔ **done 2026-09-04**
- Root `wrangler.toml` for the Pages project: `pages_build_output_dir = "_site"`, the `STATS` KV binding, a new `DB` D1 binding. Bindings then come from config, not the dashboard PATCH — `bindings.yml` becomes the way to create the D1 database and set secrets, and stops patching bindings.
- `migrations/0001_init.sql` + a deploy step: `wrangler d1 migrations apply werun-db --remote` before `pages deploy`.
- Split `_worker.js` into `_worker.js/`; deploy copies the directory. Behaviour identical — verified by hitting `/api/share`, `/api/tips`, `/api/stats` before and after.
- Local dev switches to `npx wrangler pages dev _site` (D1 + KV emulated, `.dev.vars` for secrets) and `launch.json` points at it, replacing the scratchpad API server.
- New secret: `QR_SECRET`.
- `security-reviewer` runs on the split.

### Phase 1 — accounts  ✔ **done 2026-09-04**
- `POST /api/auth/signup | login | logout`, `GET /api/auth/me`, `POST /api/auth/password`.
- `app.html` with signup, login, the weekly plan (reads `club_sessions`, empty days from settings), session detail (reusing the viewer), me (name, language, password, log out everywhere).
- Rate limits and the "signups open" switch.
- Admin: **Members** tab (list, search, block/unblock, make coach).
- Done when: two phones can sign up, log in, and see each other in Members.

### Phase 2 — sessions, QR, points  ✔ **done 2026-09-04**
- Builder gets **Publish to the club**: date, start time, points → `club_sessions` row with the link payload. The link itself is unchanged — publishing is in addition to it.
- Admin: **Sessions & QR** tab — this week's list, the live QR screen, who has checked in, void.
- `GET /api/qr` (coach), `POST /api/checkin` (athlete), `GET /api/points/me`, `GET /api/points/board`.
- App: check-in landing, the week view lights up with check-in state, points screen (total, streak, history), leaderboard (opt-out per athlete for the shy).
- Done when: a check-in from a scanned code lands points, a screenshot from 2 minutes ago is refused, and a void takes the points back.

### Phase 3 — feed and console  ✔ **done 2026-09-04**
- `posts` CRUD in admin (**Feed** tab; bilingual fields, pin, schedule), `GET /api/feed` in the app with tips merged in.
- Admin takes a coach login **or** the club password. The password did *not* retire: it is what makes the first coach (there is nobody to promote otherwise) and the only way back if an account is lost. `tips.html` stays where it is, linked from the console — the feed and the tips are different features, and moving a working editor for tidiness was not worth the risk.
- Settings tab with the table above.

### Phase 4 — trust  ✔ **done 2026-09-04** (push deferred)
- Email via Resend: verification on signup, password reset, "you earned N points" optional weekly summary.
- Web Push for "session published" — **not built**. It needs a VAPID key pair, a service worker and a subscriptions table, and none of it can be exercised until the site is on a phone the club actually uses. The plan always had it as "later"; it stays there. A weekly points summary is in the same position: it needs a scheduled Worker, which Pages Functions cannot run, so it would be a second deploy to look after before email is even switched on.
- Export: members and points as CSV from admin.

### Phase 5 — merch (when wanted)
- `products`, `orders` tables; **Stripe Checkout** (hosted page — card data never touches the Worker), webhook with signature check → order row; admin sees orders and marks them handed over at the track.
- Payouts, tax and shipping are Stripe's problem; the store starts as "pay online, collect on Monday".

---

## Things to watch

- **Open signup + points** — points only come from a QR at the track, so a fake account earns nothing. The real cost is noise in Members; the rate limit and phase-4 verification handle it.
- **Worker CPU**: PBKDF2 at 100k iterations is ~20–40 ms on Workers; fine, but keep it to login/signup and never in a loop.
- **D1 is one region**: reads are fast enough for a club; nothing here needs replication.
- **`_worker.js/` needs bundling**: the deploy already runs through wrangler-action, so this is free; hand-testing needs `wrangler pages dev`, not the plain static server.
- **Old links keep working**: nothing in this plan touches the payload format. Publishing stores the same payload the link carries.
- **Free plan limits**: 100k requests/day, D1 5M reads/day — a club of a few hundred is nowhere near them.

## Working method

`/ship` for every release, `security-reviewer` before any Worker route
lands, `bilingual-ui-reviewer` after any screen changes, `/i18n-check` in
the ship path. The `feature-dev` plugin's explorer/architect pair is worth
running at the start of phases 2 and 3, where the new code meets the most
existing code.
