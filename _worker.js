/* =========================================================================
   WE RUN Coaching — the server side of the share counter.

   Cloudflare Pages "advanced mode": a single `_worker.js` at the root of the
   uploaded site handles every request, forwarding anything that is not an API
   route to the static files. The name is reserved, so unlike a functions/
   directory this file is never itself served — the deploy would otherwise put
   the server source up as a downloadable asset.

   The routes, the public ones first:
     POST /api/share          — beacon; counts one tap of "Share this session"
     POST /api/feedback       — one athlete's stars, name and comment
     GET  /api/tips           — the one article the coach has put live
     POST /api/stats          — the dashboard: counts and feedback, password-gated
     POST /api/feedback-admin — takes one note down, password-gated
     POST /api/tips-admin     — the article editor, password-gated

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

/** What athletes said about the sessions. See readFeedback() for the shape. */
const FEEDBACK_KEY = "feedback-doc";

/* Bounds on what a stranger may put in the store. Feedback is the only route
   on the site that takes writing from someone who was never given a password,
   so these caps are what stands between a bored visitor and a KV value too
   big to read. Once there are more than 400 notes the oldest fall off the
   end: a club reads these within the week, and a year of them helps nobody. */
const FB_MAX = { items: 400, show: 200, name: 40, comment: 700, session: 80 };

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

/* ---------- POST /api/feedback -------------------------------------------- */

/* Six notes a minute from one address, which is a script and not a run club.
   A whole group rating at once after a session comes through one router or one
   carrier, so a limit of one would silence everybody but the fastest thumb —
   the failure that matters here is a real note refused, not a junk one let in.
   The item cap is what actually bounds a determined attacker. */
const FB_PER_MINUTE = 6;

/**
 * Have they been at it?
 *
 * What gets stored is eight bytes of a salted hash of the address and the
 * minute it belongs to, under a key that deletes itself after sixty seconds —
 * never the address, never anything that outlives the minute it is guarding,
 * and never anything joined to the note itself. Bucketing by the clock minute
 * rather than sliding the window means a busy address is clear again at the
 * top of the next minute instead of being held down by its own retries.
 *
 * KV is eventually consistent, so requests landing at two edges together can
 * both read a stale count: a brake on someone leaning on the button, not a
 * lock.
 */
async function tooOften(request, env) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return false; // nothing to go on: let it through rather than block everybody
  const minute = Math.floor(Date.now() / 60000);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("werun-fb:" + ip));
  const key =
    "fb-rl:" +
    Array.from(new Uint8Array(digest).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("") +
    ":" +
    minute;

  const seen = Number(await env.STATS.get(key)) || 0;
  if (seen >= FB_PER_MINUTE) return true;
  await env.STATS.put(key, String(seen + 1), { expirationTtl: 60 }); // KV's own floor
  return false;
}

/*
 * Public, like the share beacon: it is a comment box on a page anyone can
 * open. The rating is the only thing required — the name and the comment are
 * both allowed to be empty, because most athletes will give exactly a star
 * count, and a box that insists on more is a box nobody fills in.
 *
 * The timestamp is taken here and never from the request, the same rule the
 * articles follow: a client can say anything about when it wrote.
 */
async function feedback(request, env) {
  // No KV bound? Say so rather than swallowing it. Unlike the share counter, a
  // note that quietly went nowhere is a promise broken to whoever wrote it.
  if (!env.STATS) return json({ error: "no-store" }, 503);

  const body = await readBody(request);
  const rating = Math.round(Number(body && body.rating));
  if (!(rating >= 1 && rating <= 5)) return json({ error: "bad-rating" }, 400);
  if (await tooOften(request, env)) return json({ error: "too-often" }, 429);

  const item = {
    id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    rating: rating,
    name: oneLine(body.name, FB_MAX.name),
    comment: cleanComment(body.comment),
    // Which session they had just read, so a coach can see what a note is about.
    session: oneLine(body.session, FB_MAX.session),
    lang: body.lang === "ar" ? "ar" : "en",
  };

  const doc = await readFeedback(env.STATS);
  doc.items.unshift(item);
  if (doc.items.length > FB_MAX.items) doc.items.length = FB_MAX.items;
  await env.STATS.put(FEEDBACK_KEY, JSON.stringify({ v: 1, items: doc.items }));

  return json({ ok: true });
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

/* ---------- POST /api/feedback-admin -------------------------------------- */

/*
 * Taking one note down.
 *
 * Public writing with no way to remove it is a promise the club cannot keep —
 * the first piece of abuse would sit in the dashboard forever — so the coach
 * gets a delete, behind the same password as the rest of the page.
 *
 * A removal and nothing else: there is no way in here to change what an
 * athlete wrote, so what the dashboard shows is always their words or nothing.
 */
async function feedbackAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return json({ error: "not-configured" }, 503);

  const body = await readBody(request);
  if (!(await safeEqual(String((body && body.password) || ""), env.ADMIN_PASSWORD))) {
    return json({ error: "bad-password" }, 401);
  }
  if (!env.STATS) return json({ count: 0, average: 0, spread: [0, 0, 0, 0, 0], items: [] });

  const doc = await readFeedback(env.STATS);
  const id = String((body && body.remove) || "");
  const items = id ? doc.items.filter((it) => it && it.id !== id) : doc.items;
  if (items.length !== doc.items.length) {
    await env.STATS.put(FEEDBACK_KEY, JSON.stringify({ v: 1, items: items }));
  }

  return json(Object.assign(feedbackSummary(items), { items: items.slice(0, FB_MAX.show) }));
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

/**
 * Every note ever left, newest first:
 *   { v: 1, items: [ { id, at, rating, name, comment, session, lang } ] }
 *
 * One key again, for the same reason the counts are one key: a club's whole
 * feedback history is a few dozen kilobytes, and one read beats one per note.
 */
async function readFeedback(kv) {
  const doc = await kv.get(FEEDBACK_KEY, "json");
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.items)) return { v: 1, items: [] };
  return { v: 1, items: doc.items };
}

