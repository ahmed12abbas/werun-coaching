/**
 * The standing week and this week's plan as plain SQL.
 *
 *   node tools/seed-sql.js            -> werun-seed.sql
 *
 * For the same case the schema dump exists for: a live database that has to
 * be filled in through Cloudflare's D1 console because the API token cannot
 * reach D1. The seed scripts do the same thing through the console's own API,
 * which needs the club password; this needs nothing but the console.
 *
 * Written comment-free and one statement per line, because the D1 console
 * collapses newlines on paste.
 *
 * Re-running is safe: every insert is INSERT OR IGNORE against a fixed id, so
 * a second run changes nothing and cannot duplicate a session.
 */
const crypto = require("crypto");
const { mapFor } = require("./places.js");

/* Fixed ids, derived from what the row *is*, so the same slot gets the same
   id on every machine and a second run is a no-op rather than a duplicate. */
const idFor = (kind, key) =>
  crypto.createHash("sha256").update("werun:" + kind + ":" + key).digest("hex").slice(0, 32);

/* The key a slot is identified by, which is not the same as the time it
   starts at. The morning sessions moved from 04:45 to 04:55, and the rows on
   the live database were minted under the old time — so a retiming has to
   move the row that is already there rather than mint a second one beside it. */
const KEYED_AT = { "04:55": "04:45" };
const keyed = (at) => KEYED_AT[at] || at;

