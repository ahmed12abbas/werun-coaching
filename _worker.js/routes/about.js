/* The Who Are We page: the document /about draws, and the photos in it.

   Both live in the STATS namespace. The page is one value, read whole on every
   visit and written only when an admin saves, so it is the same one-key shape
   as the articles (lib/kv.js). Each uploaded photo is its own value, because a
   photo in the document would be downloaded by every visit whether it is on
   screen or not.

   The document's shape is js/about.js's business: sections of { type, show,
   …fields }. What is checked here is only that it stays a bounded tree of
   plain values — the page writes it with textContent and checks its links and
   photos itself. */

import { json, readBody } from "../lib/http.js";
import { refuseUnlessAdmin } from "../lib/auth.js";
import { stravaReady, freshToken } from "../lib/strava.js";
import { storePhoto, servePhoto } from "../lib/photos.js";

const DOC_KEY = "about-doc";
const LIVE_KEY = "about-live";
const LIVE_EVERY = 6 * 3600 * 1000;
const STRAVA_CLUB = "1184584"; // the club SOCIAL links to, js/brand.js
const IMG_PREFIX = "about-img:";
const TYPES = ["hero", "about", "stats", "social", "goals", "sessions", "gallery", "events", "partners", "text", "cta"];
const MAX = { json: 80000, sections: 30, list: 40, keys: 20, text: 3000, depth: 6 };

/* ---------- GET /api/about ---------------------------------------------- */

/* Public: the saved page, or null for the one js/about.js was shipped with,
   and the follower counts read by themselves. */
export async function about(request, env) {
  if (!env.STATS) return json({ doc: null, live: null });
  const [doc, live] = await Promise.all([env.STATS.get(DOC_KEY, "json"), liveCounts(env)]);
  return json({ doc: doc, live: live });
}

/* ---------- the counts that keep themselves up to date ------------------- */

/* The one follower count that can be read for free: the Strava club's.
   Instagram, TikTok and X want paid plans or app reviews, so the admin types
   those. Kept for six hours, so a visit costs one KV read and only the first
   in each window asks Strava: Pages has no cron (see remind.yml), and a
   public page can be a few hours behind. A failed read keeps the last number,
   or none, and the page shows the typed one. */
async function liveCounts(env) {
  try {
    const was = await env.STATS.get(LIVE_KEY, "json");
    if (was && Date.now() - was.at < LIVE_EVERY) return was;
    if (!(stravaReady(env) && env.DB)) return was;
    const st = await stravaCount(env).catch((e) => { console.error("about strava: " + e.message); return null; });
    const now = { at: Date.now(), strava: st ?? (was && was.strava) ?? null };
    await env.STATS.put(LIVE_KEY, JSON.stringify(now));
    return now;
  } catch (e) {
    console.error("about live: " + e.message);
    return null; // the page never waits on this, it only loses the live number
  }
}

/* Read with the Strava link of somebody who runs the club, never an athlete's:
   it is the club's number, asked for on the club's behalf. Nobody on staff
   linked, or a table not there yet, and it is simply not read. */
async function stravaCount(env) {
  if (!stravaReady(env) || !env.DB) return null;
  let link = null;
  try {
    link = await env.DB.prepare(
      "SELECT l.* FROM strava_links l JOIN users u ON u.id = l.user_id " +
        "WHERE u.status <> 'blocked' AND (u.is_admin = 1 OR u.role = 'coach') ORDER BY u.is_admin DESC LIMIT 1"
    ).first();
  } catch (e) {
    return null;
  }
  if (!link) return null;
  const t = await freshToken(env, link);
  // Strava hands out a new refresh token with each new access token; the old
  // one stops working, so the row has to hear about it.
  if (t.access_token !== link.access_token) {
    await env.DB.prepare("UPDATE strava_links SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?")
      .bind(t.access_token, t.refresh_token, t.expires_at, link.user_id).run();
  }
  const res = await fetch("https://www.strava.com/api/v3/clubs/" + STRAVA_CLUB, {
    headers: { authorization: "Bearer " + t.access_token },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error("club " + res.status);
  const club = await res.json();
  return typeof club.member_count === "number" ? club.member_count : null;
}

/* ---------- GET /api/about/img?id= --------------------------------------- */

export const aboutImg = (request, env) => servePhoto(request, env, IMG_PREFIX);

/* ---------- POST /api/admin/about ---------------------------------------- */

/* No action reads the saved copy; `save`, `reset` and `upload` change it. */
export async function adminAbout(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessAdmin(request, env, body);
  if (no) return no;
  if (!env.STATS) return json({ error: "no-store" }, 503);

  if (body.action === "save") return save(env, body.doc);
  if (body.action === "reset") {
    await env.STATS.delete(DOC_KEY);
    return json({ doc: null, saved: true });
  }
  if (body.action === "upload") return upload(env, body.data);
  const [doc, live] = await Promise.all([env.STATS.get(DOC_KEY, "json"), liveCounts(env)]);
  return json({ doc: doc, live: live });
}

async function save(env, raw) {
  const sections = raw && Array.isArray(raw.sections) ? raw.sections : null;
  if (!sections || sections.length > MAX.sections) return json({ error: "bad-doc" }, 400);
  const doc = {
    sections: sections
      .filter((s) => s && typeof s === "object" && TYPES.includes(s.type))
      .map((s) => clean(s, 0)),
  };
  const text = JSON.stringify(doc);
  if (text.length > MAX.json) return json({ error: "too-big" }, 400);
  await env.STATS.put(DOC_KEY, text);
  return json({ doc: doc, saved: true });
}

/* Strings, numbers, true/false, and lists and objects of them — bounded in
   every direction so one save cannot grow the value without end. Keys are
   plain lower-case words; nothing starting with "_" (so no __proto__). */
function clean(v, depth) {
  if (typeof v === "string") return v.slice(0, MAX.text);
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v;
  if (depth >= MAX.depth || !v || typeof v !== "object") return null;
  if (Array.isArray(v)) return v.slice(0, MAX.list).map((x) => clean(x, depth + 1));
  const out = {};
  for (const k of Object.keys(v).slice(0, MAX.keys)) {
    if (/^[a-z][a-z_]{0,23}$/.test(k)) out[k] = clean(v[k], depth + 1);
  }
  return out;
}

function upload(env, data) {
  return storePhoto(env, IMG_PREFIX, data, "/api/about/img");
}
