/**
 * The four-week half / full marathon block, published against its dates.
 *
 *   node tools/seed-plan.js                              (local dev)
 *   SMOKE_ADMIN_PASSWORD=… node tools/seed-plan.js https://weruncoaching.pages.dev
 *
 * From the coach's sheet (HM_FM_schedule_1.pdf). Each session goes out once,
 * with the half plan as the session and the full plan beside it (payload_fm),
 * so both groups meet at one place under one code and the app's Home toggle
 * picks which workout a phone shows. The sheet's "Monday" runs twice — Monday
 * evening and Tuesday morning — and Wednesday's easy run both ends of the day.
 * Monday morning, Tuesday evening and Sunday are left to the standing week.
 *
 * Safe to re-run: publishing a slot and date that already has a session
 * rewrites that session rather than adding one.
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";
const FIRST_MONDAY = "2026-10-19";
const CLUB_OFFSET = "+03:00"; // Riyadh, no daylight saving

// The real encoder, so these links are the ones the builder would make.
const box = { TextEncoder, TextDecoder, btoa, atob, console, t: (k) => k, I18N: { lang: "en" } };
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/model.js"), "utf8"), box);
const { blankStep, encodeWorkout } = vm.runInContext("({ blankStep, encodeWorkout })", box);

/* ---- step shorthand ---- */
const step = (type, fields) => Object.assign(blankStep(type), fields);
const dist = (m, note) => step("work", { durType: "distance", meters: m, note });
const time = (min, note) => step("work", { durType: "time", seconds: min * 60, note });
const rec = (sec, note) => step("recovery", { durType: "time", seconds: sec, note: note || "jog" });
const lap = (type, note) => step(type, { durType: "open", note });
const rep = (reps, ...steps) => ({ kind: "repeat", reps, steps });
const strides = () => rep(6, dist(100, "stride"), lap("recovery", "walk back"));

// The club's warm up and cool down around every speed session, on the lap
// button — the sheet gives only the main set.
const speed = (...main) => [
  step("warmup", { durType: "open", estSeconds: 900, note: "15 min" }),
  lap("rest", "ABC drills + strides"),
  ...main,
  step("cooldown", { durType: "open", estSeconds: 900, note: "15 min" }),
];
const easy = (min, withStrides) => [time(min, "easy"), ...(withStrides ? [strides()] : [])];
const long = (min, km) => [time(min, "easy, or " + km + " km")];
const hills = () =>
  speed(rep(6, dist(100, "hill @best"), lap("recovery", "jog down")), rep(6, dist(200, "hill @best"), lap("recovery", "jog down")));
const ladder = () => [time(4, "@HM"), rec(120), time(6, "@HM"), rec(180), time(8, "@HM"), rec(180)];

/* ---- the sheet, week by week: [name, blocks] for HM then FM ---- */
const WEEKS = [
  {
    mon: [
      ["Speed session — 400m ×4 + 200m ×4", speed(rep(4, dist(400, "@10K"), rec(90)), rep(4, dist(200, "@5K"), rec(60)))],
      ["Speed session — 400m ×6 + 200m ×6", speed(rep(6, dist(400, "@10K"), rec(90)), rep(6, dist(200, "@5K"), rec(60)))],
    ],
    wed: [["Easy run — 45 min + strides", easy(45, true)], ["Easy run — 60 min + strides", easy(60, true)]],
    thu: [
      ["Speed session — 1 km ×4 @HM", speed(rep(4, dist(1000, "@HM"), rec(120)))],
      ["Speed session — 1 km ×6 @FM", speed(rep(6, dist(1000, "@FM"), rec(120)))],
    ],
    sat: [["Long run — 65 min / 11 km", long(65, 11)], ["Long run — 75 min / 12 km", long(75, 12)]],
  },
  {
    mon: [
      ["Speed session — 2 min ×4 + 4-6-8 min @HM", speed(rep(4, time(2, "@10K"), rec(60)), ...ladder())],
      ["Speed session — 4-6-8 min @HM ×2", speed(rep(2, ...ladder()))],
    ],
    wed: [["Easy run — 50 min", easy(50)], ["Easy run — 60 min", easy(60)]],
    thu: [["Speed session — Hills 100m ×6 + 200m ×6", hills()], null],
    sat: [["Long run — 70 min / 12 km", long(70, 12)], ["Long run — 90 min / 14 km", long(90, 14)]],
  },
  {
    mon: [
      ["Speed session — 400-800-400 ×3 @10K", speed(rep(3, dist(400, "@10K"), rec(60), dist(800, "@10K"), rec(120), dist(400, "@10K"), rec(180)))],
      ["Speed session — 400-800-400 ×4 @10K", speed(rep(4, dist(400, "@10K"), rec(60), dist(800, "@10K"), rec(120), dist(400, "@10K"), rec(180)))],
    ],
    wed: [["Easy run — 55 min + strides", easy(55, true)], ["Easy run — 60 min + strides", easy(60, true)]],
    thu: [
      ["Speed session — 1.5 km ×4 @HM", speed(rep(4, dist(1500, "@HM"), rec(180)))],
      ["Speed session — 1.5 km ×6 @FM", speed(rep(6, dist(1500, "@FM"), rec(180)))],
    ],
    sat: [["Long run — 75 min / 13 km", long(75, 13)], ["Long run — 1:40 / 16 km", long(100, 16)]],
  },
  {
    // The recovery week.
    mon: [
      ["Speed session — 200m ×10 @10K", speed(rep(10, dist(200, "@10K"), rec(60)))],
      ["Speed session — 200m ×12 @10K", speed(rep(12, dist(200, "@10K"), rec(60)))],
    ],
    wed: [["Easy run — 60 min", easy(60)], null],
    thu: [
      ["Speed session — Fartlek 2 min @HM / 1 min easy ×10", speed(rep(10, time(2, "@HM"), rec(60, "easy")))],
      ["Speed session — Fartlek 2 min @FM / 1 min easy ×12", speed(rep(12, time(2, "@FM"), rec(60, "easy")))],
    ],
    sat: [["Long run — 50 min / 9 km", long(50, 9)], ["Long run — 65 min / 11 km", long(65, 11)]],
  },
];

