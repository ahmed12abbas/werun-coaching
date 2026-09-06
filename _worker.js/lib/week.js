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

/** Which day a session name belongs to; "other" when it names no day at all. */
export function dayFromName(name) {
  const s = String(name || "").toLowerCase();
  for (const d of DAYS) if (s.includes(d)) return d;
  for (const ar of Object.keys(AR_DAYS)) if (s.includes(ar)) return AR_DAYS[ar];
  return "other";
}
