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
    "SELECT s.id, s.date, s.name, s.starts_at, s.coach_id," +
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
  // Newest first: the week a coach cares about is this one.
  return [...byWeek.values()].sort((a, b) => (a.start < b.start ? 1 : -1));
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
