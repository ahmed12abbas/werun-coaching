/* What an athlete has, and where the club stands. */

import { json, readBody } from "../lib/http.js";
import { withMember, withUser } from "../lib/auth.js";
import { totalFor, streakFor } from "../lib/points.js";
import { hasColumn } from "../lib/columns.js";
import { tooOften } from "../lib/limit.js";
import { weekStartEpoch } from "../lib/week.js";

const HISTORY = 60;
const BOARD = 50;

/* ---------- GET /api/points/me -------------------------------------------- */

/* The number, how it was arrived at, and the run they are on.

   "How it was arrived at" only goes back to this club week (Sunday, Riyadh
   time) — the total and the leaderboard stay all-time, unaffected; this list
   is the one thing that starts over. The ledger itself keeps every row
   forever (see lib/points.js); only what this query asks for changed. */
export const pointsMe = withMember(async (request, env, user) => {
  const since = new Date(weekStartEpoch().epoch * 1000).toISOString();
  // Four reads that wait on nothing but who is asking, so all four go at once.
  const [rows, attended, total, streak] = await Promise.all([
    env.DB.prepare(
      "SELECT delta, reason, note, at FROM points_ledger WHERE user_id = ? AND at >= ? ORDER BY at DESC LIMIT ?"
    )
      .bind(user.id, since, HISTORY)
      .all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND voided_at IS NULL")
      .bind(user.id)
      .first(),
    totalFor(env, user.id),
    streakFor(env, user.id),
  ]);

  return json({
    total: total,
    streak: streak,
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
const boardRow = (r, place, userId) => ({
  place: place || null,
  name: r.name,
  avatar: r.avatar || "",
  bio: r.bio || "",
  instagram: r.instagram || "",
  strava_athlete: r.strava_athlete || "",
  role: r.role !== "coach" ? "athlete" : r.is_leader ? "leader" : "coach",
  points: r.points,
  sessions: r.sessions,
  me: r.id === userId,
});

/* Runners as the club may see them, off the board included. `where` and
   `having` are only ever the literals written in this file; anything from a
   request travels in `binds`. */
async function runnerRows(env, where, binds, having, limit) {
  // Asked together: a fresh isolate has none of them cached, and each is its
  // own round trip.
  const [face, line, ig, strava] = await Promise.all([
    // Until 0007 is applied there is no column to read, and everyone is on the
    // board as their initial — which is what an empty avatar means anyway.
    hasColumn(env, "users", "avatar").then((has) => (has ? " u.avatar," : " '' AS avatar,")),
    // The line they wrote about themselves, under their name (0013, 0014), and
    // their Instagram (0015). All three are applied by hand and land after the
    // deploy that reads them, and a board that will not draw at all is a worse
    // answer than a board without the lines.
    privateColumn(env, "bio", "bio_hidden"),
    privateColumn(env, "instagram", "instagram_hidden"),
    privateColumn(env, "strava_athlete", "strava_hidden"),
  ]);
  const rows = await env.DB.prepare(
    "SELECT u.id, u.name, u.role, u.is_leader," + face + line + ig + strava + " COALESCE(SUM(p.delta), 0) AS points," +
      " (SELECT COUNT(*) FROM checkins c WHERE c.user_id = u.id AND c.voided_at IS NULL) AS sessions" +
      " FROM users u LEFT JOIN points_ledger p ON p.user_id = u.id" +
      " WHERE u.status = 'active' AND u.board_hidden = 0" + where +
      " GROUP BY u.id" + having + " ORDER BY points DESC, u.name ASC LIMIT ?"
  )
    .bind(...binds, limit)
    .all();
  return rows.results || [];
}

export const pointsBoard = withMember(async (request, env, user) => {
  const [rows, points] = await Promise.all([runnerRows(env, "", [], " HAVING points > 0", BOARD), totalFor(env, user.id)]);
  const board = rows.map((r, i) => boardRow(r, i + 1, user.id));

  return json({
    board: board,
    hidden: !!user.board_hidden,
    mine: { points: points, place: board.findIndex((r) => r.me) + 1 || null },
  });
});

/* ---------- GET /api/members/search?q= ------------------------------------ */

/*
 * A runner by name, as the board would show them — the same row, the same
 * fields kept private, and nobody who asked to be off the board. Unlike the
 * board it finds members with no points yet, which is what looking somebody
 * up is for. Capped and rate-limited: it is a read, but one a loop could use
 * to walk the membership a letter at a time.
 */
const SEARCH = 20;

export const memberSearch = withMember(async (request, env, user) => {
  const q = String(new URL(request.url).searchParams.get("q") || "").trim().slice(0, 40);
  if (q.length < 2) return json({ results: [] });
  if (env.DB && (await tooOften(env.DB, "ms", user.id, 30, 60))) return json({ error: "too-often" }, 429);

  const like = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
  const [board, rows] = await Promise.all([
    runnerRows(env, "", [], " HAVING points > 0", BOARD),
    runnerRows(env, " AND u.name LIKE ? ESCAPE '\\'", [like], "", SEARCH),
  ]);
  const place = new Map(board.map((r, i) => [r.id, i + 1]));
  return json({ results: rows.map((r) => boardRow(r, place.get(r.id), user.id)) });
});

/* ---------- POST /api/points/board-visibility ----------------------------- */

export const boardVisibility = withUser(async (request, env, user) => {
  const body = await readBody(request);
  const hidden = body.hidden ? 1 : 0;
  await env.DB.prepare("UPDATE users SET board_hidden = ? WHERE id = ?").bind(hidden, user.id).run();
  return json({ hidden: !!hidden });
});
