/**
 * September's plan on top of the standing week.
 *
 *   node tools/seed-week.js                              (local dev)
 *   SMOKE_ADMIN_PASSWORD=… node tools/seed-week.js https://weruncoaching.pages.dev
 *
 * Two different things, because the club's plan has two kinds of fact in it:
 *
 *   the sessions that are the same all month  -> the standing week's own text,
 *                                                so they repeat by themselves
 *   the ones that are for one date only       -> published against that date
 *
 * Everything here is the coach's own wording. Nothing invents a workout: the
 * speed session is the payload from the share link she built, and the runs
 * described in words stay described in words until she sends one.
 *
 * Safe to re-run: standing entries are matched on day and time, and a session
 * already published for a date and slot is left alone.
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

/* The week's speed session, exactly as the coach built it: warm up 15 min,
   ABC drills + strides, 12 × (work @5K / jog-walk), cool down. It runs three
   times a week — Monday evening, Tuesday morning, Thursday morning — and she
   replaces it weekly, so it is published per date and never standing. */
const SPEED =
  "1.gzjGNz8P0y0QE2AmI9tvaKqQm5mnBDMMpgQk5ejkDA1KBW2F4pKizJTUYrBCoHsNjZBcDHGsKcxIB1NvcFAjGVoM0gGVzspP1y9PzMlWgjvcGJ_DYiGxDo9dpVoA";

/* What each standing slot is, in the coach's words. Keyed on the day and the
   time so a re-run updates rather than duplicates. Anything not listed keeps
   whatever it already says. */
const STANDING = [
  { weekday: 0, at: "04:55", title_en: "Community run — 45 min easy + strides", title_ar: "ركضة مجتمعية — ٤٥ دقيقة هادئة + فتحات" },
  { weekday: 0, at: "19:30", title_en: "Easy run — 45 min + strides",           title_ar: "ركضة خفيفة — ٤٥ دقيقة + فتحات" },
  { weekday: 1, at: "04:55", title_en: "Easy walk/run — 4 km",                  title_ar: "ركض/مشي خفيف — ٤ كم" },
  { weekday: 3, at: "04:55", title_en: "Trail run — 7 to 9 km",                 title_ar: "ركضة تريل — ٧ إلى ٩ كم" },
  { weekday: 3, at: "19:30", title_en: "Easy run — 50 min + strides",           title_ar: "ركضة خفيفة — ٥٠ دقيقة + فتحات" },
];

/* The club is in Riyadh, which is UTC+3 all year with no daylight saving.
   A published session is an absolute instant, so "19:00" has to be anchored
   to the club's clock and not to whichever machine happens to run this — the
   standing week's times are wall-clock and need no such thing. */
const CLUB_OFFSET = "+03:00";

const iso = (d) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

/** The next date on or after today that falls on `weekday`. */
function next(weekday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return d;
}

async function call(path, payload) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.assign({ password: ADMIN }, payload)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(path + " -> HTTP " + res.status + " " + JSON.stringify(data));
  return data;
}

(async () => {
  const plan = await call("/api/admin/schedule", { action: "list" });
  const slots = plan.schedule || [];
  if (!slots.length) {
    console.error("The standing week is empty — run tools/seed-schedule.js first.");
    process.exit(1);
  }
  const slotAt = (weekday, at) => slots.find((e) => e.weekday === weekday && e.at === at);

  /* ---- the ones that are the same all month ---- */
  console.log("The standing week");
  for (const want of STANDING) {
    const slot = slotAt(want.weekday, want.at);
    if (!slot) {
      console.log("  ? no " + want.at + " slot on day " + want.weekday + " — skipped");
      continue;
    }
    await call("/api/admin/schedule", {
      action: "save",
      entry: Object.assign({}, slot, { title_en: want.title_en, title_ar: want.title_ar }),
    });
    console.log("  " + want.at + "  " + want.title_en);
  }

  /* ---- the ones that are for one date ---- */
  console.log("\nThis week");
  const sessions = (await call("/api/admin/sessions", { action: "list" })).sessions || [];

  async function publish(weekday, at, name, payload) {
    const slot = slotAt(weekday, at);
    if (!slot) return console.log("  ? no " + at + " slot on day " + weekday + " — skipped");
    const day = next(weekday);
    const date = iso(day);
    const startsAt = new Date(date + "T" + at + ":00" + CLUB_OFFSET);
    const already = sessions.find((s) => s.date === date && s.schedule_id === slot.id);
    if (already) {
      // A published session is an absolute instant and there is no route that
      // moves one, so a slot retimed after it was published keeps the old
      // start. Say so rather than leave the coach to spot it in the app — she
      // moves it in /admin, or the whole thing goes in as werun-seed.sql.
      const drift = already.starts_at !== startsAt.toISOString();
      return console.log(
        "  " + date + " " + at + "  already published — left alone" +
          (drift ? "  ⚠ it still starts " + already.starts_at.slice(11, 16) + " UTC; move it in /admin" : "")
      );
    }
    await call("/api/admin/sessions", {
      action: "publish",
      schedule_id: slot.id,
      name: name,
      payload: payload,
      date: date,
      starts_at: startsAt.toISOString(),
      points: slot.points,
    });
    console.log("  " + date + " " + at + "  " + name);
  }

  // Monday evening, Tuesday morning and Thursday morning are the same speed
  // session this week — all three published, so all three open the workout
  // itself rather than a line of plan.
  await publish(1, "19:00", "Speed session | WeRUN", SPEED);
  await publish(2, "04:55", "Speed session | WeRUN", SPEED);
  await publish(4, "04:55", "Speed session | WeRUN", SPEED);

  // Saturday's long run is 80 minutes this week; the weeks after it are the
  // coach's to say, so this is a note against the one date and not the pattern.
  const sat = slotAt(6, "04:55");
  if (sat) {
    const date = iso(next(6));
    await call("/api/admin/schedule-change", {
      schedule_id: sat.id,
      date: date,
      note_en: "80 minutes",
      note_ar: "٨٠ دقيقة",
    });
    console.log("  " + date + " 04:55  Long run — 80 minutes (this week only)");
  }

  console.log("\nStill to come from the coach: the long runs after this Saturday.");
})().catch((e) => {
  console.error("seed-week: " + (e.message || e));
  process.exit(1);
});
