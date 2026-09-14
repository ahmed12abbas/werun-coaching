/* A brake on anyone leaning on a public button. */

import { hex, sha256 } from "./crypto.js";

/** The address a request came from, as Cloudflare saw it; "" when unknown. */
export const ipOf = (request) => request.headers.get("cf-connecting-ip") || "";

/**
 * Have they been at it?
 *
 * What gets stored is eight bytes of a salted hash of `who` (an address, an
 * email) and the window it belongs to, in a `rate_limits` row pruned once the
 * window is over — never the address, never anything that outlives the
 * window it is guarding, and never anything joined to what they sent.
 * Bucketing by the clock rather than sliding the window means a busy address
 * is clear again at the top of the next window instead of being held down by
 * its own retries.
 *
 * The counters live in D1, not KV: KV's free tier is 1,000 writes a day and
 * the club ran through it by the afternoon of 14 Sep. One upsert counts and
 * reads at once, so two requests together cannot both slip under the cap.
 *
 * `scope` keeps one route's count apart from another's — "fb" for feedback,
 * "su" for signups — `max` is the ceiling and `windowSec` the bucket (60 if
 * not given). An empty `who` means there is nothing to count against, and
 * letting it through beats blocking everybody. So does a database that
 * refuses — or has no table yet, between a deploy and its migration.
 */
export async function tooOften(db, scope, who, max, windowSec) {
  if (!who || !db) return false;
  const win = windowSec || 60;
  const slot = Math.floor(Date.now() / (win * 1000));
  const digest = await sha256("werun-" + scope + ":" + who);
  const key = scope + "-rl:" + hex(new Uint8Array(digest).slice(0, 8)) + ":" + slot;

  try {
    const row = await db
      .prepare("INSERT INTO rate_limits (key, n, expires) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n")
      .bind(key, (slot + 1) * win)
      .first();
    // ponytail: pruned on ~1% of calls; a cron if the table ever grows big enough to notice
    if (Math.random() < 0.01) {
      await db.prepare("DELETE FROM rate_limits WHERE expires < ?").bind(Math.floor(Date.now() / 1000)).run();
    }
    return row.n > max;
  } catch (e) {
    console.error("limit: count failed (" + (e && e.message) + ")");
    return false;
  }
}
