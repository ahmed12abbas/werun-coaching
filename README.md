# WE RUN Coaching

**Live: <https://weruncoaching.pages.dev>** — this is the link to hand out.
Older mirror: <https://werun.pages.dev> (a different Cloudflare account; only updates by hand).
Mirror on GitHub Pages: <https://ahmed12abbas.github.io/werun-coaching/>
(static only — the share counter and `/admin` need Cloudflare, so they work on
the Pages URL above and nowhere else).

One link per week's session. The coach builds it, pastes it in the group chat, and
anyone who opens it gets it onto their Garmin or Apple Watch — with a one-tap
"send it to my watch" for athletes who connect once.

The session is encoded into the link itself, so there is no database and old links
keep working forever. English and Arabic, light and dark, chosen from the header
and remembered per device.

---

## How a session actually reaches a watch

This is the part everyone gets wrong, so it's worth being blunt.

| | Can a web page push a workout to it? |
|---|---|
| **Garmin** | Not directly. Garmin Connect has no "import from link" and no workout-share link, and its upload button takes *completed activities*, not planned *workouts*. Garmin's own developer programme — the Training API that could do this — **is closed to new applicants**. |
| **Apple Watch** | No. Not from us, not from anyone. The Workout app builds custom sessions on the watch itself (watchOS 9+) and there is no import path. |

