/* Weeks and days, the way the club counts them: Sunday first, Friday off. */

export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// The club names sessions "Monday | WeRUN". Coaches edit those names, so match
// the day word anywhere in the string rather than insisting it comes first,
// and accept the Arabic names the language toggle produces.
const AR_DAYS = {
  "الاثنين": "monday",
  "الإثنين": "monday",
  "الثلاثاء": "tuesday",
  "الأربعاء": "wednesday",
  "الاربعاء": "wednesday",
  "الخميس": "thursday",
  "الجمعة": "friday",
  "السبت": "saturday",
  "الأحد": "sunday",
  "الاحد": "sunday",
};

/**
 * The Sunday a date belongs to, as YYYY-MM-DD.
 *
 * The club's week runs Sunday to Thursday and rests on Friday, so the
 * Monday-first ISO week the old share counter grouped by would have cut every
 * week's opening session off from the rest of it. One date names the week.
 */
export function clubWeekStart(iso) {
  const d = new Date(String(iso) + "T00:00:00Z");
  if (isNaN(d)) return null;
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

const CLUB_OFFSET = "+03:00"; // Riyadh, all year, no daylight saving

/** Today in Riyadh, YYYY-MM-DD, whatever the server's own clock says. */
export const riyadhToday = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

/** Unix seconds for Sunday 00:00 in the club's own week, by the club's own clock. */
export function weekStartEpoch() {
  const sunday = clubWeekStart(riyadhToday());
  return { epoch: Math.floor(Date.parse(sunday + "T00:00:00" + CLUB_OFFSET) / 1000), sunday };
}

/* A watch's runs as the club's week: metres per day, Sunday first.
   start_date_local is local wall-clock time written with a "Z", the way
   Strava sends it — parsing it as UTC and reading the UTC weekday back out
   gives the athlete's own day, not the server's. lib/coros.js puts COROS
   runs into the same shape so both cards draw from one function. */
export function weekSummary(activities, sunday) {
  const days = new Array(7).fill(0);
  let total_m = 0;
  for (const a of activities) {
    if ((a.type || "") !== "Run") continue;
    const d = new Date(a.start_date_local || a.start_date);
    if (isNaN(d)) continue;
    const meters = Number(a.distance) || 0;
    days[d.getUTCDay()] += meters;
    total_m += meters;
  }
  return { start: sunday, days: days, total_m: total_m };
}

/** Which day a session name belongs to; "other" when it names no day at all. */
export function dayFromName(name) {
  const s = String(name || "").toLowerCase();
  for (const d of DAYS) if (s.includes(d)) return d;
  for (const ar of Object.keys(AR_DAYS)) if (s.includes(ar)) return AR_DAYS[ar];
  return "other";
}
