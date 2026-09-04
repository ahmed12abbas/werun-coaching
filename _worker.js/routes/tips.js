/* The coach's corner: the articles, the one that is live, and the editor.

   One KV value holds every article the coach has written plus which one is
   currently live:

     { v: 1, liveId: "k3f9…", articles: [ { id, updated, en:{…}, ar:{…} } ] }

   Keeping the drafts server-side rather than only the live one is the whole
   point of the editor: a coach can rotate an old article back in front of
   athletes without typing it again. */

import { json, readBody } from "../lib/http.js";
import { safeEqual, guessingTooOften } from "../lib/crypto.js";
import { currentUser } from "../lib/auth.js";
import { TIPS_KEY, readTips } from "../lib/kv.js";

/* Bounds on what the editor may store. Generous for a coach writing a few
   paragraphs, small enough that one KV value cannot grow into the value size
   limit or make the public read slow. */
const TIP_MAX = { articles: 60, title: 140, body: 9000 };

/** Trim one language's half of an article to something safe to store. */
function cleanSide(side) {
  const s = side && typeof side === "object" ? side : {};
  return {
    title: String(s.title || "").trim().slice(0, TIP_MAX.title),
    // Tabs and stray \r from a paste out of Word would survive into the
    // paragraph splitter and show up as blank lines on the page.
    body: String(s.body || "").replace(/\r\n?/g, "\n").replace(/\t/g, " ").trim().slice(0, TIP_MAX.body),
  };
}

/**
 * One article, trimmed to what is safe to store, against what is already
 * there under the same id.
 *
 * Timestamps are never taken from the request — a client could say anything.
 * `created` carries over from the stored copy, and `updated` moves only when
 * this article's own text actually changed. The editor posts the whole
 * collection on every save, so without that comparison one edit would restamp
 * every other article and "updated" would mean nothing at all.
 */
function cleanArticle(raw, prev) {
  const a = raw && typeof raw === "object" ? raw : {};
  const id = /^[A-Za-z0-9_-]{1,40}$/.test(String(a.id || "")) ? String(a.id) : null;
  const en = cleanSide(a.en);
  const ar = cleanSide(a.ar);
  const now = new Date().toISOString();

  const unchanged =
    prev &&
    prev.en &&
    prev.ar &&
    prev.en.title === en.title &&
    prev.en.body === en.body &&
    prev.ar.title === ar.title &&
    prev.ar.body === ar.body;

  return {
    id: id || "a" + Math.random().toString(36).slice(2, 10),
    // Articles written before this field existed fall back to their last known
    // edit, which is the closest thing to a posting date they have.
    created: (prev && (prev.created || prev.updated)) || now,
    updated: unchanged ? prev.updated || now : now,
    en: en,
    ar: ar,
  };
}

/* ---------- GET /api/tips ------------------------------------------------ */

/*
 * Public, and deliberately narrow: it answers with the one live article and
 * nothing else. The drafts the coach is still working on never leave the
 * password-gated side, so an unfinished article cannot be read off the API
 * before she puts it live.
 */
export async function tips(request, env) {
  if (!env.STATS) return json({ article: null });

  const doc = await readTips(env.STATS);
  const live = doc.articles.find((a) => a && a.id === doc.liveId) || null;
  if (!live) return json({ article: null });

  return json({
    article: {
      id: live.id,
      created: live.created || live.updated,
      updated: live.updated,
      en: live.en,
      ar: live.ar,
    },
  });
}

/* ---------- POST /api/tips-admin ----------------------------------------- */

/**
 * Either password opens the articles: the coach's own, or the club password,
 * which is the owner's key to everything and is the one /admin already holds
 * — that is what lets the dashboard show the articles without the coach's
 * password being copied into a second page.
 *
 * Every candidate is compared even after one matches, so the time taken says
 * nothing about which of the two it was, or whether both are set.
 */
async function tipsAllows(given, env) {
  let ok = false;
  for (const secret of [env.TIPS_PASSWORD, env.ADMIN_PASSWORD]) {
    if (secret && (await safeEqual(given, secret))) ok = true;
  }
  return ok;
}

/** A coach who is logged in needs neither password. */
async function isCoach(request, env) {
  if (!env.DB) return false;
  const user = await currentUser(request, env);
  return !!(user && user.role === "coach" && user.status !== "blocked");
}

/*
 * The editor behind /tips, and the read-only view of the same articles on
 * /admin. Same shape as /api/stats — password in the body, checked here
 * against secrets the site never ships.
 */
export async function tipsAdmin(request, env) {
  const body = await readBody(request);
  if (!(await isCoach(request, env))) {
    if (!env.TIPS_PASSWORD && !env.ADMIN_PASSWORD) {
      return json({ error: "not-configured" }, 503);
    }
    const slow = await guessingTooOften(request, env);
    if (slow) return slow;
    if (!(await tipsAllows(String((body && body.password) || ""), env))) {
      return json({ error: "bad-password" }, 401);
    }
  }

  if (!env.STATS) return json({ liveId: null, articles: [], warning: "no-store" });

  // No `save` key means "just let me in and show me what is there".
  if (!body.save || typeof body.save !== "object") {
    const doc = await readTips(env.STATS);
    return json({ liveId: doc.liveId, articles: doc.articles });
  }

  const incoming = Array.isArray(body.save.articles) ? body.save.articles : [];
  if (incoming.length > TIP_MAX.articles) return json({ error: "too-many" }, 400);

  // The editor sends the whole collection every save, so what comes back from
  // a reload is exactly what the coach was last looking at — no merge to get
  // wrong, and a deleted article stays deleted. The stored copy is read first
  // only so each article can keep its own dates.
  const stored = await readTips(env.STATS);
  const before = new Map(stored.articles.map((a) => [a && a.id, a]));
  const articles = incoming
    .map((raw) => cleanArticle(raw, before.get(raw && typeof raw === "object" ? raw.id : null)))
    .filter((a) => a.en.title || a.ar.title);
  const liveId = articles.some((a) => a.id === body.save.liveId) ? body.save.liveId : null;

  await env.STATS.put(TIPS_KEY, JSON.stringify({ v: 1, liveId: liveId, articles: articles }));
  return json({ liveId: liveId, articles: articles, saved: true });
}
