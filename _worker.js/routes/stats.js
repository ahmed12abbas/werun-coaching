/* The dashboard: how many athletes actually came, week by week.

   It used to count taps of "Share this session" — a number that said how far
   the link travelled and nothing about who ran. Check-ins are the club's real
   attendance, they are already in the database, and they are what a coach
   stands at the track counting, so the dashboard counts those instead. */

import { json, readBody } from "../lib/http.js";
import { refuseUnlessCoach } from "../lib/auth.js";
import { readFeedback } from "../lib/kv.js";
import { clubWeekStart } from "../lib/week.js";
import { FB_MAX, feedbackSummary } from "./feedback.js";

/* Roughly two months at the club's ten sessions a week — far enough back to
   see a trend, short enough to stay one small read. */
const LOOK = 80;

/**
 * Every recent session with its head count, gathered into the club's weeks.
 *
 * The count is of live check-ins only: a voided one is a check-in the coach
 * took back, and it must not still be standing in the attendance figure.
 */
export async function attendance(env) {
  const rows = await env.DB.prepare(
    "SELECT s.id, s.date, s.name, s.starts_at, s.coach_id, s.schedule_id," +
      " (SELECT COUNT(*) FROM checkins c WHERE c.session_id = s.id AND c.voided_at IS NULL) AS came" +
      " FROM club_sessions s ORDER BY s.date DESC, s.starts_at DESC LIMIT ?"
  )
    .bind(LOOK)
    .all();

  const byWeek = new Map();
  for (const row of rows.results || []) {
    const start = clubWeekStart(row.date);
    if (!start) continue;
    if (!byWeek.has(start)) byWeek.set(start, { start: start, total: 0, sessions: [] });
    const week = byWeek.get(start);
    week.sessions.push(row);
    week.total += row.came || 0;
  }
  await fillStanding(env, byWeek);

  // Newest first: the week a coach cares about is this one.
  return [...byWeek.values()].sort((a, b) => (a.start < b.start ? 1 : -1));
}

const shiftDay = (iso, n) =>
  new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/**
 * The club runs ten standing sessions a week, and most of them have no
 * `club_sessions` row until somebody shows a code — so counting rows alone
 * reports a seven-session week and hides the ones nobody scanned at. Every
 * active slot with no row on its day joins the week at nought, which is the
 * true head count for a session no one checked in to.
 *
 * A slot called off that day is left out: it did not happen, so it is not a
 * session that drew nobody. Behind a try/catch like every other read of the
 * standing week, because migrations here land after the deploy.
 */
async function fillStanding(env, byWeek) {
  if (!byWeek.size) return;
  const starts = [...byWeek.keys()].sort();
  const standing = await readStanding(env, starts[0], shiftDay(starts[starts.length - 1], 6));
  if (!standing) return;
  for (const week of byWeek.values()) fillWeek(week, standing);
}

/* The active slots and the changes between two dates, or null for a database
   that has no standing week yet. */
async function readStanding(env, from, to) {
  try {
    const [a, b] = await Promise.all([
      env.DB.prepare("SELECT id, weekday, at, title_en FROM schedule WHERE active = 1").all(),
      env.DB.prepare(
        "SELECT schedule_id, date, cancelled, at FROM schedule_changes WHERE date BETWEEN ? AND ?"
      )
        .bind(from, to)
        .all(),
    ]);
    return { slots: a.results || [], changes: b.results || [] };
  } catch (e) {
    console.error("stats: no standing schedule yet (" + (e && e.message) + ")");
    return null;
  }
}

/* Every slot on each of the week's seven days that has no session row and
   was not called off, added at nought. */
function fillWeek(week, { slots, changes }) {
  const taken = new Set(week.sessions.map((s) => s.schedule_id + "|" + s.date));
  for (let i = 0; i < 7; i++) {
    const date = shiftDay(week.start, i);
    const weekday = new Date(date + "T00:00:00Z").getUTCDay();
    for (const slot of slots) {
      if (slot.weekday !== weekday || taken.has(slot.id + "|" + date)) continue;
      const change = changes.find((c) => c.schedule_id === slot.id && c.date === date);
      if (change && change.cancelled) continue;
      week.sessions.push(unscanned(slot, date, change));
    }
  }
}

function unscanned(slot, date, change) {
  return {
    id: null,
    date: date,
    name: slot.title_en,
    // Riyadh, UTC+3 all year — the club's clock, not the server's.
    starts_at: date + "T" + ((change && change.at) || slot.at) + ":00+03:00",
    coach_id: null,
    schedule_id: slot.id,
    came: 0,
  };
}

/* ---------- POST /api/stats ---------------------------------------------- */

/*
 * The password is checked here, on the server, against a secret set on the
 * Pages project. It is never shipped in any JavaScript the site serves, which
 * is the whole reason this lives in a Worker and not in admin.html.
 *
 * POST, not GET: the password travels in the body, so it never lands in a URL,
 * a browser history entry or an edge access log.
 */
export async function stats(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  if (!env.DB) return json({ weeks: [], warning: "no-db" });

  // Both halves of the dashboard in one answer: the numbers the coach came
  // for, and what athletes actually wrote. One ask, one render.
  let said = null;
  if (env.STATS) {
    const notes = await readFeedback(env.STATS);
    said = Object.assign(feedbackSummary(notes.items), { items: notes.items.slice(0, FB_MAX.show) });
  }

  return json({ weeks: await attendance(env), feedback: said });
}
