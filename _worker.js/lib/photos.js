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

const PHOTO = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/;
const MAX = { bytes: 900000, count: 150 };

/** Keeps the photo under `prefix`, and answers with the `route` that reads it back. */
export async function storePhoto(env, prefix, data, route) {
  if (!env.STATS) return json({ error: "no-store" }, 503);
  const m = PHOTO.exec(String(data || ""));
  if (!m) return json({ error: "bad-image" }, 400);
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > MAX.bytes) return json({ error: "too-big" }, 400);
  const listed = await env.STATS.list({ prefix: prefix });
  if (listed.keys.length >= MAX.count) return json({ error: "too-many" }, 400);

  const id = crypto.randomUUID().replace(/-/g, "");
  await env.STATS.put(prefix + id, bytes.buffer, { metadata: { type: m[1] } });
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
