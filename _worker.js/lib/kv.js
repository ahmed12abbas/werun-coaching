/* The three documents that live in the STATS namespace, each under one key.

   One key per document means one read and one write per request instead of
   one per item, so none of this grows into the Workers subrequest limit. A
   year of a club's counts, notes or articles is a few dozen kilobytes. */

/** Share counts: { v: 1, weeks: { "2026-W36": { monday: 12, thursday: 8 } } } */
export const DOC_KEY = "share-hits";

/** The coach's articles: { v: 1, liveId, articles: [ { id, created, updated, en, ar } ] } */
export const TIPS_KEY = "tips-doc";

/** What athletes said, newest first: { v: 1, items: [ { id, at, rating, name, comment, session, lang } ] } */
export const FEEDBACK_KEY = "feedback-doc";

export async function readDoc(kv) {
  const doc = await kv.get(DOC_KEY, "json");
  if (!doc || typeof doc !== "object" || !doc.weeks) return { v: 1, weeks: {} };
  return doc;
}

export async function readTips(kv) {
  const doc = await kv.get(TIPS_KEY, "json");
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.articles)) {
    return { v: 1, liveId: null, articles: [] };
  }
  return { v: 1, liveId: doc.liveId || null, articles: doc.articles };
}

export async function readFeedback(kv) {
  const doc = await kv.get(FEEDBACK_KEY, "json");
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.items)) return { v: 1, items: [] };
  return { v: 1, items: doc.items };
}
