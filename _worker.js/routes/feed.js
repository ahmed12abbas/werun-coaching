/* The club's news.

   Two things share this screen. Posts are what the coach writes for the club
   — a race entry closing, a change of meeting point, a result worth saying
   out loud — and they live in D1 with both languages on one row. Coach Tips
   is the other: one article at a time, already written and already loved, so
   it is read from the same KV document the session page uses rather than
   migrated into a second copy that could disagree with it. */

import { json, readBody, objectIn, savedId } from "../lib/http.js";
import { uid, nowISO, refuseUnlessAdmin, withMember } from "../lib/auth.js";
import { readTips } from "../lib/kv.js";
import { reactionsFor } from "./reactions.js";
import { getSetting } from "../lib/settings.js";
import { hasColumn } from "../lib/columns.js";
import { storePhoto, servePhoto } from "../lib/photos.js";

const MAX = { title: 140, body: 9000, posts: 200, list: 40 };

// A post's photo: lib/photos.js, under its own prefix. photo_url is 0027 — see
// hasColumn() calls below for the window before that migration is pasted into
// the D1 console.
const IMG_PREFIX = "post-img:";

const cleanTitle = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, MAX.title);

/** Paragraphs survive; the tabs and blank-line runs a paste brings do not. */
const cleanBody = (s) =>
  String(s || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX.body);

const publicPost = (p, hasPhoto) => ({
  id: p.id,
  title_en: p.title_en,
  title_ar: p.title_ar,
  body_en: p.body_en,
  body_ar: p.body_ar,
  pinned: !!p.pinned,
  published_at: p.published_at,
  photo_url: hasPhoto ? p.photo_url || null : null,
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
  const hasPhoto = await hasColumn(env, "posts", "photo_url");
  const rows = await env.DB.prepare(
    "SELECT * FROM posts WHERE published_at IS NOT NULL AND published_at <= ?" +
      " ORDER BY pinned DESC, published_at DESC LIMIT ?"
  )
    .bind(nowISO(), MAX.list)
    .all();

  // The articles the coach has ticked for the feed, newest first. The live
  // one is always among them: it was on this screen before the tick existed,
  // and articles written back then carry no flag to read.
  //
  // No KV bound is not an error here — the feed is still a feed without it.
  let tips = [];
  if (env.STATS) {
    try {
      const doc = await readTips(env.STATS);
      // created is the day it went up and updated the day it was last
      // touched; the feed shows the first, and older articles have only the
      // second — the same fallback /api/tips makes.
      tips = doc.articles
        .filter((a) => a && (a.feed || a.id === doc.liveId))
        .map((a) => ({ id: a.id, created: a.created || a.updated, updated: a.updated, en: a.en, ar: a.ar, photo: a.photo || "" }))
        .sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
    } catch (e) {
      /* the posts are the point; a missing article is not worth a 500 */
    }
  }

  const posts = (rows.results || []).map((p) => publicPost(p, hasPhoto));
  // Every face on the screen in one read, keyed the way the page draws them.
  const faces = await reactionsFor(
    env,
    user,
    posts.map((p) => "post:" + p.id).concat(tips.map((a) => "tip:" + a.id))
  );

  return json({
    posts: posts,
    tips: tips,
    reactions: faces.counts,
    my_reactions: faces.mine,
    whatsapp: await getSetting(env, "whatsapp_url"),
  });
});

/* ---------- POST /api/admin/posts ------------------------------------------ */

async function listAll(env) {
  const hasPhoto = await hasColumn(env, "posts", "photo_url");
  const rows = await env.DB.prepare("SELECT * FROM posts ORDER BY pinned DESC, COALESCE(published_at, updated_at) DESC LIMIT ?")
    .bind(MAX.posts)
    .all();
  return (rows.results || []).map((p) => Object.assign(publicPost(p, hasPhoto), { updated_at: p.updated_at }));
}

/* `publish` is what the button says; `publish_at` is what a coach writing
   ahead of time sets. Either way the answer is a timestamp or nothing —
   and undefined for a date that will not parse. */
