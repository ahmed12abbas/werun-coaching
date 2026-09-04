/**
 * The club's standing week, as it is on the printed schedule.
 *
 *   node tools/seed-schedule.js                              (local dev)
 *   node tools/seed-schedule.js https://weruncoaching.pages.dev
 *
 * Writes the ten recurring sessions through /api/admin/schedule, so it goes
 * through the same validation the console does. Safe to re-run: entries are
 * matched on day + time, or failing that on day + place, and updated rather
 * than duplicated — so moving a session's time moves the row that is there.
 *
 * The club's week starts on Sunday and Friday is the rest day. Two slots:
 * 04:55 before work and 19:30 after it — except Misk, which starts at 19:00
 * because the track is booked from seven.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

/* weekday: 0 = Sunday … 6 = Saturday, the way the club counts it. */
const WEEK = [
  { weekday: 0, at: "04:55", title_en: "Community run",   title_ar: "ركضة مجتمعية", place_en: "Wadi Mahdia Road",       place_ar: "خط التفتيش - بعد الدوار" },
  { weekday: 0, at: "19:30", title_en: "Easy run",        title_ar: "ركضة خفيفة",   place_en: "Alwaha Park",            place_ar: "حديقة الواحة" },
  { weekday: 1, at: "04:55", title_en: "Easy walk/run",   title_ar: "ركض/مشي خفيف", place_en: "Sports Boulevard",       place_ar: "المسار الرياضي - حطين" },
  { weekday: 1, at: "19:00", title_en: "Speed session",   title_ar: "تمرين سرعات",  place_en: "Misk City Track",        place_ar: "مضمار مدينة مسك" },
  { weekday: 2, at: "04:55", title_en: "Speed session",   title_ar: "تمرين سرعات",  place_en: "Wadi Mahdia Road",       place_ar: "خط التفتيش - بعد الدوار" },
  { weekday: 2, at: "19:30", title_en: "Strength session",title_ar: "تقويات عدائين",place_en: "Alfaisal University",    place_ar: "جامعة الفيصل" },
  { weekday: 3, at: "04:55", title_en: "Community run",   title_ar: "ركضة مجتمعية", place_en: "Wadi Hanifa Road-Trail", place_ar: "وادي حنيفة - تريل" },
  { weekday: 3, at: "19:30", title_en: "Easy run",        title_ar: "ركضة خفيفة",   place_en: "Alnahda Park",           place_ar: "حديقة النهضة" },
  { weekday: 4, at: "04:55", title_en: "Speed session",   title_ar: "تمرين سرعات",  place_en: "Wadi Mahdia Road",       place_ar: "خط التفتيش - بعد الدوار" },
  { weekday: 6, at: "04:55", title_en: "Long run",        title_ar: "ركضة طويلة",   place_en: "Wadi Hanifa Park",       place_ar: "حديقة وادي حنيفة" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function call(payload) {
  const res = await fetch(BASE + "/api/admin/schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.assign({ password: ADMIN }, payload)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("HTTP " + res.status + " " + JSON.stringify(data));
  return data;
}

(async () => {
  let existing = (await call({ action: "list" })).schedule || [];
  let added = 0;
  let updated = 0;

  for (const item of WEEK) {
    // Day and time first, then day and place: the mornings moved from 04:45
    // to 04:55, and a re-run has to retime the row that already exists rather
    // than leave the old time standing beside the new one. No two sessions on
    // one day meet at the same place, so the fallback cannot pick the wrong row.
    const already =
      existing.find((e) => e.weekday === item.weekday && e.at === item.at) ||
      existing.find((e) => e.weekday === item.weekday && e.place_en === item.place_en);
    const out = await call({ action: "save", entry: Object.assign({ id: already ? already.id : null, active: 1 }, item) });
    existing = out.schedule || existing;
    already ? updated++ : added++;
    console.log(
      (already ? "updated " : "added   ") + DAYS[item.weekday].padEnd(10) + item.at + "  " +
        item.title_en.padEnd(17) + item.place_en
    );
  }

  console.log("\n" + added + " added, " + updated + " updated — " + existing.length + " in the standing week.");
})().catch((e) => {
  console.error("seed-schedule: " + (e.message || e));
  process.exit(1);
});
