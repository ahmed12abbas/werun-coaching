/* The standing week, resolved against a run of dates.

   One place decides what the club is doing on a given day, because the app,
   the console and any future export must all agree — and the rule has three
   layers that have to be applied in order:

     1. the standing schedule for that weekday
     2. any change recorded against that one occurrence
     3. a published session, which wins outright: once the coach has attached
        a real workout to a slot, that is the session

   Times are local wall-clock, and the club is in one city, so a date and an
   "04:45" are combined by the page that knows the reader's clock rather than
   here. What this hands back is the date, the time as written, and what it
   is for. */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const validTime = (s) => HHMM.test(String(s || ""));

/** 0 = Sunday … 6 = Saturday, from a YYYY-MM-DD written in the club's week. */
export const weekdayOf = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();

/**
 * Everything standing, plus every change and published session in the range.
 * One read each rather than one per day.
 */
export async function loadWeek(env, from, to, userId) {
  const [schedule, changes, published] = await Promise.all([
    env.DB.prepare("SELECT * FROM schedule WHERE active = 1 ORDER BY at ASC").all(),
    env.DB.prepare("SELECT * FROM schedule_changes WHERE date BETWEEN ? AND ?").bind(from, to).all(),
    env.DB.prepare(
      "SELECT s.*, c.at AS checked_in_at, c.voided_at FROM club_sessions s" +
        " LEFT JOIN checkins c ON c.session_id = s.id AND c.user_id = ?" +
        " WHERE s.date BETWEEN ? AND ? ORDER BY s.starts_at ASC"
    )
      .bind(userId || "", from, to)
      .all(),
  ]);
  return {
    schedule: schedule.results || [],
    changes: changes.results || [],
    published: published.results || [],
  };
}

const publishedItem = (s) => ({
  kind: "session",
  id: s.id,
  schedule_id: s.schedule_id || null,
  title_en: s.name,
  title_ar: s.name,
  place_en: "",
  place_ar: "",
  map_url: "",
  at: (s.starts_at || "").slice(11, 16), // as a fallback; the page uses starts_at
  starts_at: s.starts_at,
  window_open_at: s.window_open_at,
  window_close_at: s.window_close_at,
  points: s.points,
  checked_in: !!(s.checked_in_at && !s.voided_at),
  checked_in_at: s.voided_at ? null : s.checked_in_at,
});

function standingItem(row, change) {
  const item = {
    kind: "standing",
    id: row.id,
    schedule_id: row.id,
    title_en: row.title_en,
    title_ar: row.title_ar,
    place_en: row.place_en,
    place_ar: row.place_ar,
    map_url: row.map_url,
    at: row.at,
    points: row.points,
    cancelled: false,
    moved: false,
    note_en: "",
    note_ar: "",
  };
  if (!change) return item;

  if (change.cancelled) item.cancelled = true;
  // Only the fields the change actually names: a change that moves the time
  // must not blank the place.
  if (change.at) {
    item.moved = item.at !== change.at;
    item.at = change.at;
  }
  for (const f of ["place_en", "place_ar", "map_url"]) {
    if (change[f] !== null && change[f] !== undefined && change[f] !== "") {
      if (item[f] !== change[f]) item.moved = true;
      item[f] = change[f];
    }
  }
  item.note_en = change.note_en || "";
  item.note_ar = change.note_ar || "";
  return item;
}

/**
 * Seven (or however many) days, each with what is on.
 *
 * `dates` are the calendar days the reader is looking at, in their order.
 */
export function buildDays(dates, data) {
  const changeFor = new Map();
  for (const c of data.changes) changeFor.set(c.schedule_id + "|" + c.date, c);

  const publishedFor = new Map();
  for (const s of data.published) {
    const list = publishedFor.get(s.date) || [];
    list.push(s);
    publishedFor.set(s.date, list);
  }

  return dates.map((date) => {
    const weekday = weekdayOf(date);
    const sessions = publishedFor.get(date) || [];
    // A slot the coach has already published a workout for shows once, as the
    // workout — not twice, as a plan and a workout.
    const taken = new Set(sessions.map((s) => s.schedule_id).filter(Boolean));

    const items = data.schedule
      .filter((row) => row.weekday === weekday && !taken.has(row.id))
      .map((row) => standingItem(row, changeFor.get(row.id + "|" + date)))
      .concat(sessions.map(publishedItem));

    items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { date: date, items: items };
  });
}
