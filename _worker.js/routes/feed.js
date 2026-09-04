/* The club's news.

   Two things share this screen. Posts are what the coach writes for the club
   — a race entry closing, a change of meeting point, a result worth saying
   out loud — and they live in D1 with both languages on one row. Coach Tips
   is the other: one article at a time, already written and already loved, so
   it is read from the same KV document the session page uses rather than
   migrated into a second copy that could disagree with it. */

import { json, readBody } from "../lib/http.js";
import { uid, nowISO, refuseUnlessCoach, withMember } from "../lib/auth.js";
import { readTips } from "../lib/kv.js";
import { getSetting } from "../lib/settings.js";

const MAX = { title: 140, body: 9000, posts: 200, list: 40 };

const cleanTitle = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, MAX.title);

/** Paragraphs survive; the tabs and blank-line runs a paste brings do not. */
const cleanBody = (s) =>
  String(s || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX.body);

const publicPost = (p) => ({
  id: p.id,
  title_en: p.title_en,
  title_ar: p.title_ar,
  body_en: p.body_en,
  body_ar: p.body_ar,
  pinned: !!p.pinned,
  published_at: p.published_at,
});

/* ---------- GET /api/feed -------------------------------------------------- */

/*
 * Published posts only: a draft the coach is still writing never leaves the
 * console, the same rule the tips editor follows.
 *
 * Pinned first, then newest — and a post with a publish date in the future is
 * not published yet, which is what lets the coach write Sunday's notice on
 * Friday.
 */
export const feed = withMember(async (request, env, user) => {
  const rows = await env.DB.prepare(
    "SELECT * FROM posts WHERE published_at IS NOT NULL AND published_at <= ?" +
      " ORDER BY pinned DESC, published_at DESC LIMIT ?"
  )
    .bind(nowISO(), MAX.list)
    .all();

  // The live article, if there is one. No KV bound is not an error here — the
  // feed is still a feed without it.
  let tip = null;
  if (env.STATS) {
    try {
      const doc = await readTips(env.STATS);
      const live = doc.articles.find((a) => a && a.id === doc.liveId);
      if (live) tip = { id: live.id, updated: live.updated, en: live.en, ar: live.ar };
    } catch (e) {
      /* the posts are the point; a missing article is not worth a 500 */
    }
  }

  return json({
    posts: (rows.results || []).map(publicPost),
    tip: tip,
    whatsapp: await getSetting(env, "whatsapp_url"),
  });
});

/* ---------- POST /api/admin/posts ------------------------------------------ */

async function listAll(env) {
  const rows = await env.DB.prepare("SELECT * FROM posts ORDER BY pinned DESC, COALESCE(published_at, updated_at) DESC LIMIT ?")
    .bind(MAX.posts)
    .all();
  return (rows.results || []).map((p) => Object.assign(publicPost(p), { updated_at: p.updated_at }));
}

/*
 * One route for the whole editor. `save` with no id writes a new post; with
 * one, it updates that post. Publishing is a date, not a flag, so "post it
 * now" and "post it on Sunday morning" are the same operation.
 */
export async function adminPosts(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  const action = String(body.action || "list");

  if (action === "save") {
    const post = body.post && typeof body.post === "object" ? body.post : {};
    const title_en = cleanTitle(post.title_en);
    const title_ar = cleanTitle(post.title_ar);
    if (!title_en && !title_ar) return json({ error: "bad-title" }, 400);

    const fields = {
      title_en: title_en,
      title_ar: title_ar,
      body_en: cleanBody(post.body_en),
      body_ar: cleanBody(post.body_ar),
      pinned: post.pinned ? 1 : 0,
    };

    // `publish` is what the button says; `publish_at` is what a coach writing
    // ahead of time sets. Either way the answer is a timestamp or nothing.
    let publishedAt = null;
    if (post.publish_at) {
      const when = new Date(String(post.publish_at));
      if (isNaN(when)) return json({ error: "bad-time" }, 400);
      publishedAt = when.toISOString();
    } else if (post.publish) {
      publishedAt = nowISO();
    }

    const id = /^[A-Za-z0-9_-]{1,64}$/.test(String(post.id || "")) ? String(post.id) : null;
    const now = nowISO();
    if (id) {
      const before = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
      if (!before) return json({ error: "no-post" }, 404);
      // Unpublishing is deliberate: the editor sends publish:false with no
      // date, and that takes it off the feed rather than leaving it up.
      await env.DB.prepare(
        "UPDATE posts SET title_en = ?, title_ar = ?, body_en = ?, body_ar = ?, pinned = ?, published_at = ?, updated_at = ? WHERE id = ?"
      )
        .bind(fields.title_en, fields.title_ar, fields.body_en, fields.body_ar, fields.pinned, publishedAt, now, id)
        .run();
    } else {
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM posts").first();
      if (((n && n.n) || 0) >= MAX.posts) return json({ error: "too-many" }, 400);
      await env.DB.prepare(
        "INSERT INTO posts (id, title_en, title_ar, body_en, body_ar, pinned, published_at, created_at, updated_at)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(uid(), fields.title_en, fields.title_ar, fields.body_en, fields.body_ar, fields.pinned, publishedAt, now, now)
        .run();
    }
    return json({ posts: await listAll(env) });
  }

  if (action === "delete") {
    await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(String(body.id || "")).run();
    return json({ posts: await listAll(env) });
  }

  if (action !== "list") return json({ error: "bad-request" }, 400);
  return json({ posts: await listAll(env) });
}
