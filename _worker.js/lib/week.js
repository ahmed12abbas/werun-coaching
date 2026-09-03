/* Weeks and days, the way the club counts them: ISO weeks, Monday first. */

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
 * ISO-8601 week, e.g. "2026-W36". ISO weeks start on Monday, which is what a
 * coach means by "this week" when the week's sessions are Monday and Thursday.
 */
export function isoWeek(d) {
  // Shift to this week's Thursday: the year that Thursday falls in is, by
  // definition, the ISO week-numbering year.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((t - firstThursday) / (7 * 24 * 3600 * 1000));
  return t.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}

/** Monday's date for an ISO week, so the dashboard can show a real date. */
export function weekStart(isoWeekStr) {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeekStr);
  if (!m) return null;
  const jan4 = new Date(Date.UTC(+m[1], 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (+m[2] - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

/** Which day a session name belongs to; "other" when it names no day at all. */
export function dayFromName(name) {
  const s = String(name || "").toLowerCase();
  for (const d of DAYS) if (s.includes(d)) return d;
  for (const ar of Object.keys(AR_DAYS)) if (s.includes(ar)) return AR_DAYS[ar];
  return "other";
}
