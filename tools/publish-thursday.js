/**
 * Thursday's interval session, published against the standing 04:55 slot.
 *
 *   node tools/publish-thursday.js                                    (local dev)
 *   SMOKE_ADMIN_PASSWORD=… node tools/publish-thursday.js https://weruncoaching.pages.dev
 *
 * The coach's card for the week: warm up on the lap button, ABC drills and
 * strides, 15 × 100 m at mile pace with a minute's walk-jog between them, cool
 * down on the lap button. The 15 min on the warm up and the cool down is her
 * estimate and a note, not something that stops the step.
 *
 * It goes in with `schedule_id`, the way tools/seed-week.js does, so the week
 * shows the workout in the standing session's place rather than a second row
 * beside it — the /admin publish form does not attach one.
 *
 * Safe to re-run: it stops when something is already on that date, and says so.
 * REPLACE=1 deletes what is there first — the server refuses that outright once
 * anyone has checked in, because a session with check-ins is part of people's
 * points. DATE= moves it to another Thursday.
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";
const REPLACE = process.env.REPLACE === "1";

const DATE = process.env.DATE || "2026-09-10";
const AT = "04:55";
const WEEKDAY = 4; // 0 = Sunday, the way the club counts it
const NAME = "Speed session | WeRUN";

/* Riyadh is UTC+3 all year with no daylight saving. A published session is an
   absolute instant, so "04:55" has to be anchored to the club's clock and not
   to whichever machine happens to run this. */
const CLUB_OFFSET = "+03:00";

/* The session itself, straight out of the builder — the link is the workout,
   and nothing here or on the server ever decodes it. */
const PAYLOAD =
  "1.gzomo7QIi2sgZsDMRnaBoalCbmaeEsw4mBKQlKOTMzQwFbQVikuKMlNSi8EKgS42NEVyM8S5hjAjEeGOZCxQsRlUvjwxJ1s_Kz9dCe52Y3wui4VEPDyClWoB";

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
  const slots = (await call("/api/admin/schedule", { action: "list" })).schedule || [];
  const slot = slots.find((e) => e.weekday === WEEKDAY && e.at === AT);
  if (!slot) {
    console.error("No Thursday " + AT + " slot in the standing week — run tools/seed-schedule.js first.");
    process.exit(1);
  }
  console.log("slot: " + slot.title_en + " — " + slot.place_en);

  const sessions = (await call("/api/admin/sessions", { action: "list" })).sessions || [];
  for (const s of sessions.filter((x) => x.date === DATE && x.schedule_id === slot.id)) {
    // A session opened only to hand out a check-in code carries no workout;
    // say which of the two is in the way, because they are not the same thing.
    const what = s.payload ? "a workout" : "no workout — opened for a code";
    console.log(DATE + " already has: " + s.name + " (" + what + ", " + (s.came || 0) + " checked in)");
    if (s.payload === PAYLOAD) return console.log("That is this session already — nothing to do.");
    if (!REPLACE) return console.log("Re-run with REPLACE=1 to delete it and publish this one instead.");
    await call("/api/admin/sessions", { action: "delete", id: s.id });
    console.log("  deleted " + s.id);
  }

  const startsAt = new Date(DATE + "T" + AT + ":00" + CLUB_OFFSET);
  const out = await call("/api/admin/sessions", {
    action: "publish",
    schedule_id: slot.id,
    name: NAME,
    payload: PAYLOAD,
    date: DATE,
    starts_at: startsAt.toISOString(),
    points: slot.points,
  });
  console.log("published " + DATE + " " + AT + "  " + NAME + "  (" + out.id + ")");
})().catch((e) => {
  console.error("publish-thursday: " + (e.message || e));
  process.exit(1);
});