function publishedAtFrom(post) {
  if (post.publish_at) {
    const when = new Date(String(post.publish_at));
    return isNaN(when) ? undefined : when.toISOString();
  }
  return post.publish ? nowISO() : null;
}

function readPost(post, hasPhoto) {
  const title_en = cleanTitle(post.title_en);
  const title_ar = cleanTitle(post.title_ar);
  if (!title_en && !title_ar) return { error: "bad-title" };
  const publishedAt = publishedAtFrom(post);
  if (publishedAt === undefined) return { error: "bad-time" };
  return {
    title_en: title_en,
    title_ar: title_ar,
    body_en: cleanBody(post.body_en),
    body_ar: cleanBody(post.body_ar),
    pinned: post.pinned ? 1 : 0,
    published_at: publishedAt,
    photo_url: hasPhoto && post.photo_url ? String(post.photo_url).slice(0, 200) : null,
  };
}

async function updatePost(env, id, f, hasPhoto) {
  const before = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  if (!before) return json({ error: "no-post" }, 404);
  // Unpublishing is deliberate: the editor sends publish:false with no date,
  // and that takes it off the feed rather than leaving it up.
  const cols = "title_en = ?, title_ar = ?, body_en = ?, body_ar = ?, pinned = ?, published_at = ?, updated_at = ?" + (hasPhoto ? ", photo_url = ?" : "");
  const vals = [f.title_en, f.title_ar, f.body_en, f.body_ar, f.pinned, f.published_at, nowISO()];
  if (hasPhoto) vals.push(f.photo_url);
  vals.push(id);
  await env.DB.prepare("UPDATE posts SET " + cols + " WHERE id = ?").bind(...vals).run();
  return null;
}

async function insertPost(env, f, hasPhoto) {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM posts").first();
  if (((n && n.n) || 0) >= MAX.posts) return json({ error: "too-many" }, 400);
  const now = nowISO();
  const cols = "id, title_en, title_ar, body_en, body_ar, pinned, published_at, created_at, updated_at" + (hasPhoto ? ", photo_url" : "");
  const marks = "?, ?, ?, ?, ?, ?, ?, ?, ?" + (hasPhoto ? ", ?" : "");
  const vals = [uid(), f.title_en, f.title_ar, f.body_en, f.body_ar, f.pinned, f.published_at, now, now];
  if (hasPhoto) vals.push(f.photo_url);
  await env.DB.prepare("INSERT INTO posts (" + cols + ") VALUES (" + marks + ")").bind(...vals).run();
  return null;
}

/* `save` with no id writes a new post; with one, it updates that post.
   Publishing is a date, not a flag, so "post it now" and "post it on Sunday
   morning" are the same operation. */
async function savePost(body, env) {
  const hasPhoto = await hasColumn(env, "posts", "photo_url");
  const post = objectIn(body.post);
  const f = readPost(post, hasPhoto);
  if (f.error) return json({ error: f.error }, 400);
  const id = savedId(post);
  const failed = id ? await updatePost(env, id, f, hasPhoto) : await insertPost(env, f, hasPhoto);
  return failed || json({ posts: await listAll(env) });
}

async function deletePost(body, env) {
  await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(String(body.id || "")).run();
  return json({ posts: await listAll(env) });
}

async function listPosts(body, env) {
  return json({ posts: await listAll(env) });
}

function uploadPhoto(body, env) {
  return storePhoto(env, IMG_PREFIX, body.data, "/api/feed/img");
}

const POST_ACTIONS = new Map([["save", savePost], ["delete", deletePost], ["list", listPosts], ["upload", uploadPhoto]]);

/* One route for the whole editor. */
export async function adminPosts(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessAdmin(request, env, body);
  if (no) return no;

  const run = POST_ACTIONS.get(String(body.action || "list"));
  return run ? run(body, env) : json({ error: "bad-request" }, 400);
}

/* ---------- GET /api/feed/img?id= ------------------------------------------ */

export const feedImg = (request, env) => servePhoto(request, env, IMG_PREFIX);
