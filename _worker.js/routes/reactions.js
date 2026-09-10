/* A face on a post: 👍, 💜 or 🔥, and nothing else.

   Three because a double tap is a gesture, not a menu, and because a fixed
   list is the only way this column cannot become somebody's essay. Anything
   else arriving is refused rather than stored.

   One row per member per thing, so choosing again replaces, and choosing the
   same face again takes it back. Counts are read from the rows every time —
   see migrations/0017_reactions.sql. */

import { json, readBody } from "../lib/http.js";
import { withMember, nowISO } from "../lib/auth.js";

export const EMOJI = ["👍", "💜", "🔥"];
const TARGET = /^(post|tip):[A-Za-z0-9_-]{1,64}$/;

/**
 * Every reaction on these things, as counts plus whichever one is this
 * member's own. One read for the whole screen: the news is a handful of
 * cards, and a query per card is a query per card.
 *
 * The table arrives after the code that reads it, as always here, so a
 * database one release behind gives a news screen with no faces on it rather
 * than no news screen.
 */
export async function reactionsFor(env, user, targets) {
  if (!targets.length || !env.DB) return tally([]);
  try {
    const rows = await env.DB.prepare(
      "SELECT target, emoji, COUNT(*) AS n," +
        " MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine" +
        " FROM reactions WHERE target IN (" + targets.map(() => "?").join(", ") + ")" +
        " GROUP BY target, emoji"
    )
      .bind(user.id, ...targets)
      .all();
    return tally(rows.results || []);
  } catch (e) {
    console.error("reactions: no table yet (" + (e && e.message) + ")");
    return tally([]);
  }
}

/* The grouped rows as counts per thing, and this member's own face on each. */
function tally(rows) {
  const out = { counts: {}, mine: {} };
  for (const r of rows) {
    (out.counts[r.target] = out.counts[r.target] || {})[r.emoji] = r.n;
    if (r.mine) out.mine[r.target] = r.emoji;
  }
  return out;
}

/* ---------- POST /api/reactions ------------------------------------------- */

export const reactions = withMember(async (request, env, user) => {
  const body = await readBody(request);
  const target = String(body.target || "");
  const emoji = String(body.emoji || "");
  if (!TARGET.test(target) || !EMOJI.includes(emoji)) return json({ error: "bad-request" }, 400);

  try {
    await toggleReaction(env, target, user.id, emoji);
  } catch (e) {
    console.error("reactions: could not write (" + (e && e.message) + ")");
    return json({ error: "no-table" }, 503);
  }

  const now = await reactionsFor(env, user, [target]);
  return json({ counts: now.counts[target] || {}, mine: now.mine[target] || null });
});

/* The same face twice is taking it back; any other face replaces whatever
   this member had on it. */
async function toggleReaction(env, target, userId, emoji) {
  const had = await env.DB.prepare("SELECT emoji FROM reactions WHERE target = ? AND user_id = ?")
    .bind(target, userId)
    .first();
  if (had && had.emoji === emoji) {
    await env.DB.prepare("DELETE FROM reactions WHERE target = ? AND user_id = ?")
      .bind(target, userId)
      .run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO reactions (target, user_id, emoji, at) VALUES (?, ?, ?, ?)" +
      " ON CONFLICT(target, user_id) DO UPDATE SET emoji = excluded.emoji, at = excluded.at"
  )
    .bind(target, userId, emoji, nowISO())
    .run();
}
