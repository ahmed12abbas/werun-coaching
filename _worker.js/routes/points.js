/* What an athlete has, and where the club stands. */

import { json, readBody } from "../lib/http.js";
import { withMember, withUser } from "../lib/auth.js";
import { totalFor, streakFor } from "../lib/points.js";
import { hasColumn } from "../lib/columns.js";

const HISTORY = 60;
const BOARD = 50;

/* ---------- GET /api/points/me -------------------------------------------- */

/* The number, how it was arrived at, and the run they are on. */
export const pointsMe = withMember(async (request, env, user) => {
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
/*
 * A column a member may keep to themselves, as its piece of the SELECT: ''
 * before the migration that adds it has landed, the value blanked for anyone
 * who has hidden it, and the value itself otherwise. `col` and `hiddenCol`
 * are only ever the names written below, never anything from a request.
 *
 * Hidden is decided here, in the SELECT, and not in the page: the row that
 * reaches the browser has to be the row the club is allowed to read, or
 * "hidden" only means "hidden from anyone who does not open the network tab".
 * Being on the board and keeping a line to yourself are two separate answers
 * — board_hidden takes the whole row away, this takes one field off it.
 */
async function privateColumn(env, col, hiddenCol) {
  if (!(await hasColumn(env, "users", col))) return " '' AS " + col + ",";
  if (await hasColumn(env, "users", hiddenCol)) {
    return " CASE WHEN u." + hiddenCol + " = 1 THEN '' ELSE u." + col + " END AS " + col + ",";
  }
  return " u." + col + ",";
}

/* One place on the board: who, how many points, and whether it is the reader. */
const boardRow = (r, i, userId) => ({
  place: i + 1,
  name: r.name,
  avatar: r.avatar || "",
  bio: r.bio || "",
  instagram: r.instagram || "",
  strava_athlete: r.strava_athlete || "",
  points: r.points,
  sessions: r.sessions,
  me: r.id === userId,
});

export const pointsBoard = withMember(async (request, env, user) => {
  // Until 0007 is applied there is no column to read, and everyone is on the
  // board as their initial — which is what an empty avatar means anyway.
  const face = (await hasColumn(env, "users", "avatar")) ? " u.avatar," : " '' AS avatar,";
  // The line they wrote about themselves, under their name (0013, 0014), and
  // their Instagram (0015). All three are applied by hand and land after the
  // deploy that reads them, and a board that will not draw at all is a worse
  // answer than a board without the lines.
  const line = await privateColumn(env, "bio", "bio_hidden");
  const ig = await privateColumn(env, "instagram", "instagram_hidden");
  const strava = await privateColumn(env, "strava_athlete", "strava_hidden");
  const rows = await env.DB.prepare(
    "SELECT u.id, u.name," + face + line + ig + strava + " COALESCE(SUM(p.delta), 0) AS points," +
      " (SELECT COUNT(*) FROM checkins c WHERE c.user_id = u.id AND c.voided_at IS NULL) AS sessions" +
      " FROM users u LEFT JOIN points_ledger p ON p.user_id = u.id" +
      " WHERE u.status = 'active' AND u.board_hidden = 0" +
      " GROUP BY u.id HAVING points > 0 ORDER BY points DESC, u.name ASC LIMIT ?"
  )
    .bind(BOARD)
    .all();

  const board = (rows.results || []).map((r, i) => boardRow(r, i, user.id));

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
