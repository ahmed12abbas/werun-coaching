/* =========================================================================
   WE RUN Coaching — the server side of the share counter.

   Cloudflare Pages "advanced mode": a single `_worker.js` at the root of the
   uploaded site handles every request, forwarding anything that is not an API
   route to the static files. The name is reserved, so unlike a functions/
   directory this file is never itself served — the deploy would otherwise put
   the server source up as a downloadable asset.

   Two routes:
     POST /api/share  — public beacon, counts one tap of "Share this session"
     POST /api/stats  — password-gated, returns the weekly counts

   Bindings, both set on the Pages project (see the README):
     STATS           KV namespace holding the counts
     ADMIN_PASSWORD  secret the dashboard checks against
   Without them the site still works: sharing just is not counted, and the
   dashboard stays locked rather than falling open.
   ========================================================================= */

/** The single KV key everything lives under. See readDoc() for the shape. */
const DOC_KEY = "share-hits";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// The club names sessions "Monday | WeRUN". Coaches edit those names, so match
// the day word anywhere in the string rather than insisting it comes first,
// and accept the Arabic names the language toggle produces.
const AR_DAYS = {
  "الاثنين": "monday",
  "الإثنين": "monday",
  "الثلاثاء": "tuesday",
  "الأربعاء": "wednesday",
  "الاربعاء": "wednesday",
  "الخميس": "thursday",
  "الجمعة": "friday",
  "السبت": "saturday",
  "الأحد": "sunday",
  "الاحد": "sunday",
};

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/**
 * ISO-8601 week, e.g. "2026-W36". ISO weeks start on Monday, which is what a
 * coach means by "this week" when the week's sessions are Monday and Thursday.
 */
function isoWeek(d) {
  // Shift to this week's Thursday: the year that Thursday falls in is, by
  // definition, the ISO week-numbering year.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((t - firstThursday) / (7 * 24 * 3600 * 1000));
  return t.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}

/** Monday's date for an ISO week, so the dashboard can show a real date. */
function weekStart(isoWeekStr) {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeekStr);
  if (!m) return null;
  const jan4 = new Date(Date.UTC(+m[1], 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (+m[2] - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

/** Which day a session name belongs to; "other" when it names no day at all. */
function dayFromName(name) {
  const s = String(name || "").toLowerCase();
  for (const d of DAYS) if (s.includes(d)) return d;
  for (const ar of Object.keys(AR_DAYS)) if (s.includes(ar)) return AR_DAYS[ar];
  return "other";
}

/**
 * The whole history is one KV value:
 *   { v: 1, weeks: { "2026-W36": { monday: 12, thursday: 8 } } }
 *
 * One key means one read and one write per tap instead of one per week, so
 * this never grows into the Workers subrequest limit. A year of a club's
 * sessions is a few kilobytes.
 */
async function readDoc(kv) {
  const doc = await kv.get(DOC_KEY, "json");
  if (!doc || typeof doc !== "object" || !doc.weeks) return { v: 1, weeks: {} };
  return doc;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch (e) {
    return {}; // a malformed body fails the checks below on its own merits
  }
}

/**
 * Compare without leaking, through timing, how much of a guess was right.
 * Digesting both sides first makes the comparison fixed-length whatever the
 * inputs are, so neither the password nor its length shows up in the clock.
 */
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ---------- POST /api/share ---------------------------------------------- */

/*
 * Deliberately unauthenticated: it is a counter on a public page. It stores a
 * day-of-week bucket and nothing else — no IP, no link payload, no identity —
 * so there is nothing here worth protecting or leaking.
 */
async function share(request, env) {
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
async function stats(request, env) {
  // An unset password locks the dashboard rather than opening it.
  if (!env.ADMIN_PASSWORD) return json({ error: "not-configured" }, 503);

  const body = await readBody(request);
  if (!(await safeEqual(String((body && body.password) || ""), env.ADMIN_PASSWORD))) {
    return json({ error: "bad-password" }, 401);
  }

  if (!env.STATS) return json({ weeks: [], days: DAYS, warning: "no-store" });

  const doc = await readDoc(env.STATS);
  const weeks = Object.keys(doc.weeks)
    .sort()
    .reverse() // newest first: the week a coach cares about is this one
    .map((week) => {
      const counts = doc.weeks[week] || {};
      const total = Object.keys(counts).reduce((n, k) => n + (counts[k] || 0), 0);
      return { week: week, start: weekStart(week), counts: counts, total: total };
    });

  return json({ weeks: weeks, days: DAYS });
}

/* ---------- routing ------------------------------------------------------- */

const ROUTES = { "/api/share": share, "/api/stats": stats };

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const handler = ROUTES[pathname];
    if (!handler) return env.ASSETS.fetch(request); // every real page and file
    if (request.method !== "POST") {
      return json({ error: "method-not-allowed" }, 405);
    }
    return handler(request, env);
  },
};
