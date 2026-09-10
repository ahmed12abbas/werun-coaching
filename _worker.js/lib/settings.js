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
  // Check-in opens an hour before the start. The signed code is what stops a
  // check-in from the sofa, not the window — but a week of cards all saying
  // "check-in open" says nothing about which one is on this morning, and the
  // coach asked for the badge to mean today. Longer is a number in /admin.
  window_before_min: 60,
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
  const value = await readSetting(env, key);
  cache.set(key, { value: value, at: Date.now() });
  return value;
}

/* What the table says, or the default: with no database, no row, an empty
   one, or a row that will not parse. */
async function readSetting(env, key) {
  if (!env.DB) return DEFAULTS[key];
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
    return row && row.value != null ? JSON.parse(row.value) : DEFAULTS[key];
  } catch (e) {
    // A broken row or a missing table means the default, not a broken site.
    return DEFAULTS[key];
  }
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
