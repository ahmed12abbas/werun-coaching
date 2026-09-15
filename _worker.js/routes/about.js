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

const DOC_KEY = "about-doc";
const IMG_PREFIX = "about-img:";
const TYPES = ["hero", "about", "stats", "social", "goals", "gallery", "events", "text", "cta"];
const MAX = { json: 80000, sections: 30, list: 40, keys: 20, text: 3000, depth: 6, img: 900000, imgs: 150 };
const PHOTO = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/;

/* ---------- GET /api/about ---------------------------------------------- */

/* Public: the saved page, or null for the one js/about.js was shipped with. */
export async function about(request, env) {
  if (!env.STATS) return json({ doc: null });
  return json({ doc: await env.STATS.get(DOC_KEY, "json") });
}

/* ---------- GET /api/about/img?id= --------------------------------------- */

/* An id is only ever minted once and never overwritten, so the browser may
   keep the photo for good. The type was checked when it went in; nosniff
   (index.js) keeps the browser to it. */
export async function aboutImg(request, env) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!env.STATS || !/^[a-f0-9]{32}$/.test(id)) return new Response("Not found", { status: 404 });
  const got = await env.STATS.getWithMetadata(IMG_PREFIX + id, "arrayBuffer");
  if (!got || !got.value) return new Response("Not found", { status: 404 });
  return new Response(got.value, {
    headers: {
      "content-type": (got.metadata && got.metadata.type) || "image/webp",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

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
  return json({ doc: await env.STATS.get(DOC_KEY, "json") });
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

/* The browser has already shrunk the photo (admin.html, aboutShrink), so
   this only has to refuse what is not a photo or is still too large.
   ponytail: a photo no section points at any more is never collected; the
   cap bounds it, and a sweep of about-img:* against the document is the fix
   if the club ever reaches it. */
async function upload(env, data) {
  const m = PHOTO.exec(String(data || ""));
  if (!m) return json({ error: "bad-image" }, 400);
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > MAX.img) return json({ error: "too-big" }, 400);
  const listed = await env.STATS.list({ prefix: IMG_PREFIX });
  if (listed.keys.length >= MAX.imgs) return json({ error: "too-many" }, 400);

  const id = crypto.randomUUID().replace(/-/g, "");
  await env.STATS.put(IMG_PREFIX + id, bytes.buffer, { metadata: { type: m[1] } });
  return json({ url: "/api/about/img?id=" + id });
}
