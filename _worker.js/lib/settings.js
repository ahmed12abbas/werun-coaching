/* What the coach can change from /admin without a deploy.

   One row per key in the settings table, value stored as JSON. Read once a
   minute per isolate rather than once per request: a club's settings change
   a few times a season, and a request should not pay a database round trip
   to learn that signups are still open. */

export const DEFAULTS = {
  signups_open: true,
  points_per_checkin: 10,
  streak_every: 4, // every N consecutive sessions…
  streak_bonus: 5, // …earns this on top
  // Check-in opens this long before the start. A month, which is to say it
  // is simply open: an athlete looking at Saturday's card on a Tuesday gets
  // a live Join button rather than a dead one, and nothing is lost by it —
  // the code on the coach's screen is signed and dies in thirty seconds, so
  // an open window is more time to be *at* the session, never more time to
  // check in from home.
  window_before_min: 30 * 24 * 60,
  // …and closes two hours after the start. Long enough for a long run and
  // the coffee afterwards, short enough that yesterday's session is shut by
  // the time anybody thinks to try it.
  window_after_min: 120,
  club_name: "WE RUN",
  store_open: false, // off until the coach has put something in it
  currency: "usd", // Stripe's code for it: usd, egp, aed, gbp, eur…
  whatsapp_url: "", // the group, linked from the app's feed
  announcement_en: "", // a line across the top of the app; empty means none
  announcement_ar: "",
  // Athletes see a message instead of the week; coaches carry on working, and
  // logging in and out keeps working for everyone, so this cannot lock the
  // club out of its own site.
  maintenance: false,
};

const TTL = 60 * 1000;
const cache = new Map(); // key -> { value, at }

export async function getSetting(env, key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value = DEFAULTS[key];
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
      if (row && row.value != null) value = JSON.parse(row.value);
    } catch (e) {
      // A broken row or a missing table means the default, not a broken site.
    }
  }
  cache.set(key, { value: value, at: Date.now() });
  return value;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)" +
      " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  )
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run();
  cache.set(key, { value: value, at: Date.now() });
}

/** Every known setting, defaults filled in — for the admin page. */
export async function allSettings(env) {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = await getSetting(env, key);
  return out;
}
