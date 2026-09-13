/* Who says they are coming.

   An athlete puts their name down for a standing slot on a date, ahead of the
   week, and takes it off again when the morning goes wrong. That is all this
   is: their own intention, on their own home screen. It is not attendance —
   that is the check-in, and the points that follow it — and no athlete ever
   sees anybody else's. See migrations/0012_signups.sql for why it is keyed on
   the slot and the date rather than on a session id.

   Bounded on both sides: only a slot the club actually has, and only within
   a couple of months of today, so the one route an athlete can write rows
   with cannot grow past ten slots times sixty days.  */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { withMember, nowISO, isCoach } from "../lib/auth.js";

const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/* How far either side of today a name may go down. The home screen only ever
   shows this week; the extra weeks are for the athlete who plans ahead, and
   a tick for 2087 is a typo. */
const SIGNUP_DAYS = 60;

const shiftDate = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/* ---------- POST /api/signups --------------------------------------------- */

/* The slot and date a signup is about, or why it cannot be. */
function readPick(body) {
  const pick = { scheduleId: String(body.schedule_id || ""), date: String(body.date || "") };
  if (!ID.test(pick.scheduleId) || !ISO_DATE.test(pick.date)) return { error: "bad-request" };
  if (pick.date < shiftDate(-SIGNUP_DAYS) || pick.date > shiftDate(SIGNUP_DAYS)) return { error: "bad-date" };
  return pick;
}

/* A write to session_signups, or the answer for a database without it yet.
   The table arrived after the code that writes it, and migrations here are
   applied by hand — so say so plainly rather than five hundred. */
async function signupWrite(env, sql, ...values) {
  try {
    await env.DB.prepare(sql).bind(...values).run();
    return null;
  } catch (e) {
    console.error("signups: could not write session_signups (" + (e && e.message) + ")");
    return json({ error: "no-table" }, 503);
  }
}

/* A coach saying "I'm coming" here is the same yes as ticking "I am taking
   this" on /coach — so a coach's own signup carries it across, and they are
   not asked the same question twice on two screens. Best effort and after
   the signup already succeeded: a hiccup writing the rota must not undo the
   signup, and an athlete who does not coach has no rota row to write. */
async function syncRota(env, pick, user, on) {
  if (!isCoach(user)) return;
  try {
    if (on) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO coach_rota (schedule_id, date, user_id, at) VALUES (?, ?, ?, ?)"
      ).bind(pick.scheduleId, pick.date, user.id, nowISO()).run();
    } else {
      await env.DB.prepare(
        "DELETE FROM coach_rota WHERE schedule_id = ? AND date = ? AND user_id = ?"
      ).bind(pick.scheduleId, pick.date, user.id).run();
    }
  } catch (e) {
    console.error("signups: could not sync coach_rota (" + (e && e.message) + ")");
  }
}

async function join(env, pick, user) {
  const slot = await env.DB.prepare("SELECT id FROM schedule WHERE id = ?").bind(pick.scheduleId).first();
  if (!slot) return json({ error: "no-entry" }, 404);
  // The primary key makes tapping twice the same as tapping once.
  const failed = await signupWrite(env,
    "INSERT OR IGNORE INTO session_signups (schedule_id, date, user_id, at) VALUES (?, ?, ?, ?)",
    pick.scheduleId, pick.date, user.id, nowISO());
  if (failed) return failed;
  await syncRota(env, pick, user, true);
  return json({ registered: true });
}

async function leave(env, pick, user) {
  const failed = await signupWrite(env,
    "DELETE FROM session_signups WHERE schedule_id = ? AND date = ? AND user_id = ?",
    pick.scheduleId, pick.date, user.id);
  if (failed) return failed;
  await syncRota(env, pick, user, false);
  return json({ registered: false });
}

const SIGNUP_ACTIONS = new Map([["join", join], ["leave", leave]]);

export const signups = withMember(async (request, env, user) => {
  // A per-athlete brake: joining and leaving is cheap, but nothing here
  // should be callable in a loop.
  if (env.STATS && (await tooOften(env.STATS, "su2", user.id, 20, 60))) return json({ error: "too-often" }, 429);

  const body = await readBody(request);
  // Checked before the verb, as it always was: an unknown action with a bad
  // date still answers bad-date.
  const pick = readPick(body);
  if (pick.error) return json({ error: pick.error }, 400);
  const run = SIGNUP_ACTIONS.get(String(body.action || ""));
  return run ? run(env, pick, user) : json({ error: "bad-request" }, 400);
});
