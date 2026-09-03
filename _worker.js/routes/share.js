/* The share counter and the dashboard that reads it. */

import { json, readBody } from "../lib/http.js";
import { safeEqual } from "../lib/crypto.js";
import { DOC_KEY, readDoc, readFeedback } from "../lib/kv.js";
import { DAYS, isoWeek, weekStart, dayFromName } from "../lib/week.js";
import { FB_MAX, feedbackSummary } from "./feedback.js";

/* ---------- POST /api/share ---------------------------------------------- */

/*
 * Deliberately unauthenticated: it is a counter on a public page. It stores a
 * day-of-week bucket and nothing else — no IP, no link payload, no identity —
 * so there is nothing here worth protecting or leaking.
 */
export async function share(request, env) {
  // No KV bound yet? Sharing still works; it just is not counted.
  if (!env.STATS) return new Response(null, { status: 204 });

  const body = await readBody(request);
  const day = dayFromName(body && body.name);
  const week = isoWeek(new Date());

  // Read-modify-write, so two taps in the same instant can cost one count.
  // These are directional numbers for a coach, not billing, and a club's
  // volume makes a collision vanishingly unlikely.
  const doc = await readDoc(env.STATS);
  const w = (doc.weeks[week] = doc.weeks[week] || {});
  w[day] = (w[day] || 0) + 1;
  await env.STATS.put(DOC_KEY, JSON.stringify(doc));

  return new Response(null, { status: 204 });
}

/* ---------- POST /api/stats ---------------------------------------------- */

/*
 * The password is checked here, on the server, against a secret set on the
 * Pages project. It is never shipped in any JavaScript the site serves, which
 * is the whole reason this lives in a Worker and not in admin.html.
 *
 * POST, not GET: the password travels in the body, so it never lands in a URL,
 * a browser history entry or an edge access log.
 */
export async function stats(request, env) {
  // An unset password locks the dashboard rather than opening it.
  if (!env.ADMIN_PASSWORD) return json({ error: "not-configured" }, 503);

  const body = await readBody(request);
  if (!(await safeEqual(String((body && body.password) || ""), env.ADMIN_PASSWORD))) {
    return json({ error: "bad-password" }, 401);
  }

  if (!env.STATS) return json({ weeks: [], days: DAYS, warning: "no-store" });

  // Both halves of the dashboard in one answer: the counts the coach came for,
  // and what athletes actually wrote. One ask, one render.
  const notes = await readFeedback(env.STATS);
  const said = Object.assign(feedbackSummary(notes.items), {
    items: notes.items.slice(0, FB_MAX.show),
  });

  const doc = await readDoc(env.STATS);
  const weeks = Object.keys(doc.weeks)
    .sort()
    .reverse() // newest first: the week a coach cares about is this one
    .map((week) => {
      const counts = doc.weeks[week] || {};
      const total = Object.keys(counts).reduce((n, k) => n + (counts[k] || 0), 0);
      return { week: week, start: weekStart(week), counts: counts, total: total };
    });

  return json({ weeks: weeks, days: DAYS, feedback: said });
}
