/* A photo uploaded from a console, and the public read of it.

   An About page photo, a news post's and a Coach Tips article's each keep
   their own KV prefix — different resources, not copies of one — but the
   checks and the read are the same, so they live here once.

   The browser has already shrunk the photo (js/shrink.js), so this only
   refuses what is not a photo or is still too large. An id is minted once and
   never overwritten, so the read lets the browser keep it for good; the type
   was checked on the way in and nosniff (index.js) holds the browser to it.

   ponytail: a photo nothing points at any more is never collected; the cap
   bounds each prefix, and a sweep of it against its document is the fix if a
   club ever reaches one. */

import { json } from "./http.js";

const PHOTO = { re: /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/, bytes: 900000 };
/* The Next Up card's background (/admin's Theme card): an animated GIF or
   WebP, because an iPhone in Low Power Mode will not start a video by itself
   and a picture just plays. Shrinking it in the browser would keep only its
   first frame, so it goes up as it is and the cap is the whole guard: 5 MB,
   the club's choice, downloaded once per phone. js/admin-page.js says the
   same number before it uploads. */
const CLIP = { types: ["image/gif", "image/webp"], bytes: 5 * 1024 * 1024 };
const MAX = { count: 150 };

/** Keeps the photo under `prefix`, and answers with the `route` that reads it back. */
export async function storePhoto(env, prefix, data, route) {
  if (!env.STATS) return json({ error: "no-store" }, 503);
  const m = PHOTO.re.exec(String(data || ""));
  if (!m) return json({ error: "bad-image" }, 400);
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > PHOTO.bytes) return json({ error: "too-big" }, 400);
  return keep(env, prefix, bytes.buffer, m[1], route);
}

/** A Next Up GIF/WebP, POSTed as the file itself. A few megabytes of base64
    in JSON is more decoding than a Worker's CPU allows (Cloudflare error
    1102), so the body is the bytes and there is nothing to decode. The first
    bytes must say what the content-type does. */
export async function storeClip(env, prefix, request, route) {
  if (!env.STATS) return json({ error: "no-store" }, 503);
  const type = (request.headers.get("content-type") || "").split(";")[0].trim();
  if (!CLIP.types.includes(type)) return json({ error: "bad-clip" }, 400);
  if (Number(request.headers.get("content-length") || 0) > CLIP.bytes) return json({ error: "too-big" }, 400);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > CLIP.bytes) return json({ error: "too-big" }, 400);
  const head = String.fromCharCode(...new Uint8Array(buf.slice(0, 12)));
  const real = type === "image/gif" ? head.startsWith("GIF8") : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  if (!real) return json({ error: "bad-clip" }, 400);
  return keep(env, prefix, buf, type, route);
}

async function keep(env, prefix, buf, type, route) {
  const listed = await env.STATS.list({ prefix: prefix });
  if (listed.keys.length >= MAX.count) return json({ error: "too-many" }, 400);
  const id = crypto.randomUUID().replace(/-/g, "");
  await env.STATS.put(prefix + id, buf, { metadata: { type: type } });
  return json({ url: route + "?id=" + id });
}

/** GET <route>?id= — public. */
export async function servePhoto(request, env, prefix) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!env.STATS || !/^[a-f0-9]{32}$/.test(id)) return new Response("Not found", { status: 404 });
  const got = await env.STATS.getWithMetadata(prefix + id, "arrayBuffer");
  if (!got || !got.value) return new Response("Not found", { status: 404 });
  return new Response(got.value, {
    headers: {
      "content-type": (got.metadata && got.metadata.type) || "image/webp",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
