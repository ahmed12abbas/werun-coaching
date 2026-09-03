/* A brake on anyone leaning on a public button. */

import { hex, sha256 } from "./crypto.js";

/** The address a request came from, as Cloudflare saw it; "" when unknown. */
export const ipOf = (request) => request.headers.get("cf-connecting-ip") || "";

/**
 * Have they been at it?
 *
 * What gets stored is eight bytes of a salted hash of `who` (an address, an
 * email) and the window it belongs to, under a key that deletes itself when
 * the window is over — never the address, never anything that outlives the
 * window it is guarding, and never anything joined to what they sent.
 * Bucketing by the clock rather than sliding the window means a busy address
 * is clear again at the top of the next window instead of being held down by
 * its own retries.
 *
 * KV is eventually consistent, so requests landing at two edges together can
 * both read a stale count: a brake on someone leaning on the button, not a
 * lock.
 *
 * `scope` keeps one route's count apart from another's — "fb" for feedback,
 * "su" for signups — `max` is the ceiling and `windowSec` the bucket (60 if
 * not given). An empty `who` means there is nothing to count against, and
 * letting it through beats blocking everybody.
 */
export async function tooOften(kv, scope, who, max, windowSec) {
  if (!who) return false;
  const win = windowSec || 60;
  const slot = Math.floor(Date.now() / (win * 1000));
  const digest = await sha256("werun-" + scope + ":" + who);
  const key = scope + "-rl:" + hex(new Uint8Array(digest).slice(0, 8)) + ":" + slot;

  const seen = Number(await kv.get(key)) || 0;
  if (seen >= max) return true;
  await kv.put(key, String(seen + 1), { expirationTtl: Math.max(60, win) }); // 60 is KV's own floor
  return false;
}
