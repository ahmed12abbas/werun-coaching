# WE RUN Coaching

**Live: <https://werun.pages.dev>** — this is the link to hand out.
Mirror on GitHub Pages: <https://ahmed12abbas.github.io/werun-coaching/>

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

1. Open the site with no `#` on the end — that's the **builder**. It opens on the
   standing **Tuesday | WeRUN** session.
2. Adjust name, date, note and steps. **Add repeat set** handles the reps.
3. **Copy link**, paste into WhatsApp.
4. Next week, open the plain URL again. Links you already sent keep working.

Links run roughly 250–450 characters — fine for WhatsApp, Telegram, SMS.

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

`.github/workflows/deploy.yml` redeploys `werun.pages.dev` on every push to `main`.
It assembles a folder holding only `index.html`, `js/` and `assets/` and uploads
that, so the worker source and this readme never end up on the site.

**It needs one secret before it can run.** `CLOUDFLARE_ACCOUNT_ID` is already set;
add the token:

1. Create a token at <https://dash.cloudflare.com/profile/api-tokens> using the
   **Edit Cloudflare Workers** template (it covers Pages).
2. `gh secret set CLOUDFLARE_API_TOKEN`
3. Push anything, or run it by hand from the repo's **Actions** tab.

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
