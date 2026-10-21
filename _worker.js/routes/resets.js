/* Password reset requests, handed to the coaches.

   An athlete asks from the app's "Forgotten your password?" form; the row is
   in reset_requests (migrations/0035_reset_requests.sql). A coach sees the
   open ones on /coach and sends the same one-time link /admin's "Reset link"
   makes (resetLinkFor in routes/email.js): it works once, for 24 hours, and
   it is the athlete who chooses the new password. Nobody on staff ever sees
   or sets one.

   Narrower than /admin's button on purpose. A coach can only answer a request
   the athlete actually made, only for an athlete — never for another coach or
   an admin, which would be a way to take over an account above their own —
   and only from their own login, so `handled_by` says who sent each link. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { uid, nowISO, currentUser, refuseUnlessCoach, isCoach, isAdmin } from "../lib/auth.js";
import { resetLinkFor } from "./email.js";

// A request older than this is stale: the athlete has either found their way
// back in or asked again, and asking again is cheap.
const OPEN_DAYS = 7;
// Handled ones stay on the list for a day, so a second coach sees it is done.
const DONE_HOURS = 24;
const LIST = 50;

const ago = (ms) => new Date(Date.now() - ms).toISOString();

/* Before 0035 is applied there is no table: say so, and the tile stays away. */
async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return json({ error: "no-table" }, 503);
    throw e;
  }
}

/* Called from routes/email.js when an athlete asks. One open request per
   athlete: asking twice does not put them on the list twice. Never throws —
   the athlete's answer must not change with whether this worked, or the form
   would say which addresses have accounts. */
export async function recordResetRequest(env, user) {
  try {
    const open = await env.DB.prepare(
      "SELECT id FROM reset_requests WHERE user_id = ? AND handled_at IS NULL AND at > ?"
    )
      .bind(user.id, ago(OPEN_DAYS * 864e5))
      .first();
    if (open) return;
    await env.DB.prepare("INSERT INTO reset_requests (id, user_id, at) VALUES (?, ?, ?)")
      .bind(uid(), user.id, nowISO())
      .run();
  } catch (e) {
    console.error("resets: could not record (" + (e && e.message) + ")");
  }
}

/* What a coach may answer: an athlete, active, not staff. The same rule is the
   list's filter and the link's guard, so nothing listed is refused. */
const ANSWERABLE = "u.status = 'active' AND u.role = 'athlete' AND COALESCE(u.is_admin, 0) = 0";

async function list(env) {
  const open = await env.DB.prepare(
    "SELECT r.id, r.at, u.name FROM reset_requests r JOIN users u ON u.id = r.user_id" +
      " WHERE r.handled_at IS NULL AND r.at > ? AND " + ANSWERABLE +
      " ORDER BY r.at DESC LIMIT ?"
  )
    .bind(ago(OPEN_DAYS * 864e5), LIST)
    .all();
  const done = await env.DB.prepare(
    "SELECT r.id, r.at, r.outcome, r.handled_at, u.name, h.name AS handled_by_name" +
      " FROM reset_requests r JOIN users u ON u.id = r.user_id LEFT JOIN users h ON h.id = r.handled_by" +
      " WHERE r.handled_at > ? ORDER BY r.handled_at DESC LIMIT ?"
  )
    .bind(ago(DONE_HOURS * 3600e3), LIST)
    .all();
  return { open: open.results || [], done: done.results || [] };
}

/* ---------- POST /api/coach/resets ---------------------------------------- */

/*
 * `list`    — the open requests, and the last day's handled ones.
 * `link`    — mint the athlete's one-time link and mark the request sent.
 *             Answers the link for the coach to pass on, and the fresh list.
 * `dismiss` — not them, or already sorted: mark it and answer the list.
 *
 * `link` and `dismiss` need a coach's or admin's own login. The club password
 * is nobody in particular, and every link sent has to have a name on it.
 */
export async function coachResets(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;
  const action = String(body.action || "list");

  return guarded(async () => {
    if (action === "list") return json(await list(env));
    if (action !== "link" && action !== "dismiss") return json({ error: "bad-request" }, 400);

    const me = await currentUser(request, env);
    if (!isCoach(me) && !isAdmin(me)) return json({ error: "coach-login" }, 403);
    if (await tooOften(env.DB, "rs", me.id, 20, 3600)) return json({ error: "too-often" }, 429);

    const id = String(body.id || "");
    if (!id) return json({ error: "bad-request" }, 400);
    const row = await env.DB.prepare(
      "SELECT r.id, r.user_id, r.handled_at FROM reset_requests r JOIN users u ON u.id = r.user_id" +
        " WHERE r.id = ? AND " + ANSWERABLE
    )
      .bind(id)
      .first();
    if (!row) return json({ error: "no-request" }, 404);
    // Two coaches tapping at once: the second is told, rather than sending a
    // second link that quietly kills the first one's.
    if (row.handled_at) return json({ error: "handled" }, 409);

    const outcome = action === "link" ? "sent" : "dismissed";
    const marked = await env.DB.prepare(
      "UPDATE reset_requests SET handled_by = ?, handled_at = ?, outcome = ? WHERE id = ? AND handled_at IS NULL"
    )
      .bind(me.id, nowISO(), outcome, id)
      .run();
    if (marked.meta && marked.meta.changes === 0) return json({ error: "handled" }, 409);

    const out = await list(env);
    if (outcome === "sent") out.link = await resetLinkFor(env, request, row.user_id);
    return json(out);
  });
}
