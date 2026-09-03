/* A brake on anyone leaning on a public button. */

import { hex, sha256 } from "./crypto.js";

/**
 * Have they been at it?
 *
 * What gets stored is eight bytes of a salted hash of the address and the
 * minute it belongs to, under a key that deletes itself after sixty seconds —
 * never the address, never anything that outlives the minute it is guarding,
 * and never anything joined to what they sent. Bucketing by the clock minute
 * rather than sliding the window means a busy address is clear again at the
 * top of the next minute instead of being held down by its own retries.
 *
 * KV is eventually consistent, so requests landing at two edges together can
 * both read a stale count: a brake on someone leaning on the button, not a
 * lock.
 *
 * `scope` keeps one route's count apart from another's — "fb" for feedback —
 * and `perMinute` is the ceiling for that scope.
 */
export async function tooOften(request, kv, scope, perMinute) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return false; // nothing to go on: let it through rather than block everybody
  const minute = Math.floor(Date.now() / 60000);
  const digest = await sha256("werun-" + scope + ":" + ip);
  const key = scope + "-rl:" + hex(new Uint8Array(digest).slice(0, 8)) + ":" + minute;

  const seen = Number(await kv.get(key)) || 0;
  if (seen >= perMinute) return true;
  await kv.put(key, String(seen + 1), { expirationTtl: 60 }); // KV's own floor
  return false;
}