const q = (v) => (v === null || v === undefined ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'");
const now = new Date().toISOString();

/* The club is in Riyadh: UTC+3, no daylight saving. */
const CLUB_OFFSET = "+03:00";

/* The standing week, with September's wording where the coach gave it. */
const WEEK = [
  { d: 0, at: "04:55", en: "Community run — 45 min easy + strides", ar: "ركضة مجتمعية — ٤٥ دقيقة هادئة + فتحات",    pen: "Wadi Mahdia Road",       par: "خط التفتيش - بعد الدوار" },
  { d: 0, at: "19:30", en: "Easy run — 45 min + strides",           ar: "ركضة خفيفة — ٤٥ دقيقة + فتحات",          pen: "Alwaha Park",            par: "حديقة الواحة" },
  { d: 1, at: "04:55", en: "Easy walk/run — 4 km",                  ar: "ركض/مشي خفيف — ٤ كم",                   pen: "Sports Boulevard",       par: "المسار الرياضي - حطين" },
  { d: 1, at: "19:00", en: "Speed session",                         ar: "تمرين سرعات",                           pen: "Misk City Track",        par: "مضمار مدينة مسك" },
  { d: 2, at: "04:55", en: "Speed session",                         ar: "تمرين سرعات",                           pen: "Wadi Mahdia Road",       par: "خط التفتيش - بعد الدوار" },
  { d: 2, at: "19:30", en: "Strength session",                      ar: "تقويات عدائين",                         pen: "Alfaisal University",    par: "جامعة الفيصل" },
  { d: 3, at: "04:55", en: "Trail run — 7 to 9 km",                 ar: "ركضة تريل — ٧ إلى ٩ كم",                pen: "Wadi Hanifa Road-Trail", par: "وادي حنيفة - تريل" },
  { d: 3, at: "19:30", en: "Easy run — 50 min + strides",           ar: "ركضة خفيفة — ٥٠ دقيقة + فتحات",          pen: "Alnahda Park",           par: "حديقة النهضة" },
  { d: 4, at: "04:55", en: "Speed session",                         ar: "تمرين سرعات",                           pen: "Wadi Mahdia Road",       par: "خط التفتيش - بعد الدوار" },
  { d: 6, at: "04:55", en: "Long run",                              ar: "ركضة طويلة",                            pen: "Wadi Hanifa Park",       par: "حديقة وادي حنيفة" },
];

/* The week's speed session as the coach built it: warm up 15 min, ABC drills
   + strides, 12 × (work @5K / jog-walk), cool down 15 min. It runs three times
   a week — Monday evening, Tuesday morning, Thursday morning. */
const SPEED =
  "1.gzjGNz8P0y0QE2AmI9tvaKqQm5mnBDMMpgQk5ejkDA1KBW2F4pKizJTUYrBCoHsNjZBcDHGsKcxIB1NvcFAjGVoM0gGVzspP1y9PzMlWgjvcGJ_DYiGxDo9dpVoA";

const isoDay = (d) =>
  d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");

/** The next date on or after today, in club time, that falls on `weekday`. */
function nextDate(weekday) {
  const d = new Date();
  const club = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  club.setUTCDate(club.getUTCDate() + ((weekday - club.getUTCDay() + 7) % 7));
  return isoDay(club);
}

const lines = [];

/* ---- the standing week ---- */
for (const s of WEEK) {
  const id = idFor("slot", s.d + "@" + keyed(s.at));
  lines.push(
    "INSERT OR IGNORE INTO schedule (id, weekday, at, title_en, title_ar, place_en, place_ar, map_url, points, active, created_at, updated_at) VALUES (" +
      [q(id), s.d, q(s.at), q(s.en), q(s.ar), q(s.pen), q(s.par), q(mapFor(s.pen)), 10, 1, q(now), q(now)].join(", ") +
      ");"
  );
  // A second run should still correct the wording if the coach changed it
  // here — and the time, which is how the mornings move to 04:55 on a
  // database that was already seeded at 04:45.
  // The pin only when there is one to set: a place nobody has dropped a pin
  // on must not have the coach's own link blanked out from under her.
  const pin = mapFor(s.pen);
  lines.push(
    "UPDATE schedule SET at = " + q(s.at) + ", title_en = " + q(s.en) + ", title_ar = " + q(s.ar) +
      ", place_en = " + q(s.pen) + ", place_ar = " + q(s.par) +
      (pin ? ", map_url = " + q(pin) : "") +
      ", updated_at = " + q(now) + " WHERE id = " + q(id) + ";"
  );
}

/* ---- this week's published workouts ---- */
const WINDOW_BEFORE = 30 * 60000;
const WINDOW_AFTER = 45 * 60000;

function publish(weekday, at, name) {
  const date = nextDate(weekday);
  const slotId = idFor("slot", weekday + "@" + keyed(at));
  const id = idFor("session", date + "@" + keyed(at));
  const starts = new Date(date + "T" + at + ":00" + CLUB_OFFSET);
  lines.push(
    "INSERT OR IGNORE INTO club_sessions (id, date, day, name, payload, starts_at, window_open_at, window_close_at, points, created_at, schedule_id) VALUES (" +
      [
        q(id), q(date),
        q(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][weekday]),
        q(name), q(SPEED), q(starts.toISOString()),
        q(new Date(starts.getTime() - WINDOW_BEFORE).toISOString()),
        q(new Date(starts.getTime() + WINDOW_AFTER).toISOString()),
        10, q(now), q(slotId),
      ].join(", ") +
      ");"
  );
  // The same retiming for a session already published at the old time. It is
  // an absolute instant, so the window either side of it moves with it.
  lines.push(
    "UPDATE club_sessions SET starts_at = " + q(starts.toISOString()) +
      ", window_open_at = " + q(new Date(starts.getTime() - WINDOW_BEFORE).toISOString()) +
      ", window_close_at = " + q(new Date(starts.getTime() + WINDOW_AFTER).toISOString()) +
      " WHERE id = " + q(id) + ";"
  );
  return date;
}

const mon = publish(1, "19:00", "Speed session | WeRUN");
const tue = publish(2, "04:55", "Speed session | WeRUN");
const thu = publish(4, "04:55", "Speed session | WeRUN");

/* ---- the one note that belongs to a single date ---- */
const sat = nextDate(6);
lines.push(
  "INSERT OR IGNORE INTO schedule_changes (id, schedule_id, date, cancelled, at, place_en, place_ar, map_url, note_en, note_ar, created_at) VALUES (" +
    [
      q(idFor("change", "sat:" + sat)), q(idFor("slot", "6@" + keyed("04:55"))), q(sat), 0,
      "NULL", "NULL", "NULL", "NULL", q("80 minutes"), q("٨٠ دقيقة"), q(now),
    ].join(", ") +
    ");"
);

require("fs").writeFileSync("werun-seed.sql", lines.join("\n") + "\n");
console.log(
  "wrote werun-seed.sql — " + lines.length + " statements\n" +
    "  10 standing sessions\n" +
    "  speed session published for " + mon + " 19:00, " + tue + " 04:55 and " + thu + " 04:55\n" +
    "  long run on " + sat + " noted as 80 minutes"
);
