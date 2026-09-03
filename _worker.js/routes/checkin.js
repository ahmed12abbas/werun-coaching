/* Scanning the code at the track. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { withUser, uid, nowISO } from "../lib/auth.js";
import { getSetting } from "../lib/settings.js";
import { slotValid } from "../lib/checkin.js";
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
export const checkin = withUser(async (request, env, user) => {
  if (!env.QR_SECRET) return json({ error: "qr-off" }, 503);
  // A per-athlete brake: scanning is cheap, but nothing here should be
  // callable in a loop.
  if (env.STATS && (await tooOften(env.STATS, "ci", user.id, 10, 60))) return json({ error: "too-often" }, 429);

  const body = await readBody(request);
  const sessionId = String(body.session || "");
  const slot = Number(body.slot);
  const sig = String(body.sig || "");
  if (!sessionId) return json({ error: "bad-code" }, 400);

  const session = await env.DB.prepare(
    "SELECT id, name, date, points, window_open_at, window_close_at FROM club_sessions WHERE id = ?"
  )
    .bind(sessionId)
    .first();
  if (!session) return json({ error: "no-session" }, 404);

  if (!(await slotValid(env.QR_SECRET, sessionId, slot, sig))) return json({ error: "stale-code" }, 403);

  const now = nowISO();
  if (now < session.window_open_at) return json({ error: "too-early" }, 403);
  if (now > session.window_close_at) return json({ error: "too-late" }, 403);

  const already = await env.DB.prepare(
    "SELECT id, voided_at FROM checkins WHERE session_id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .first();
  if (already && !already.voided_at) {
    return json({
      error: "already",
      session: session.name,
      total: await totalFor(env, user.id),
      streak: await streakFor(env, user.id),
    }, 409);
  }
  // A voided check-in is the coach's decision, not a second chance.
  if (already) return json({ error: "voided" }, 403);

  const id = uid();
  try {
    await env.DB.prepare(
      "INSERT INTO checkins (id, session_id, user_id, at, method) VALUES (?, ?, ?, ?, 'qr')"
    )
      .bind(id, sessionId, user.id, now)
      .run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return json({ error: "already" }, 409);
    throw e;
  }

  const earned = Number(session.points) || 0;
  if (earned) await addPoints(env, user.id, earned, "checkin", id, session.name);

  // The streak is counted after the row lands, so this session is in it.
  const streak = await streakFor(env, user.id);
  const every = await getSetting(env, "streak_every");
  const bonusSize = await getSetting(env, "streak_bonus");
  let bonus = 0;
  if (every > 0 && bonusSize > 0 && streak > 0 && streak % every === 0) {
    bonus = bonusSize;
    await addPoints(env, user.id, bonus, "streak", id, String(streak));
  }

  return json({
    ok: true,
    session: session.name,
    date: session.date,
    earned: earned,
    bonus: bonus,
    streak: streak,
    total: await totalFor(env, user.id),
  });
});
