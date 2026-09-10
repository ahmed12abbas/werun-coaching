/* Who is taking which session this week.

   A coach puts themselves down for a standing slot on a date, ahead of the
   week, and every other coach sees who else did. That is all this is: a rota
   the coaches keep between themselves. It is not attendance, it is not points,
   and no athlete ever sees it — see migrations/0011_rota.sql for why it is
   its own table rather than more of `club_sessions.coach_id`.

   On the coach tier, because signing yourself up to coach is what a coach
   does. Two exceptions to "a coach may do it": you can only put *yourself*
   down, and taking somebody else off is the club's, not yours. */

import { json, readBody } from "../lib/http.js";
import { nowISO, currentUser, refuseUnlessCoach, isCoach, isAdmin } from "../lib/auth.js";
import { safeEqual } from "../lib/crypto.js";

const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/* How far either side of today a coach may sign up for. The rota is for the
   week in front of them, and the odd race block beyond it; a tick for 2031 is
   a typo, and this is the only route that writes rows a coach can create. */
const ROTA_DAYS = 90;

/* A range wide enough for any week the console can show, and small enough
   that one read stays one read: ten slots times a fortnight of coaches. */
const LIST = 500;

const shiftDate = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const inRange = (date) => date >= shiftDate(-ROTA_DAYS) && date <= shiftDate(ROTA_DAYS);

/**
 * Whether this caller may take somebody else's tick off: an admin's own
 * login, or the club password — which is nobody in particular, and so cannot
 * put anybody down, but is the club and may take anybody off.
 *
 * The password is compared here and not put through refuseUnlessAdmin(),
 * because refuseUnlessCoach() has already let this request in and already
 * charged the rate limit for any password on it. Charging it twice would
 * halve the budget for the one caller who sends a password on every call.
 */
async function adminHere(env, body, me) {
  if (isAdmin(me)) return true;
  const given = String((body && body.password) || "");
  return !!given && !!env.ADMIN_PASSWORD && (await safeEqual(given, env.ADMIN_PASSWORD));
}

/**
 * Every tick between two dates.
 *
 * Ids, not names. The week already carries the coach roster — one small read
 * it shares with the session pickers — so joining `users` here would fetch
 * the same four names a second time for every row. Same shape as coach_id;
 * see lib/coaches.js.
 *
 * The table arrived after the code that reads it, and migrations here are
 * applied by hand, so a database one release behind must still draw a week —
 * without the ticks rather than not at all.
 */
export async function rotaBetween(env, from, to) {
  try {
    const rows = await env.DB.prepare(
      "SELECT schedule_id, date, user_id, at FROM coach_rota WHERE date BETWEEN ? AND ?" +
        " ORDER BY at ASC LIMIT ?"
    )
      .bind(from, to, LIST)
      .all();
    return rows.results || [];
  } catch (e) {
    console.error("rota: could not read coach_rota (" + (e && e.message) + ")");
    return [];
  }
}

/* ---------- POST /api/coach/rota ------------------------------------------ */

const dateOr = (v, fallback) => (ISO_DATE.test(String(v || "")) ? String(v) : fallback);

/* A write to the rota, or the answer for a database that has no rota yet. */
async function rotaWrite(env, sql, ...values) {
  try {
    await env.DB.prepare(sql).bind(...values).run();
    return null;
  } catch (e) {
    console.error("rota: could not write coach_rota (" + (e && e.message) + ")");
    return json({ error: "no-table" }, 503);
  }
}

/* Only yourself, and only if you coach. An admin who does not take sessions
   has no business on the rota for one, and the club password is nobody in
   particular — it cannot say who it is putting down. */
async function join(env, tick, body, me, boss) {
  if (!isCoach(me)) return json({ error: "not-coach" }, 403);
  const slot = await env.DB.prepare("SELECT id FROM schedule WHERE id = ?").bind(tick.scheduleId).first();
  if (!slot) return json({ error: "no-entry" }, 404);
  // The primary key makes ticking twice the same as ticking once, so a double
  // tap on a cold morning cannot put anybody on twice.
  const failed = await rotaWrite(env,
    "INSERT OR IGNORE INTO coach_rota (schedule_id, date, user_id, at) VALUES (?, ?, ?, ?)",
    tick.scheduleId, tick.date, me.id, nowISO());
  return failed || json(await answerAround(env, tick.date, me, boss));
}

/* Whose tick is coming off: the one named, or the caller's own. */
function leaverFrom(body, me) {
  if (ID.test(String(body.user_id || ""))) return String(body.user_id);
  return (me && me.id) || "";
}

/* Your own tick is yours. Somebody else's is the club's — for the coach who
   put themselves down for the wrong day and has gone to bed. */
async function leave(env, tick, body, me, boss) {
  const who = leaverFrom(body, me);
  if (!who) return json({ error: "bad-request" }, 400);
  const mine = me && who === me.id;
  if (!mine && !boss) return json({ error: "not-admin" }, 403);
  const failed = await rotaWrite(env,
    "DELETE FROM coach_rota WHERE schedule_id = ? AND date = ? AND user_id = ?",
    tick.scheduleId, tick.date, who);
  return failed || json(await answerAround(env, tick.date, me, boss));
}

const WRITES = new Map([["join", join], ["leave", leave]]);

/* The slot and date a join or leave is about, or why it cannot be. */
function readTick(body) {
  const tick = { scheduleId: String(body.schedule_id || ""), date: String(body.date || "") };
  if (!ID.test(tick.scheduleId) || !ISO_DATE.test(tick.date)) return { error: "bad-request" };
  if (!inRange(tick.date)) return { error: "bad-date" };
  return tick;
}

export async function coachRota(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  const action = String(body.action || "list");
  const me = await currentUser(request, env);
  const boss = await adminHere(env, body, me);

  if (action === "list") {
    return json(await answer(env, dateOr(body.from, shiftDate(-7)), dateOr(body.to, shiftDate(14)), me, boss));
  }

  // Checked before the verb, as it always was: an unknown action with a bad
  // date still answers bad-date.
  const tick = readTick(body);
  if (tick.error) return json({ error: tick.error }, 400);
  const write = WRITES.get(action);
  return write ? write(env, tick, body, me, boss) : json({ error: "bad-request" }, 400);
}

/* The whole fortnight back, rather than the one row that changed: the page
   redraws a week from it either way, and a second request to learn what it
   already asked for is a wasted one. */
const answerAround = (env, date, me, boss) => answer(env, shiftDate(-7), shiftDate(14), me, boss);

async function answer(env, from, to, me, boss) {
  return {
    rota: await rotaBetween(env, from, to),
    // Who the page is drawing for: which tick is the reader's own, and
    // whether they may take anybody else's off. The page decides what to
    // offer from this; the route decides what to allow, on every call.
    me: me ? me.id : null,
    can_join: isCoach(me),
    can_remove: !!boss,
  };
}
