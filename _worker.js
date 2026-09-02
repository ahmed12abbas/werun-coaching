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

/** The coach corner articles, in the same namespace. See readTips() for the shape. */
const TIPS_KEY = "tips-doc";

/* Bounds on what the editor may store. Generous for a coach writing a few
   paragraphs, small enough that one KV value cannot grow into the value size
   limit or make the public read slow. */
const TIP_MAX = { articles: 60, title: 140, body: 9000 };

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

/* ---------- the coach's corner -------------------------------------------
   One KV value holds every article the coach has written plus which one is
   currently live:

     { v: 1, liveId: "k3f9…", articles: [ { id, updated, en:{…}, ar:{…} } ] }

   Keeping the drafts server-side rather than only the live one is the whole
   point of the editor: a coach can rotate an old article back in front of
   athletes without typing it again.
   ------------------------------------------------------------------------- */

async function readTips(kv) {
  const doc = await kv.get(TIPS_KEY, "json");
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.articles)) {
    return { v: 1, liveId: null, articles: [] };
  }
  return { v: 1, liveId: doc.liveId || null, articles: doc.articles };
}

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

function cleanArticle(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const id = /^[A-Za-z0-9_-]{1,40}$/.test(String(a.id || "")) ? String(a.id) : null;
  return {
    id: id || "a" + Math.random().toString(36).slice(2, 10),
    updated: new Date().toISOString(),
    en: cleanSide(a.en),
    ar: cleanSide(a.ar),
  };
}

/* ---------- GET /api/tips ------------------------------------------------ */

/*
 * Public, and deliberately narrow: it answers with the one live article and
 * nothing else. The drafts the coach is still working on never leave the
 * password-gated side, so an unfinished article cannot be read off the API
 * before she puts it live.
 */
async function tips(request, env) {
  if (!env.STATS) return json({ article: null });

  const doc = await readTips(env.STATS);
  const live = doc.articles.find((a) => a && a.id === doc.liveId) || null;
  if (!live) return json({ article: null });

  return json({ article: { id: live.id, updated: live.updated, en: live.en, ar: live.ar } });
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

/*
 * The editor behind /tips, and the read-only view of the same articles on
 * /admin. Same shape as /api/stats — password in the body, checked here
 * against secrets the site never ships.
 */
async function tipsAdmin(request, env) {
  if (!env.TIPS_PASSWORD && !env.ADMIN_PASSWORD) {
    return json({ error: "not-configured" }, 503);
  }

  const body = await readBody(request);
  if (!(await tipsAllows(String((body && body.password) || ""), env))) {
    return json({ error: "bad-password" }, 401);
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
  // wrong, and a deleted article stays deleted.
  const articles = incoming.map(cleanArticle).filter((a) => a.en.title || a.ar.title);
  const liveId = articles.some((a) => a.id === body.save.liveId) ? body.save.liveId : null;

  await env.STATS.put(TIPS_KEY, JSON.stringify({ v: 1, liveId: liveId, articles: articles }));
  return json({ liveId: liveId, articles: articles, saved: true });
}

/* ---------- routing ------------------------------------------------------- */

const ROUTES = { "/api/share": share, "/api/stats": stats, "/api/tips-admin": tipsAdmin };
const GETTABLE = { "/api/tips": tips };

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (GETTABLE[pathname]) return GETTABLE[pathname](request, env);
    const handler = ROUTES[pathname];
    if (!handler) return env.ASSETS.fetch(request); // every real page and file
    if (request.method !== "POST") {
      return json({ error: "method-not-allowed" }, 405);
    }
    return handler(request, env);
  },
};
