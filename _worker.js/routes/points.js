/* What an athlete has, and where the club stands. */

import { json, readBody } from "../lib/http.js";
import { withUser } from "../lib/auth.js";
import { totalFor, streakFor } from "../lib/points.js";

const HISTORY = 60;
const BOARD = 50;

/* ---------- GET /api/points/me -------------------------------------------- */

/* The number, how it was arrived at, and the run they are on. */
export const pointsMe = withUser(async (request, env, user) => {
  const rows = await env.DB.prepare(
    "SELECT delta, reason, note, at FROM points_ledger WHERE user_id = ? ORDER BY at DESC LIMIT ?"
  )
    .bind(user.id, HISTORY)
    .all();
  const attended = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND voided_at IS NULL"
  )
    .bind(user.id)
    .first();

  return json({
    total: await totalFor(env, user.id),
    streak: await streakFor(env, user.id),
    sessions: (attended && attended.n) || 0,
    hidden: !!user.board_hidden,
    history: rows.results || [],
  });
});

/* ---------- GET /api/points/board ----------------------------------------- */

/*
 * Names and totals, biggest first, for anyone logged in — this is the club
 * looking at itself, not a public page. Nothing else about a member travels
 * with it: no email, no last seen, no idea who is missing, because anyone who
 * asked to be off the board should not be inferable from what is left.
 *
 * The caller's own row comes back separately, so an athlete far down a long
 * board still sees where they are without scrolling to find themselves.
 */
export const pointsBoard = withUser(async (request, env, user) => {
  const rows = await env.DB.prepare(
    "SELECT u.id, u.name, COALESCE(SUM(p.delta), 0) AS points," +
      " (SELECT COUNT(*) FROM checkins c WHERE c.user_id = u.id AND c.voided_at IS NULL) AS sessions" +
      " FROM users u LEFT JOIN points_ledger p ON p.user_id = u.id" +
      " WHERE u.status = 'active' AND u.board_hidden = 0" +
      " GROUP BY u.id HAVING points > 0 ORDER BY points DESC, u.name ASC LIMIT ?"
  )
    .bind(BOARD)
    .all();

  const board = (rows.results || []).map((r, i) => ({
    place: i + 1,
    name: r.name,
    points: r.points,
    sessions: r.sessions,
    me: r.id === user.id,
  }));

  return json({
    board: board,
    hidden: !!user.board_hidden,
    mine: { points: await totalFor(env, user.id), place: board.findIndex((r) => r.me) + 1 || null },
  });
});

/* ---------- POST /api/points/board-visibility ----------------------------- */

export const boardVisibility = withUser(async (request, env, user) => {
  const body = await readBody(request);
  const hidden = body.hidden ? 1 : 0;
  await env.DB.prepare("UPDATE users SET board_hidden = ? WHERE id = ?").bind(hidden, user.id).run();
  return json({ hidden: !!hidden });
});
