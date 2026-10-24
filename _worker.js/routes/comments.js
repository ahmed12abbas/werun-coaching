/* Comments under a post or an article on the news screen.

   POST /api/comments { action: "list", target }   the thread, oldest first
   POST /api/comments { action: "add", target, text }
   POST /api/comments { action: "delete", id }   the author's own, or any for an admin

   Members only, so every name on a thread is somebody in the club. The thread
   comes back after every write, so the page draws what the server holds. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { withMember, isAdmin, nowISO, uid } from "../lib/auth.js";

const TARGET = /^(post|tip):[A-Za-z0-9_-]{1,64}$/;
const MAX = { text: 500, perThread: 300 };

/**
 * How many comments each thing has, for the feed's buttons. Like the
 * reactions, the table arrives after the code, so no table is no counts.
 */
export async function commentCounts(env, targets) {
  if (!targets.length || !env.DB) return {};
  try {
    const rows = await env.DB.prepare(
      "SELECT target, COUNT(*) AS n FROM comments WHERE target IN (" + targets.map(() => "?").join(", ") + ") GROUP BY target"
    )
      .bind(...targets)
      .all();
    const out = {};
    for (const r of rows.results || []) out[r.target] = r.n;
    return out;
  } catch (e) {
    console.error("comments: no table yet (" + (e && e.message) + ")");
    return {};
  }
}

// The author's id stays here: the page needs to know only whether it may
// offer a delete.
async function thread(env, user, target) {
  const rows = await env.DB.prepare(
    "SELECT c.id, c.body, c.at, c.user_id, u.name, u.avatar FROM comments c JOIN users u ON u.id = c.user_id" +
      " WHERE c.target = ? ORDER BY c.at LIMIT ?"
  )
    .bind(target, MAX.perThread)
    .all();
  const admin = isAdmin(user);
  return (rows.results || []).map((r) => ({
    id: r.id,
    body: r.body,
    at: r.at,
    name: r.name,
    avatar: r.avatar || "",
    mine: r.user_id === user.id,
    can_delete: r.user_id === user.id || admin,
  }));
}

export const comments = withMember(async (request, env, user) => {
  try {
    const body = await readBody(request);
    if (body.action === "list") {
      const target = String(body.target || "");
      if (!TARGET.test(target)) return json({ error: "bad-request" }, 400);
      return json({ comments: await thread(env, user, target) });
    }

    if (await tooOften(env.DB, "cm", user.id, 10, 60)) return json({ error: "too-often" }, 429);

    if (body.action === "add") {
      const target = String(body.target || "");
      const text = String(body.text || "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX.text);
      if (!TARGET.test(target) || !text) return json({ error: "bad-request" }, 400);
      const had = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE target = ?").bind(target).first();
      if (had && had.n >= MAX.perThread) return json({ error: "too-many" }, 409);
      await env.DB.prepare("INSERT INTO comments (id, target, user_id, body, at) VALUES (?, ?, ?, ?, ?)")
        .bind(uid(), target, user.id, text, nowISO())
        .run();
      return json({ comments: await thread(env, user, target) });
    }

    if (body.action === "delete") {
      const row = await env.DB.prepare("SELECT target, user_id FROM comments WHERE id = ?").bind(String(body.id || "")).first();
      if (!row) return json({ error: "not-found" }, 404);
      if (row.user_id !== user.id && !isAdmin(user)) return json({ error: "forbidden" }, 403);
      await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(String(body.id)).run();
      return json({ comments: await thread(env, user, row.target) });
    }

    return json({ error: "bad-request" }, 400);
  } catch (e) {
    console.error("comments: " + (e && e.message));
    return json({ error: "no-table" }, 503);
  }
});
