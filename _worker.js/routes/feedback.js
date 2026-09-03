/* What athletes said about the sessions, and the coach taking a note down. */

import { json, readBody } from "../lib/http.js";
import { safeEqual } from "../lib/crypto.js";
import { tooOften, ipOf } from "../lib/limit.js";
import { FEEDBACK_KEY, readFeedback } from "../lib/kv.js";

/* Bounds on what a stranger may put in the store. Feedback is the only route
   on the site that takes writing from someone who was never given a password,
   so these caps are what stands between a bored visitor and a KV value too
   big to read. Once there are more than 400 notes the oldest fall off the
   end: a club reads these within the week, and a year of them helps nobody. */
export const FB_MAX = { items: 400, show: 200, name: 40, comment: 700, session: 80 };

/* Six notes a minute from one address, which is a script and not a run club.
   A whole group rating at once after a session comes through one router or one
   carrier, so a limit of one would silence everybody but the fastest thumb —
   the failure that matters here is a real note refused, not a junk one let in.
   The item cap is what actually bounds a determined attacker. */
const FB_PER_MINUTE = 6;

/** A single line, with the whitespace collapsed out of it. */
export const oneLine = (s, max) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);

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
export function feedbackSummary(items) {
  const spread = [0, 0, 0, 0, 0];
  for (const it of items) {
    const r = it && Math.round(it.rating);
    if (r >= 1 && r <= 5) spread[r - 1]++;
  }
  const count = spread.reduce((n, c) => n + c, 0);
  const sum = spread.reduce((n, c, i) => n + c * (i + 1), 0);
  return { count: count, average: count ? Math.round((sum / count) * 10) / 10 : 0, spread: spread };
}

/* ---------- POST /api/feedback -------------------------------------------- */

/*
 * Public, like the share beacon: it is a comment box on a page anyone can
 * open. The rating is the only thing required — the name and the comment are
 * both allowed to be empty, because most athletes will give exactly a star
 * count, and a box that insists on more is a box nobody fills in.
 *
 * The timestamp is taken here and never from the request, the same rule the
 * articles follow: a client can say anything about when it wrote.
 */
export async function feedback(request, env) {
  // No KV bound? Say so rather than swallowing it. Unlike the share counter, a
  // note that quietly went nowhere is a promise broken to whoever wrote it.
  if (!env.STATS) return json({ error: "no-store" }, 503);

  const body = await readBody(request);
  const rating = Math.round(Number(body && body.rating));
  if (!(rating >= 1 && rating <= 5)) return json({ error: "bad-rating" }, 400);
  if (await tooOften(env.STATS, "fb", ipOf(request), FB_PER_MINUTE, 60)) return json({ error: "too-often" }, 429);

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
export async function feedbackAdmin(request, env) {
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
