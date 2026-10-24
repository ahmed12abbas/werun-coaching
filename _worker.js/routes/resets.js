/* Password resets at the track.

   An athlete who has asked for a reset (the login screen's "forgot") and is
   standing in front of a coach gets it there: the coach taps their name, a
   QR appears, and the athlete scans it with their own phone and picks the
   new password on their own screen. The coach never sees or sets it.

   Guarded more tightly than the rest of the coach tier, because a reset link
   is a way into somebody else's account:
   - a coach's or leader's own login, on the rota for that session, or an
     admin — not the club password, which is nobody in particular;
   - only within a day of the session, so next month's rota tick is no key;
   - only athletes with a reset they asked for and have not used, never a
     coach or an admin (those go through /admin) — and asked for from a
     phone they have logged in on before (routes/email.js). The forgot form
     takes any address, so without that a coach could ask for somebody
     else's reset and hand it to themselves. A new phone goes through an
     admin's reset link instead;
   - the link works once, for fifteen minutes, and replaces the one they
     were mailed, so there are never two ways in. */

import { json, readBody } from "../lib/http.js";
import { nowISO, currentUser, isCoach, isAdmin } from "../lib/auth.js";
import { tooOften } from "../lib/limit.js";
import { shiftDate } from "../lib/week.js";
import { resetLinkFor, RESET_ASK } from "./email.js";

const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const QR_LIFE = 15 * 60 * 1000;
const LIST = 50;

/* Athletes waiting on a reset they asked for from their own phone — `one`
   narrows it to a single id. */
async function waiting(env, one) {
  if (!env.STATS) return [];
  const asked = one
    ? (await env.STATS.get(RESET_ASK + one)) ? [one] : []
    : (await env.STATS.list({ prefix: RESET_ASK, limit: LIST })).keys.map((k) => k.name.slice(RESET_ASK.length));
  if (!asked.length) return [];
  const rows = await env.DB.prepare(
    "SELECT DISTINCT u.id, u.name FROM users u JOIN email_tokens t ON t.user_id = u.id" +
      " WHERE t.purpose = 'reset' AND t.used_at IS NULL AND t.expires_at > ?" +
      " AND u.status = 'active' AND u.role <> 'coach' AND u.is_admin = 0" +
      " AND u.id IN (" + asked.map(() => "?").join(", ") + ")" +
      " ORDER BY u.name LIMIT ?"
  )
    .bind(nowISO(), ...asked, LIST)
    .all();
  return rows.results || [];
}

async function onRota(env, me, slot, date) {
  const row = await env.DB.prepare("SELECT 1 FROM coach_rota WHERE schedule_id = ? AND date = ? AND user_id = ?")
    .bind(slot, date, me.id)
    .first();
  return !!row;
}

export async function coachResets(request, env) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  const body = await readBody(request);
  const me = await currentUser(request, env);
  if (!isCoach(me) && !isAdmin(me)) return json({ error: "not-coach" }, 403);

  const slot = String(body.schedule_id || "");
  const date = String(body.date || "");
  if (!ID.test(slot) || !ISO_DATE.test(date)) return json({ error: "bad-request" }, 400);
  if (!isAdmin(me)) {
    if (date < shiftDate(-1) || date > shiftDate(1)) return json({ error: "not-today" }, 403);
    if (!(await onRota(env, me, slot, date))) return json({ error: "not-on-rota" }, 403);
  }

  if ((body.action || "list") === "list") return json({ waiting: await waiting(env) });

  if (body.action !== "qr") return json({ error: "bad-request" }, 400);
  const id = String(body.user_id || "");
  if (!ID.test(id)) return json({ error: "bad-request" }, 400);
  if (await tooOften(env.DB, "cr", me.id, 10, 3600)) return json({ error: "too-often" }, 429);
  const [who] = await waiting(env, id);
  if (!who) return json({ error: "no-reset" }, 404);
  await env.STATS.delete(RESET_ASK + who.id); // one hand-over per ask
  // Who handed whom a way in, for the Pages log: the one record of it.
  console.log("reset qr: coach " + me.id + " for athlete " + who.id + " at " + slot + " " + date);
  return json({ name: who.name, link: await resetLinkFor(env, request, who.id, QR_LIFE) });
}