/** A single line, with the whitespace collapsed out of it. */
const oneLine = (s, max) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);

/**
 * A comment keeps its paragraphs — someone who wrote three lines about their
 * session meant the three lines — but loses the runs of blank lines and the
 * tabs that a paste out of a notes app brings with it.
 */
const cleanComment = (s) =>
  String(s || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, FB_MAX.comment);

/** The shape /admin needs: how many, how good, and how they are spread. */
function feedbackSummary(items) {
  const spread = [0, 0, 0, 0, 0];
  for (const it of items) {
    const r = it && Math.round(it.rating);
    if (r >= 1 && r <= 5) spread[r - 1]++;
  }
  const count = spread.reduce((n, c) => n + c, 0);
  const sum = spread.reduce((n, c, i) => n + c * (i + 1), 0);
  return { count: count, average: count ? Math.round((sum / count) * 10) / 10 : 0, spread: spread };
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

/**
 * One article, trimmed to what is safe to store, against what is already
 * there under the same id.
 *
 * Timestamps are never taken from the request — a client could say anything.
 * `created` carries over from the stored copy, and `updated` moves only when
 * this article's own text actually changed. The editor posts the whole
 * collection on every save, so without that comparison one edit would restamp
 * every other article and "updated" would mean nothing at all.
 */
function cleanArticle(raw, prev) {
  const a = raw && typeof raw === "object" ? raw : {};
  const id = /^[A-Za-z0-9_-]{1,40}$/.test(String(a.id || "")) ? String(a.id) : null;
  const en = cleanSide(a.en);
  const ar = cleanSide(a.ar);
  const now = new Date().toISOString();

  const unchanged =
    prev &&
    prev.en &&
    prev.ar &&
    prev.en.title === en.title &&
    prev.en.body === en.body &&
    prev.ar.title === ar.title &&
    prev.ar.body === ar.body;

  return {
    id: id || "a" + Math.random().toString(36).slice(2, 10),
    // Articles written before this field existed fall back to their last known
    // edit, which is the closest thing to a posting date they have.
    created: (prev && (prev.created || prev.updated)) || now,
    updated: unchanged ? prev.updated || now : now,
    en: en,
    ar: ar,
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

  return json({
    article: {
      id: live.id,
      created: live.created || live.updated,
      updated: live.updated,
      en: live.en,
      ar: live.ar,
    },
  });
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
  // wrong, and a deleted article stays deleted. The stored copy is read first
  // only so each article can keep its own dates.
  const stored = await readTips(env.STATS);
  const before = new Map(stored.articles.map((a) => [a && a.id, a]));
  const articles = incoming
    .map((raw) => cleanArticle(raw, before.get(raw && typeof raw === "object" ? raw.id : null)))
    .filter((a) => a.en.title || a.ar.title);
  const liveId = articles.some((a) => a.id === body.save.liveId) ? body.save.liveId : null;

  await env.STATS.put(TIPS_KEY, JSON.stringify({ v: 1, liveId: liveId, articles: articles }));
  return json({ liveId: liveId, articles: articles, saved: true });
}

/* ---------- routing ------------------------------------------------------- */

const ROUTES = {
  "/api/share": share,
  "/api/feedback": feedback,
  "/api/stats": stats,
  "/api/tips-admin": tipsAdmin,
  "/api/feedback-admin": feedbackAdmin,
};
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
