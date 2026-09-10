/* Scanning the code at the track. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { withMember, uid, nowISO } from "../lib/auth.js";
import { getSetting } from "../lib/settings.js";
import { slotValid, windowMinutes, windowFor } from "../lib/checkin.js";
import { addPoints, totalFor, streakFor } from "../lib/points.js";

/* ---------- POST /api/checkin --------------------------------------------- */

/*
 * Everything that has to be true, in the order that tells the athlete the
 * most useful thing first: the code is real, it is recent, the session is
 * open, and they have not already been counted.
 *
 * The unique index on (session_id, user_id) is what actually enforces the
 * last one — two taps landing together both pass the read and one loses at
 * the insert, which is the right answer rather than a race worth locking for.
 */
/* The code as the scanner read it off the coach's screen. */
const readCode = (body) => ({
  sessionId: String(body.session || ""),
  slot: Number(body.slot),
  sig: String(body.sig || ""),
});

async function findSession(env, id) {
  return env.DB.prepare(
    "SELECT id, name, date, points, starts_at, window_open_at, window_close_at FROM club_sessions WHERE id = ?"
  )
    .bind(id)
    .first();
}

/* Worked out from the start and the club's two numbers, not read back off the
   row: the window is a rule, and a rule that has been widened has to apply to
   the sessions already on the calendar as well. */
async function outsideWindow(env, session, now) {
  const w = windowFor(session, await windowMinutes(env));
  if (now < w.open) return "too-early";
  if (now > w.close) return "too-late";
  return null;
}

/* The answer for somebody already on this session's roster, or null. */
async function repeatAnswer(env, user, session) {
  const already = await env.DB.prepare(
    "SELECT id, voided_at FROM checkins WHERE session_id = ? AND user_id = ?"
  )
    .bind(session.id, user.id)
    .first();
  if (!already) return null;
  // A voided check-in is the coach's decision, not a second chance.
  if (already.voided_at) return json({ error: "voided" }, 403);
  return json({
    error: "already",
    session: session.name,
    total: await totalFor(env, user.id),
    streak: await streakFor(env, user.id),
  }, 409);
}

/* Two taps landing together both pass the read above; the unique index makes
   one of them lose here, and losing is "already", not an error. */
async function insertCheckin(env, id, sessionId, userId, now) {
  try {
    await env.DB.prepare(
      "INSERT INTO checkins (id, session_id, user_id, at, method) VALUES (?, ?, ?, ?, 'qr')"
    )
      .bind(id, sessionId, userId, now)
      .run();
    return null;
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return json({ error: "already" }, 409);
    throw e;
  }
}

async function streakBonus(env, userId, id, streak) {
  const every = await getSetting(env, "streak_every");
  const size = await getSetting(env, "streak_bonus");
  if (!(every > 0 && size > 0 && streak > 0 && streak % every === 0)) return 0;
  await addPoints(env, userId, size, "streak", id, String(streak));
  return size;
}

/* Points for turning up, and the streak bonus if this one completes a run.
   The streak is counted after the row lands, so this session is in it. */
async function award(env, userId, session, id) {
  const earned = Number(session.points) || 0;
  if (earned) await addPoints(env, userId, earned, "checkin", id, session.name);
  const streak = await streakFor(env, userId);
  const bonus = await streakBonus(env, userId, id, streak);
  return { earned, bonus, streak };
}

export const checkin = withMember(async (request, env, user) => {
  if (!env.QR_SECRET) return json({ error: "qr-off" }, 503);
  // A per-athlete brake: scanning is cheap, but nothing here should be
  // callable in a loop.
  if (env.STATS && (await tooOften(env.STATS, "ci", user.id, 10, 60))) return json({ error: "too-often" }, 429);

  const code = readCode(await readBody(request));
  if (!code.sessionId) return json({ error: "bad-code" }, 400);

  const session = await findSession(env, code.sessionId);
  if (!session) return json({ error: "no-session" }, 404);
  if (!(await slotValid(env.QR_SECRET, code.sessionId, code.slot, code.sig))) return json({ error: "stale-code" }, 403);

  const now = nowISO();
  const shut = await outsideWindow(env, session, now);
  if (shut) return json({ error: shut }, 403);

  const repeat = await repeatAnswer(env, user, session);
  if (repeat) return repeat;

  const id = uid();
  const clash = await insertCheckin(env, id, code.sessionId, user.id, now);
  if (clash) return clash;

  const got = await award(env, user.id, session, id);
  return json({
    ok: true,
    session: session.name,
    date: session.date,
    earned: got.earned,
    bonus: got.bonus,
    streak: got.streak,
    total: await totalFor(env, user.id),
  });
});
