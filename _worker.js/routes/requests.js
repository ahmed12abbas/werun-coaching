/* An athlete who was there but could not scan, counted on an admin's say-so.

   A coach or leader asks from the session's "Who came" list on /coach: who,
   and why. Nothing is counted until an admin approves it on /admin, and then
   it is a real check-in (method 'manual') earning what a scan would have —
   the same award(), so the streak and a later void work as they always do.
   See migrations/0033_point_requests.sql. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { uid, nowISO, currentUser, refuseUnlessCoach, refuseUnlessAdmin, isCoach } from "../lib/auth.js";
import { award } from "../lib/points.js";

const REASON_MAX = 300;
const FIND = 20;
const LIST = 100;

/* Before 0033 is applied there is no table: the reads say so rather than
   a 500, and the page shows the line instead of the list. */
async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return json({ error: "no-table" }, 503);
    throw e;
  }
}

const SELECT =
  "SELECT r.id, r.session_id, r.user_id, r.reason, r.status, r.at, r.decided_at," +
  " u.name AS athlete, a.name AS asked_by_name, s.name AS session_name, s.date AS session_date" +
  " FROM point_requests r JOIN users u ON u.id = r.user_id" +
  " LEFT JOIN users a ON a.id = r.asked_by JOIN club_sessions s ON s.id = r.session_id";

/* ---------- POST /api/coach/point-requests -------------------------------- */

/*
 * `find` — athletes by name, for the picker: id and name only, the same two a
 *          roster already shows a coach.
 * `ask`  — one request: session, user, reason. Needs a coach's own login,
 *          because the club password is nobody and cannot say who asked.
 * `list` — the requests on one session, so the coach sees what became of them.
 */
export async function coachRequests(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;
  const action = String(body.action || "list");
  const session = String(body.session || "");

  if (action === "find") return json({ results: await findAthletes(env, String(body.q || "")) });
  if (!session) return json({ error: "bad-request" }, 400);

  return guarded(async () => {
    if (action === "ask") {
      const refused = await ask(request, env, body, session);
      if (refused) return refused;
    } else if (action !== "list") {
      return json({ error: "bad-request" }, 400);
    }
    const rows = await env.DB.prepare(SELECT + " WHERE r.session_id = ? ORDER BY r.at DESC LIMIT ?")
      .bind(session, LIST)
      .all();
    return json({ requests: rows.results || [] });
  });
}

async function findAthletes(env, raw) {
  const q = raw.trim().slice(0, 40);
  if (q.length < 2) return [];
  const like = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
  const rows = await env.DB.prepare(
    "SELECT id, name FROM users WHERE status = 'active' AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?"
  )
    .bind(like, FIND)
    .all();
  return rows.results || [];
}

/* Null once the request is in, or the refusal. */
async function ask(request, env, body, sessionId) {
  const me = await currentUser(request, env);
  if (!isCoach(me)) return json({ error: "coach-login" }, 403);
  if (await tooOften(env.DB, "pr", me.id, 30, 3600)) return json({ error: "too-often" }, 429);

  const userId = String(body.user || "");
  const reason = String(body.reason || "").trim().slice(0, REASON_MAX);
  if (!userId || !reason) return json({ error: "bad-request" }, 400);

  const [session, athlete, already] = await Promise.all([
    env.DB.prepare("SELECT id, starts_at FROM club_sessions WHERE id = ?").bind(sessionId).first(),
    env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").bind(userId).first(),
    env.DB.prepare("SELECT id FROM checkins WHERE session_id = ? AND user_id = ?").bind(sessionId, userId).first(),
  ]);
  if (!session) return json({ error: "no-session" }, 404);
  if (!athlete) return json({ error: "no-member" }, 404);
  // A session that has not started yet is one they can still scan at.
  if (session.starts_at > nowISO()) return json({ error: "not-yet" }, 409);
  // Scanned (or voided, which was the coach's call) — nothing to ask for.
  if (already) return json({ error: "already" }, 409);

  try {
    await env.DB.prepare(
      "INSERT INTO point_requests (id, session_id, user_id, asked_by, reason, at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(uid(), sessionId, userId, me.id, reason, nowISO())
      .run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return json({ error: "asked" }, 409);
    throw e;
  }
  return null;
}

/* ---------- POST /api/admin/point-requests -------------------------------- */

/* No action is the list: everything pending, and the last few decided so a
   mis-tap is visible. `approve` and `reject` decide one and answer the list. */
export async function adminRequests(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessAdmin(request, env, body);
  if (no) return no;
  const action = String(body.action || "");

  return guarded(async () => {
    if (action === "approve" || action === "reject") {
      const refused = await decide(request, env, String(body.id || ""), action === "approve");
      if (refused) return refused;
    } else if (action) {
      return json({ error: "bad-request" }, 400);
    }
    const [pending, done] = await Promise.all([
      env.DB.prepare(SELECT + " WHERE r.status = 'pending' ORDER BY r.at ASC LIMIT ?").bind(LIST).all(),
      env.DB.prepare(SELECT + " WHERE r.status <> 'pending' ORDER BY r.decided_at DESC LIMIT 10").all(),
    ]);
    return json({ pending: pending.results || [], decided: done.results || [] });
  });
}

async function decide(request, env, id, yes) {
  const row = await env.DB.prepare("SELECT * FROM point_requests WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "no-request" }, 404);
  if (row.status !== "pending") return json({ error: "decided" }, 409);

  const me = await currentUser(request, env);
  const by = (me && me.id) || "password";
  // Claimed first, and only if still pending: two admins tapping Approve at
  // once must not count the athlete twice.
  const claim = await env.DB.prepare(
    "UPDATE point_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'"
  )
    .bind(yes ? "approved" : "rejected", by, nowISO(), id)
    .run();
  if (!claim.meta || !claim.meta.changes) return json({ error: "decided" }, 409);
  if (!yes) return null;

  const session = await env.DB.prepare("SELECT id, name, points, starts_at FROM club_sessions WHERE id = ?")
    .bind(row.session_id)
    .first();
  const checkinId = uid();
  try {
    // At the session's start, so it sits where a scan would have in the history.
    await env.DB.prepare(
      "INSERT INTO checkins (id, session_id, user_id, at, method) VALUES (?, ?, ?, ?, 'manual')"
    )
      .bind(checkinId, row.session_id, row.user_id, session.starts_at)
      .run();
  } catch (e) {
    // They scanned after all, between the ask and the yes: already counted.
    if (/UNIQUE/i.test(String(e && e.message))) return null;
    throw e;
  }
  await award(env, row.user_id, session, checkinId);
  return null;
}
