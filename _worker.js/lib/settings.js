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
  window_before_min: 30, // check-in opens this long before the start
  window_after_min: 45, // …and closes this long after it
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
