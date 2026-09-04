/* The club's calendar as the athlete sees it: a week at a time. */

import { json } from "../lib/http.js";
import { withMember } from "../lib/auth.js";
import { loadWeek, buildDays } from "../lib/weekplan.js";
import { hasColumn } from "../lib/columns.js";
import { coachNames, coachNameFor } from "../lib/coaches.js";

const DAY_MS = 86400 * 1000;
const isoDay = (d) => d.toISOString().slice(0, 10);

/* ---------- GET /api/week?start=YYYY-MM-DD ------------------------------- */

/*
 * Seven days from the Monday the page asks for — the page knows the
 * athlete's own today; the Worker's clock is in whatever region it woke up
 * in. Each day carries the published session, if any, and whether this
 * athlete has checked in to it. Nothing about anyone else.
 */
export const week = withMember(async (request, env, user) => {
  const url = new URL(request.url);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(url.searchParams.get("start") || "");
  let monday = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date();
  if (isNaN(monday)) monday = new Date();
  // Whatever day was given, the week starts on its Sunday: the club runs
  // Sunday to Thursday with Friday off, and a Monday-first week would split
  // its weekend across two screens.
  monday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - monday.getUTCDay());
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);

  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(isoDay(new Date(monday.getTime() + i * DAY_MS)));

  // The standing week, what has changed about it, and anything the coach has
  // actually published — merged in lib/weekplan.js so every caller agrees.
  const data = await loadWeek(env, dates[0], dates[6], user.id);
  return json({ start: dates[0], days: buildDays(dates, data) });
});

/* ---------- GET /api/session?id= ------------------------------------------ */

/*
 * One session in full, payload included — that is the part the app decodes
 * with js/model.js to draw the same timeline, the same typed Garmin steps
 * and the same .fit file the share link gives. Members only, because the
 * club's calendar is the club's.
 */
export const session = withMember(async (request, env, user) => {
  const id = new URL(request.url).searchParams.get("id") || "";
  // The slot's place rides along. A session the coach opened only to hand
  // out a code has no workout to draw, so where to stand is the one thing the
  // page has left to say — and dropping it there would be backwards.
  // `s.*` carries the session's own coach whether or not the column is there
  // yet; the slot's has to be named, so it is only asked for once it exists —
  // the deploy lands before the migration, and a SELECT naming a column the
  // database has not got fails outright rather than returning null.
  const slotCoach = (await hasColumn(env, "schedule", "coach_id")) ? " e.coach_id AS slot_coach_id," : "";
  const row = await env.DB.prepare(
    "SELECT s.*, c.at AS checked_in_at, c.voided_at," + slotCoach +
      " e.place_en AS place_en, e.place_ar AS place_ar, e.map_url AS map_url FROM club_sessions s" +
      " LEFT JOIN checkins c ON c.session_id = s.id AND c.user_id = ?" +
      " LEFT JOIN schedule e ON e.id = s.schedule_id" +
      " WHERE s.id = ?"
  )
    .bind(user.id, id)
    .first();
  if (!row) return json({ error: "no-session" }, 404);

  return json({
    session: {
      id: row.id,
      name: row.name,
      date: row.date,
      day: row.day,
      payload: row.payload,
      place_en: row.place_en || "",
      place_ar: row.place_ar || "",
      map_url: row.map_url || "",
      coach: coachNameFor(await coachNames(env), row.coach_id, row.slot_coach_id),
      starts_at: row.starts_at,
      window_open_at: row.window_open_at,
      window_close_at: row.window_close_at,
      points: row.points,
      checked_in: !!(row.checked_in_at && !row.voided_at),
      checked_in_at: row.voided_at ? null : row.checked_in_at,
    },
  });
});
