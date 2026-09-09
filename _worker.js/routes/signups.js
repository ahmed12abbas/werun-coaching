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
import { withMember, nowISO } from "../lib/auth.js";

const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/* How far either side of today a name may go down. The home screen only ever
   shows this week; the extra weeks are for the athlete who plans ahead, and
   a tick for 2087 is a typo. */
const SIGNUP_DAYS = 60;

const shiftDate = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/* ---------- POST /api/signups --------------------------------------------- */

export const signups = withMember(async (request, env, user) => {
  const body = await readBody(request);
  const action = String(body.action || "");
  const scheduleId = String(body.schedule_id || "");
  const date = String(body.date || "");

  if (!ID.test(scheduleId) || !ISO_DATE.test(date)) return json({ error: "bad-request" }, 400);
  if (date < shiftDate(-SIGNUP_DAYS) || date > shiftDate(SIGNUP_DAYS)) return json({ error: "bad-date" }, 400);

  if (action === "join") {
    const slot = await env.DB.prepare("SELECT id FROM schedule WHERE id = ?").bind(scheduleId).first();
    if (!slot) return json({ error: "no-entry" }, 404);
    try {
      // The primary key makes tapping twice the same as tapping once.
      await env.DB.prepare(
        "INSERT OR IGNORE INTO session_signups (schedule_id, date, user_id, at) VALUES (?, ?, ?, ?)"
      )
        .bind(scheduleId, date, user.id, nowISO())
        .run();
    } catch (e) {
      // The table arrived after the code that writes it, and migrations here
      // are applied by hand — so say so plainly rather than five hundred.
      console.error("signups: could not write session_signups (" + (e && e.message) + ")");
      return json({ error: "no-table" }, 503);
    }
    return json({ registered: true });
  }

  if (action === "leave") {
    try {
      await env.DB.prepare(
        "DELETE FROM session_signups WHERE schedule_id = ? AND date = ? AND user_id = ?"
      )
        .bind(scheduleId, date, user.id)
        .run();
    } catch (e) {
      console.error("signups: could not write session_signups (" + (e && e.message) + ")");
      return json({ error: "no-table" }, 503);
    }
    return json({ registered: false });
  }

  return json({ error: "bad-request" }, 400);
});