What *does* work for Garmin is going through **[intervals.icu](https://intervals.icu)**:
it's free, it's an official Garmin partner, and once an athlete links their Garmin
account there it uploads their planned workouts into Garmin Connect, which syncs to
the watch.

So the one-tap chain is:

```
athlete taps Connect
  → intervals.icu asks them to approve WE RUN      ← this is the permission step
  → our Cloudflare Worker stores the access token   (never the browser)
  → we POST the session onto their intervals.icu calendar
  → intervals.icu pushes it into Garmin Connect
  → it's on the watch at the next sync
```

Athletes approve on intervals.icu's own page. WE RUN never sees a Garmin or
intervals.icu password, and the token only grants `CALENDAR:WRITE`.

### What every athlete gets, with no account at all

The connect button is a bonus, not the product. Without it the page still gives:

| Route | Friction | Works for |
|---|---|---|
| **Typed into Garmin Connect** | ~1 min, every number pre-computed | everyone |
| **`.fit` over USB** | download, drag onto the watch | anyone with a computer + cable |
| **Apple Watch, guided** | taps in the Workout app, saved for reuse | watchOS 9+ |
| **Plain text** | copy/paste | the group chat, notes |

---

## Weekly workflow

1. Open the site with no `#` on the end — that's the **builder**. It opens on
   **Monday | WeRUN**.
2. Pick the day under **Standing sessions**. Once you edit anything the picker
   lets go, and swapping back asks first so a session is never lost to a stray tap.
3. Adjust name, date, note and steps. **Add repeat set** handles the reps.
4. **Copy link**, paste into WhatsApp.
5. Next week, open the plain URL again. Links you already sent keep working.

Links run roughly 250–450 characters — fine for WhatsApp, Telegram, SMS.

### The standing sessions

| Day | Session |
|---|---|
| **Monday** | 15 min warm up, drills, 12 x 500 m at 5 K pace with 2 min rest, 15 min cool down |
| **Thursday** | Hill repeats — 12 x 200 m, jog back down, everything but the reps on the lap button |

They live in `SESSIONS` at the top of `js/model.js`. Adding a day is a builder
function and one line in that list; the picker, the i18n labels and the swap
prompt all follow from it.

### The pace calculator

Next to the session title, athletes get **Pace calculator**: they spin a
mm:ss roller to either their best mile time or their best 5 K time and it gives
back 5 K, 10 K, tempo, half, marathon and recovery pace. Switching between the
two keeps their effort — the chart already knows what a 9:30 mile is worth over
5 K. What they set is remembered on their phone, so it is waiting in the roller
next time — but the card always opens folded away, because the session is what
the link is for and the calculator is a detour off it. While it is folded away a
glow laps the button's rim to say there is something there; it stops once the
panel is open. That is an oversized conic gradient spinning behind the button
with the middle covered back over, so only the edge of it shows.

The roller is a scroll-snapping column, which is the one picker that works the
same with a thumb, a wheel and the arrow keys. Item height lives in three
places — `.roll li`, the `ul` padding either side of it, and `ROLL_ITEM` in
`js/pace.js`. They are one number: change it in all three or the snap drifts.

Underneath it something runs: a road that scrolls under a sprite, so the loop
never seams. The sprite bobs, and surges forward and back along the middle of
the track with the speed lines riding behind it. All three speeds come off the
chart row — a 5:00 mile runs about three and a half times quicker than a 12:00
one — and the sprite itself steps up a ladder (`PACE_SPRITES`), keyed on the
5 K because that is the time the club quotes at each other:

| 5 K | |
|---|---|
| under 19:00 | 🏎️ |
| under 21:00 | 🐆 |
| under 23:00 | 🐎 |
| under 25:00 | 🐇 |
| 25:00 and over | 🏃‍♂️ 🏃‍♀️ |

From 25 minutes on — which is most of the group — it is two runners rather than
one, racing each other: they jostle past each other and bob out of phase, so
neither stays in front. The rungs above it are for the sharp end.

Emoji are drawn in profile facing **left** — the car, the animals and the
runners alike — so the track mirrors all of them to run forwards, and flips that
again for Arabic. That is what the third value in each `PACE_SPRITES` row is:
`-1` means "mirror this one". It is `-1` for everything in the ladder today, and
it stays a per-glyph field because a glyph's orientation is the one thing about
these that cannot be worked out from the page — check it at a large size before
adding a rung, not at 27px. The whole thing holds still for anyone who has asked
for reduced motion.

The numbers are the club's printed chart, not a formula — it lives as
`PACE_PRINTED` at the top of `js/pace.js`, one row per mile time, written in
`mm:ss` exactly as the chart reads. Times between two rows are interpolated.
Paces are stored per kilometre and shown per mile when the session is in miles.

The printed chart runs 5:00 to 12:00 for the mile — a 17:05 to 39:20 5 K — which
leaves out both the front of the club and everyone still working up to their
first hour. `extendChart()` carries each column on past either end at the
average gradient it holds across the printed rows, anchored on the end row so
there is no step at the seam, giving a chart from a 4:00 mile to a 20:00 one.
**The printed rows themselves are never touched**, and anything outside them
says so on the card rather than passing itself off as the coach's number.

One wrinkle worth knowing if you edit the chart: recovery climbs more gently
across the printed rows than marathon does, so carried far enough the two swap
over and the chart starts claiming an easy run is harder than race pace. The
extension holds each column's slope to at least the one before it, which keeps
the fastest-to-slowest order however far it runs.

The rollers offer 4–19 minutes for a mile and 16–60 for a 5 K. Those are the
same span of running seen from either end, so switching between them always
lands somewhere the other roller can hold.

To change the chart, edit those rows. Keep every column increasing down the
page — the 5 K column is read backwards to turn a 5 K time into a mile time,
which only works while it is in order.

### Step fields

| Field | Notes |
|---|---|
| **Type** | Warm Up / Run / Recover / Cool Down / Rest / Other — Garmin's own vocabulary |
| **Ends on** | Distance, Time, or **Lap button** (Garmin's "Lap Button Press") |
| **Est. length** | Lap-button steps only. A planning hint — it does *not* end the step |
| **Target** | Pace range, heart-rate range, or none |
| **Step name** | What shows on the watch face during the step |
| **Note** | Free text — "ABC drills", "@mile pace". Rides along in the `.fit` file too |

---

## Counting shares

`/admin` on the live site shows how many times athletes tapped **Share this
session**, week by week, split by the day the session is named after:

| | Mon | Thu | Total |
|---|---|---|---|
| **2026-W36** *from 2026-08-31* | 14 | 9 | 23 |
| **2026-W35** *from 2026-08-24* | 11 | 12 | 23 |

Weeks are ISO weeks, so they start on Monday and a week's Monday and Thursday
sessions land on the same row. The day comes from the session's *name* — a
session called `Thursday | WeRUN` counts as Thursday, in English or Arabic —
so renaming a session changes which column it lands in, and a name with no day
in it is counted under **Other**.

Underneath the counts the same page shows **Coach Tips read-only**: every
article, both languages, which one is live, newest state at a glance. It is a
viewer, not an editor -- writing still happens at `/tips`.

The club password (`ADMIN_PASSWORD`) opens the tips routes as well as this one,
so the dashboard can show the articles without the coach password being copied
into a second page. It does not work the other way round: `TIPS_PASSWORD` opens
`/tips` only, never the share counts.

It counts taps, not people: the same athlete tapping twice counts twice.
Nothing else is recorded — no IP, no identity, not even which session — so
there is nothing in the store worth protecting.

`_worker.js` is the server side. Pages treats that filename as reserved and
runs it in front of the static files instead of serving it, which is what keeps
the password check off the wire. It answers two routes:

| Route | |
|---|---|
| `POST /api/share` | public; the viewer's share button calls it and ignores the answer |
| `POST /api/stats` | the dashboard's only data source; needs the password |

The password is checked in the Worker against a secret, never in JavaScript the
site serves, and travels in the POST body so it never lands in a URL or an
access log. The dashboard holds it in memory only — a reload asks again.

### Switching it on

Both live on the `weruncoaching` Pages project and neither is in this repo.
Until they are set the site is completely unaffected: sharing still works, it
just is not counted, and `/admin` stays locked rather than falling open.

1. **Somewhere to keep the counts.** Create a KV namespace and bind it to the
   Pages project as **`STATS`** — Cloudflare dashboard → *Workers & Pages* →
   `weruncoaching` → *Settings* → *Bindings* → *KV namespace*. Or:

```bash
npx wrangler kv namespace create werun-stats
```

2. **The password.** On the same Settings page add an environment variable
   named **`ADMIN_PASSWORD`**, set it to the password you want, and click
   *Encrypt* so it is stored as a secret. Set it for **Production**.

3. Redeploy (any push to `main`, or *Retry deployment*) so the running Worker
   picks the bindings up, then open `/admin`.

### Or do it without the dashboard

There are two Cloudflare accounts, and it matters which one you are in:

| Login | Account | Holds |
|---|---|---|
| `ahmedabbas_12@outlook.com` — *Continue with GitHub* | `86fef310…` | **`weruncoaching`** (this site), its `werun-stats` KV |
| `ahmed12abbas93@gmail.com` | `769aedce…` | `werun`, `werun-5k-test`, an unrelated `werun-stats` KV |

A KV namespace only works for the project if it lives in the **same account**.
Binding one from the gmail account to `weruncoaching` looks fine at bind time
and then fails every deploy at publish with *KV namespace not found* — that
happened on 2026-09-02 and is why the workflow below has an `unbind_kv` input.

`.github/workflows/bindings.yml` does the two dashboard steps over the API
instead, using the `CLOUDFLARE_API_TOKEN` the deploy already has. It takes an
optional `namespace_id` — hand it one and it skips the KV API entirely, which
is how a Pages-only token still gets the job done.

1. Set the password as a repo secret. From a file, not a console paste —
   pasting has silently truncated a secret in this repo before:

```bash
Get-Content pw.txt | gh secret set TIPS_PASSWORD
```

2. Run **Set up the Cloudflare bindings** from the Actions tab. It finds or
   creates the `werun-stats` namespace, binds it as `STATS`, sets the
   password as a `secret_text` variable, redeploys so the running Worker
   picks the bindings up, and then polls the live site until it stops
   answering `not-configured`.

It is manual-trigger only, because it writes account configuration rather
than site content, and safe to run again — the namespace is looked up by
title before it is created, and the PATCH names only the keys it sets.
Add `ADMIN_PASSWORD` as a second repo secret to unlock `/admin` in the same
run. Neither value is printed: both are masked, and the request body goes
to a file rather than an echoed command line.

The token needs **Workers KV Storage: Edit** as well as **Pages: Edit**, and
the one in the repo on 2026-09-02 had only the latter — the run failed with
`401 code 10000 Authentication error` on the KV listing. Cloudflare answers
401/10000 when a token has no grant for a resource class at all, and 403 when
it has one that is too narrow, so a 401 here is not about the account id.
The workflow now probes both halves before writing anything and names which
one is missing.

Reminting is a dashboard job, and it has to be done signed in as the account
that owns the project — *My Profile* → *API Tokens* → *Create Token* →
*Custom token*, with these three permissions:

| Scope | Permission | Level |
|---|---|---|
| Account | Cloudflare Pages | Edit |
| Account | Workers KV Storage | Edit |
| Account | Account Settings | Read |

Then replace the repo secret the same way it was set last time — from a file,
since a console paste truncated it once already:

```bash
Get-Content token.txt | gh secret set CLOUDFLARE_API_TOKEN
```

To change the password later, edit that one variable — nothing needs
redeploying twice and no code changes.

---

## Coach Tips

Beside the session title, the club logo springs in with a light bulb popping
into its corner, and a comet laps the rim the opposite way round to the pace
button's. Tapping it opens a speech cloud holding an article a coach has written — form, fuelling, what to think about on tonight's reps.

**The link to give the coach who writes them: `/tips` on the live site**, plus
the password. It needs no account and no Cloudflare login — she opens the link,
types the password, writes, and saves.

She can keep as many articles as she likes; exactly one is marked **live**, and
that is the only one athletes ever see. The others stay drafts on the
password-gated side — `GET /api/tips` answers with the live article alone, so
an unfinished piece cannot be read off the API before she puts it up.

Each article has an English and an Arabic half, and the cloud shows whichever
matches the athlete's language toggle. If one half is left empty, the other is
shown in its place rather than an empty bubble.

Each article carries its own **posted** and **updated** times, shown beside it
in the editor and on the dashboard. The editor posts the whole collection on
every save, so the Worker compares each article against the stored copy and
moves `updated` only when that article's own text actually changed -- otherwise
editing one would restamp them all. Timestamps are never taken from the
request.

### Writing an article

There is no markup to learn. The editor previews the result live, beside the
box, in both languages:

| What she types | What athletes get |
|---|---|
| a blank line | a new paragraph |
| a line starting with `-` | a bullet |
| `**five seconds slower**` | **five seconds slower** |

Every article is signed off underneath with the coach's byline, linking to
<https://www.instagram.com/h__enroute/> in a new tab. The name and the link sit
in `js/tipfmt.js` beside the formatting rules rather than in `js/i18n.js`,
because the two standalone pages have no translation table to read from and the
preview has to show exactly what athletes get. The UESCA credential stays in
Latin in both languages: it is the name of the qualification, not a phrase to
translate.

Those rules live in one place -- `js/tipfmt.js` -- and all three renderers
call into it: the athlete's cloud, the editor's preview, and the read-only
viewer on `/admin`. It is deliberately DOM-free, so the two standalone pages
can load it without pulling in the rest of the site's javascript. Change the
rules there and all three follow; that is the point.

A block counts as a list only when *every* line in it is a bullet, so a dash
used mid-sentence stays part of the sentence. Nothing else is interpreted:
the article is built out of text nodes, so it can emphasise a phrase but can
never put markup into the page.

**Until something is marked live the button does not appear at all.** Athletes
never meet a logo that opens an empty cloud — which is also what happens on the
GitHub Pages mirror, where no Worker answers `/api/tips`.

### Switching it on

Nothing extra to create: the articles live in the **same `STATS` KV namespace**
as the share counts, under their own key, so if `/admin` works then `/tips`
works.

The password is **`TIPS_PASSWORD`** if it is set, otherwise `ADMIN_PASSWORD`.
Set the separate one — same Settings page, same *Encrypt* button — when the
coach who writes the articles should not also hold the key to the share
dashboard. Either way the check happens in the Worker, never in JavaScript the
site serves, and the editor holds the password in memory only, so a reload asks
again.

| Route | |
|---|---|
| `GET /api/tips` | public; the live article, both languages, and nothing else |
| `POST /api/tips-admin` | the editor's only data source; needs the password |

## Files

| File | What it does |
|---|---|
| `index.html` | Markup shell and all the CSS (light + dark, LTR + RTL, Teko + WE RUN purple) |
| `js/config.js` | **The only file you edit after deploying** |
| `js/i18n.js` | English and Arabic strings, the theme and language switches |
| `js/brand.js` | Logo, icons, header toggles |
| `js/model.js` | Session model, formatters, link encoding |
| `js/pace.js` | The club's pace chart and the calculator beside the session title |
| `js/connect.js` | The one-tap delivery client |
| `js/views.js` | Builder and athlete viewer |
| `js/boot.js` | Entry point — builder vs viewer |
| `js/fit.js` | Binary `.FIT` workout encoder |
| `js/tipfmt.js` | The one copy of the article formatting rules, shared by all three renderers |
| `js/tips.js` | Coach Tips: the logo pop and the cloud it opens |
| `admin.html` | The share dashboard at `/admin` — standalone, its own CSS |
| `tips.html` | The article editor at `/tips` — standalone, its own CSS |
| `_worker.js` | Server side of the share counter and Coach Tips; reserved name, never served |
| `.github/workflows/bindings.yml` | One-shot: sets the KV and password bindings over the API |
| `worker/` | Cloudflare Worker holding the OAuth secret and athlete tokens |
| `assets/logo.png` | **Drop the WE RUN logo here** — the page falls back to a Teko wordmark if it's missing |

Brand colour lives in one place: `--brand` at the top of `index.html`. It's
`#8851F4`, sampled from the logo itself.

### Language

Both languages live in `js/i18n.js` as one flat table each. Sentences that need
emphasis are written once with `**bold**` markers and rendered by `rich()`, so a
translator edits whole sentences rather than glued-together fragments.

Teko has no Arabic glyphs, so Arabic display text uses **Cairo** — set under
`[dir="rtl"]` in `index.html`. English typography is untouched. Garmin's own English
UI words (`Run`, `Warm Up`, `Send to Device`) stay in English inside the step tables
even in Arabic, because that is what the athlete has to find on screen.

---

## Deploying

Both are already live. GitHub is the source of truth; Cloudflare serves the link
you hand out.

### 1. GitHub Pages — automatic

`git push` and Pages rebuilds from `main` on its own. Nothing else to do.

### 2. Cloudflare Pages — automatic, via GitHub Actions

`.github/workflows/deploy.yml` redeploys `weruncoaching.pages.dev` on every push to `main`.
It assembles a folder holding only `index.html`, `js/` and `assets/` and uploads
that, so the worker source and this readme never end up on the site.

Both secrets (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) are set and the
deploy is green. If the token ever needs replacing:

1. Create one at <https://dash.cloudflare.com/profile/api-tokens> — Custom token,
   permission **Account → Cloudflare Pages → Edit**. Tokens are `cfut_`-prefixed
   and ~53 characters now.
2. Save it to a file and pipe it in — pasting into gh's hidden prompt truncates:
   `Get-Content token.txt | gh secret set CLOUDFLARE_API_TOKEN` (then delete the
   file).
3. Push anything, or run the workflow by hand from the repo's **Actions** tab.

<details>
<summary>Why not Cloudflare's own Git integration?</summary>

Because `werun` was created as a **Direct Upload** project and Cloudflare will not
convert one — the API answers `8000069: You cannot update the source object in a
Direct Uploads project`. Creating a fresh git-connected project fails too, with
`8000011`, because the Cloudflare Pages GitHub App is not installed on the account;
installing it is a dashboard-only OAuth step.

Using the native integration would mean **deleting the `werun` project and
recreating it** under the same name to keep the URL, after installing the app from
**Workers & Pages → Create → Pages → Connect to Git**. The site is briefly
unreachable while that happens. The Action above avoids all of it.
</details>

To deploy by hand at any time:

```bash
npx wrangler pages deploy <folder> --project-name werun --branch main --commit-dirty=true
```

### 3. One-tap delivery — the Worker (optional)

Everything above works without this. To switch on "Send it to my watch":

1. **Register the OAuth app.** Log in to intervals.icu as the club account and go to
   <https://intervals.icu/oauth/apply>. Ask for scope `CALENDAR:WRITE` and set the
   redirect URI to `https://<worker-name>.<your-subdomain>.workers.dev/oauth/callback`.
   The app sits in **Pending** until intervals.icu approve it — nothing works before
   that.
2. **Create the token store and deploy:**

```bash
cd worker && npx wrangler kv namespace create LINKS
```

   Paste the returned id into `wrangler.toml`, set `INTERVALS_CLIENT_ID` and
   `ALLOWED_ORIGINS` (your Pages URL), then:

```bash
cd worker && npx wrangler secret put INTERVALS_CLIENT_SECRET && npx wrangler deploy
```

3. **Point the site at it.** In `js/config.js` set `workerUrl` to the deployed
   Worker URL and `connectEnabled` to `true`, then push.

4. Check it with `curl https://<worker>/health` — it should report
   `{"ok":true,"configured":true}`.

Tell athletes to tick **Upload planned workouts** in their intervals.icu settings
after linking Garmin; without it the session lands on their intervals.icu calendar
but never reaches the watch. The page warns them when it can detect this.

> **Not yet exercised against the live API.** The Worker is written to
> intervals.icu's documented OAuth and `/api/v1/athlete/0/events` contract, but it
> cannot be run end-to-end until the OAuth app is approved. Test it with one athlete
> before announcing it to the club.

---

## About the `.fit` file

`js/fit.js` writes the FIT binary directly: `file_id`, `workout`, and one
`workout_step` per step, with repeat groups flattened into a
`repeat_until_steps_cmplt` step pointing back at the first rep. Pace targets convert
to speed (the slower pace becomes the *low* speed bound); heart-rate targets use the
+100 bpm offset the format requires.

The output round-trips through an independent parser — header, both CRCs, declared
data size, message walk, step count and every field value. **It has not been tested
on a physical Garmin watch.** Try it on your own watch before pointing the whole club
at that route; the typed and text routes don't depend on it.

The same file is what gets uploaded to intervals.icu on a one-tap send, so the
athlete gets the exact steps rather than a re-typed approximation.

---

## Extending it

- **More step types:** add to `KINDS` in `js/model.js` and to `FIT_INTENSITY` /
  `FIT_STEP_NAME` in `js/fit.js`. **Append to `KIND_ORDER`, never reorder it** — those
  indices are baked into every link already sent out.
- **Cycling or swimming:** the `sport` enum is hardcoded to `1` (running) in
  `buildFitFile`; 2 is cycling, 5 is swimming.
- **Cadence or power targets:** FIT target types 3 and 4, same shape as the pace branch.
- **Shorter links:** the payload is plain base64 JSON. Compressing it first
  (`CompressionStream("deflate-raw")`) would roughly halve it.

---

## Your own watch

The constraints above are about *other people's* accounts. For your own there's a
direct route: `garmin-mcp/` (kept out of this repo) is an MCP server that pushes a
session straight into your Garmin Connect library, calendar, or watch. It uses
Garmin's private web endpoints, so it works for one account — yours — and can break
when Garmin changes their web app.