/* Which standing slots each line of the sheet goes into: [weekday, morning or
   evening, days after Monday]. Matched on the half of the day, not the minute,
   because the coach retimes slots in /admin and the sheet does not care. */
const SLOTS = {
  mon: [[1, "pm", 0], [2, "am", 1]],
  wed: [[3, "am", 2], [3, "pm", 2]],
  thu: [[4, "am", 3]],
  sat: [[6, "am", 5]],
};
// When a half-day has more than one slot, the one whose standing title fits —
// a Saturday can carry a community run beside the long run.
const LIKE = { mon: /speed/i, wed: /easy/i, thu: /speed/i, sat: /long/i };

const encode = ([name, blocks]) =>
  encodeWorkout({ name, date: "", coach: "", note: "", units: "km", blocks });

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function call(p, payload, retried) {
  const res = await fetch(BASE + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.assign({ password: ADMIN }, payload)),
  });
  const data = await res.json().catch(() => ({}));
  // The club password is held to ten tries a minute (lib/crypto.js), and the
  // whole plan is about thirty calls: wait the minute out rather than stop.
  if (res.status === 429 && !retried) {
    console.log("  … the server asked to slow down; waiting a minute");
    await new Promise((r) => setTimeout(r, 61000));
    return call(p, payload, true);
  }
  if (!res.ok) throw new Error(p + " -> HTTP " + res.status + " " + JSON.stringify(data));
  return data;
}

(async () => {
  const slots = (await call("/api/admin/schedule", { action: "list" })).schedule || [];
  const slotAt = (weekday, half, like) => {
    const here = slots.filter((e) => e.weekday === weekday && (e.at < "12:00") === (half === "am"));
    return here.find((e) => like.test(e.title_en || "")) || here[0];
  };
  const placed = new Set(); // date|slot id this run published into

  for (const [w, week] of WEEKS.entries()) {
    const monday = addDays(FIRST_MONDAY, 7 * w);
    console.log("Week " + (w + 1) + " (from " + monday + ")");
    for (const [key, where] of Object.entries(SLOTS)) {
      const [hm, fm] = week[key];
      for (const [weekday, half, offset] of where) {
        const slot = slotAt(weekday, half, LIKE[key]);
        const date = addDays(monday, offset);
        if (!slot) {
          console.log("  ? no " + half + " slot on day " + weekday + " — skipped");
          continue;
        }
        const at = slot.at;
        await call("/api/admin/sessions", {
          action: "publish",
          schedule_id: slot.id,
          date,
          starts_at: new Date(date + "T" + at + ":00" + CLUB_OFFSET).toISOString(),
          points: slot.points,
          name: hm[0],
          payload: encode(hm),
          name_fm: fm ? fm[0] : "",
          payload_fm: fm ? encode(fm) : "",
        });
        placed.add(date + "|" + slot.id);
        console.log("  " + date + " " + at + " [" + slot.title_en + "]  " + hm[0] + (fm ? "  |  FM: " + fm[0] : "  (same for FM)"));
      }
    }
  }

  // A plan session sitting in a slot this run did not choose is one an earlier
  // run put in the wrong place. Delete refuses a session anybody checked in to.
  const ours = new Set(WEEKS.flatMap((wk) => Object.values(wk).map((pair) => pair[0][0])));
  const last = addDays(FIRST_MONDAY, 7 * WEEKS.length);
  const sessions = (await call("/api/admin/sessions", { action: "list" })).sessions || [];
  for (const x of sessions) {
    if (x.date < FIRST_MONDAY || x.date >= last || !ours.has(x.name) || placed.has(x.date + "|" + x.schedule_id)) continue;
    try {
      await call("/api/admin/sessions", { action: "delete", id: x.id });
      console.log("  removed a misplaced copy: " + x.date + " " + x.name);
    } catch (e) {
      console.log("  ! could not remove " + x.date + " " + x.name + " (" + e.message + ")");
    }
  }
})().catch((e) => {
  console.error("seed-plan: " + (e.message || e));
  process.exit(1);
});
