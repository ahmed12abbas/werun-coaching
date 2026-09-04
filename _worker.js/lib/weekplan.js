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

import { coachRoster, coachNameFor } from "./coaches.js";
import { windowMinutes, windowFor } from "./checkin.js";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const validTime = (s) => HHMM.test(String(s || ""));

/* How far either side of the week on screen to look for a slot workout.
   The coach publishes the speed session a week or so ahead and replaces it
   every week, so a month reaches the current copy in either direction — and
   stops a one-off published for a race in December from becoming "the steps"
   on every Monday between now and then. */
const STEPS_DAYS = 28;

const DAY_MS = 86400000;
const shiftDay = (iso, n) =>
  new Date(Date.parse(iso + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday, from a YYYY-MM-DD written in the club's week. */
export const weekdayOf = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();

/**
 * Everything standing, plus every change and published session in the range.
 * One read each rather than one per day.
 */
export async function loadWeek(env, from, to, userId) {
  const published = await env.DB.prepare(
    "SELECT s.*, c.at AS checked_in_at, c.voided_at FROM club_sessions s" +
      " LEFT JOIN checkins c ON c.session_id = s.id AND c.user_id = ?" +
      " WHERE s.date BETWEEN ? AND ? ORDER BY s.starts_at ASC"
  )
    .bind(userId || "", from, to)
    .all();

  // The standing week arrived in a later migration than the code that reads
  // it, and this project applies migrations by hand — so a database that is
  // one release behind must still hand an athlete their week, with whatever
  // the coach has published, rather than five hundred at them. The same rule
  // the rest of the site follows for a missing binding.
  //
  // The third read is what a slot's steps are, on a day the coach has not
  // published one for: the club runs the same speed session three times a
  // week and she replaces it weekly, so an athlete opening Monday still wants
  // the workout whether or not this Monday's copy has gone out. Bounded on
  // date, which is indexed — buildDays picks the nearest of them per day.
  //
  // All three go together because all three want the same thing of the
  // database: `schedule`, `schedule_changes` and `club_sessions.schedule_id`
  // all arrived in the same migration, and this project applies migrations by
  // hand — so a database one release behind must still hand an athlete their
  // week, with whatever the coach has published, rather than five hundred at
  // them. The same rule the rest of the site follows for a missing binding.
  let schedule = [];
  let changes = [];
  let nearby = [];
  try {
    const [a, b, c] = await Promise.all([
      env.DB.prepare("SELECT * FROM schedule WHERE active = 1 ORDER BY at ASC").all(),
      env.DB.prepare("SELECT * FROM schedule_changes WHERE date BETWEEN ? AND ?").bind(from, to).all(),
      env.DB.prepare(
        "SELECT schedule_id, id, date FROM club_sessions" +
          " WHERE schedule_id IS NOT NULL AND payload <> '' AND date BETWEEN ? AND ?" +
          " ORDER BY date ASC, created_at ASC"
      )
        .bind(shiftDay(from, -STEPS_DAYS), shiftDay(to, STEPS_DAYS))
        .all(),
    ]);
    schedule = a.results || [];
    changes = b.results || [];
    nearby = c.results || [];
  } catch (e) {
    console.error("week: no standing schedule yet (" + (e && e.message) + ")");
  }

  // Outside the try above on purpose: `users` has always been there, and a
  // database still waiting for the standing-week migration should still put
  // a name on the sessions the coach has published.
  return {
    schedule: schedule,
    changes: changes,
    published: published.results || [],
    nearby: nearby,
    coaches: await coachRoster(env),
    // The club's check-in window, so buildDays can work each session's out
    // rather than read back what its row was written with.
    window: await windowMinutes(env),
  };
}

/**
 * The workout to offer for a slot on a day that has none of its own: the one
 * published closest to it, before or after.
 *
 * Nearest rather than newest, because "newest" means whatever is furthest in
 * the future — one session published for a race two months out would become
 * the steps on every intervening week. Later rows win a tie, so a re-publish
 * beats the copy it replaced.
 */
function nearestSteps(list, date) {
  if (!list || !list.length) return null;
  const want = Date.parse(date + "T00:00:00Z");
  let best = null;
  let bestGap = Infinity;
  for (const s of list) {
    const gap = Math.abs(Date.parse(s.date + "T00:00:00Z") - want);
    if (gap <= bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
}

/* The second argument is the standing entry this session was published
   against, when there was one. Its place comes along with it: the session
   carrying the workout is the one an athlete most needs the address for,
   and dropping it because a workout was attached would be backwards. */
function publishedItem(s, slot, names, mins) {
  // When check-in opens and shuts is worked out from the start and the club's
  // rule, not read back off the row — see lib/checkin.js.
  const w = windowFor(s, mins);
  return {
    kind: "session",
    id: s.id,
    schedule_id: s.schedule_id || null,
    title_en: s.name,
    title_ar: s.name,
    place_en: (slot && slot.place_en) || "",
    place_ar: (slot && slot.place_ar) || "",
    desc_en: (slot && slot.desc_en) || "",
    desc_ar: (slot && slot.desc_ar) || "",
    map_url: (slot && slot.map_url) || "",
    // Who took it — what it was published under, or the slot's usual coach.
    coach: coachNameFor(names, s.coach_id, slot && slot.coach_id),
    at: (s.starts_at || "").slice(11, 16), // as a fallback; the page uses starts_at
    starts_at: s.starts_at,
    window_open_at: w.open,
    window_close_at: w.close,
    points: s.points,
    // A session opened purely to hand out a check-in code carries no workout.
    // The week still shows it, and it still counts — there are just no steps
    // to open, and the page has to know that before it tries to decode nothing.
    has_steps: !!s.payload,
    checked_in: !!(s.checked_in_at && !s.voided_at),
    checked_in_at: s.voided_at ? null : s.checked_in_at,
  };
}

function standingItem(row, change, steps, names, mins) {
  const item = {
    kind: "standing",
    id: row.id,
    schedule_id: row.id,
    title_en: row.title_en,
    title_ar: row.title_ar,
    place_en: row.place_en,
    place_ar: row.place_ar,
    desc_en: row.desc_en || "",
    desc_ar: row.desc_ar || "",
    map_url: row.map_url,
    at: row.at,
    points: row.points,
    // A standing slot has a wall-clock time and no instant — the page that
    // knows the reader's own clock makes one. So it is handed the rule rather
    // than an answer: check-in shuts this many minutes after the start.
    window_after_min: mins ? mins.after : null,
    coach: coachNameFor(names, null, row.coach_id),
    cancelled: false,
    moved: false,
    note_en: "",
    note_ar: "",
    // Where the steps live, when the coach has published this slot before.
    steps_id: steps ? steps.id : null,
    steps_date: steps ? steps.date : null,
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
  const names = new Map();
  for (const c of data.coaches || []) names.set(c.id, c.name);

  const changeFor = new Map();
  for (const c of data.changes) changeFor.set(c.schedule_id + "|" + c.date, c);

  const publishedFor = new Map();
  for (const s of data.published) {
    const list = publishedFor.get(s.date) || [];
    list.push(s);
    publishedFor.set(s.date, list);
  }

  const slotById = new Map();
  for (const row of data.schedule) slotById.set(row.id, row);

  // Every workout published near this week, grouped by the slot it belongs
  // to. Which one a given day gets is nearestSteps()'s business, per day.
  const stepsFor = new Map();
  for (const s of data.nearby || []) {
    const list = stepsFor.get(s.schedule_id) || [];
    list.push(s);
    stepsFor.set(s.schedule_id, list);
  }

  return dates.map((date) => {
    const weekday = weekdayOf(date);
    const sessions = publishedFor.get(date) || [];
    // A slot the coach has already published a workout for shows once, as the
    // workout — not twice, as a plan and a workout.
    const taken = new Set(sessions.map((s) => s.schedule_id).filter(Boolean));

    const items = data.schedule
      .filter((row) => row.weekday === weekday && !taken.has(row.id))
      .map((row) =>
        standingItem(row, changeFor.get(row.id + "|" + date), nearestSteps(stepsFor.get(row.id), date), names, data.window)
      )
      .concat(sessions.map((x) => publishedItem(x, slotById.get(x.schedule_id), names, data.window)));

    items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { date: date, items: items };
  });
}
