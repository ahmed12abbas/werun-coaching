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
| **Monday** | 10 min warm up, drills, a 1-2-3-4-5-6 min ladder at 5 K pace, 10 min cool down |
| **Thursday** | Hill repeats — 12 x 200 m, jog back down, everything but the reps on the lap button |

They live in `SESSIONS` at the top of `js/model.js`. Adding a day is a builder
function and one line in that list; the picker, the i18n labels and the swap
prompt all follow from it.

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

To change the password later, edit that one variable — nothing needs
redeploying twice and no code changes.

## Files

| File | What it does |
|---|---|
| `index.html` | Markup shell and all the CSS (light + dark, LTR + RTL, Teko + WE RUN purple) |
| `js/config.js` | **The only file you edit after deploying** |
| `js/i18n.js` | English and Arabic strings, the theme and language switches |
| `js/brand.js` | Logo, icons, header toggles |
| `js/model.js` | Session model, formatters, link encoding |
| `js/connect.js` | The one-tap delivery client |
| `js/views.js` | Builder and athlete viewer |
| `js/boot.js` | Entry point — builder vs viewer |
| `js/fit.js` | Binary `.FIT` workout encoder |
| `admin.html` | The share dashboard at `/admin` — standalone, its own CSS |
| `_worker.js` | Server side of the share counter; reserved name, never served |
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
