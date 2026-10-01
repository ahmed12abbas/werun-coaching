/* Points are a ledger, never a running total kept somewhere and edited.

   Every change is a row: a check-in, a streak bonus, a coach's adjustment,
   the reversal of a voided check-in. What an athlete has is the sum of their
   rows, which means the history always explains the number, and taking
   something back is another row rather than a rewrite. */

import { uid, nowISO } from "./auth.js";
import { getSetting } from "./settings.js";

export async function addPoints(env, userId, delta, reason, refId, note) {
  await env.DB.prepare(
    "INSERT INTO points_ledger (id, user_id, delta, reason, ref_id, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(uid(), userId, Math.round(delta), reason, refId || null, note || null, nowISO())
    .run();
}

export async function totalFor(env, userId) {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(delta), 0) AS n FROM points_ledger WHERE user_id = ?")
    .bind(userId)
    .first();
  return (row && row.n) || 0;
}

/**
 * How many published sessions in a row, counting back from the most recent
 * one that has already started, this athlete has been at.
 *
 * Sessions that have not happened yet cannot break a streak, and neither can
 * a voided check-in count towards one. Twenty sessions back is about two
 * months of a two-a-week club — further than any bonus reaches.
 */
export async function streakFor(env, userId) {
  const rows = await env.DB.prepare(
    "SELECT s.id, c.at AS came, c.voided_at FROM club_sessions s" +
      " LEFT JOIN checkins c ON c.session_id = s.id AND c.user_id = ?" +
      " WHERE s.starts_at <= ? ORDER BY s.starts_at DESC LIMIT 20"
  )
    .bind(userId, nowISO())
    .all();

  let streak = 0;
  for (const r of rows.results || []) {
    if (!r.came || r.voided_at) break;
    streak++;
  }
  return streak;
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
export async function award(env, userId, session, id) {
  const earned = Number(session.points) || 0;
  if (earned) await addPoints(env, userId, earned, "checkin", id, session.name);
  const streak = await streakFor(env, userId);
  const bonus = await streakBonus(env, userId, id, streak);
  return { earned, bonus, streak };
}
