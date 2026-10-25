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
  announcement_en: "", // a line across the top of the app; empty means none
  announcement_ar: "",
  announcement_url: "", // where the announcement goes when tapped; empty means it is just text
  // Athletes see a message instead of the week; coaches carry on working, and
  // logging in and out keeps working for everyone, so this cannot lock the
  // club out of its own site.
  maintenance: false,
  // Off until an admin turns it on: whether showing the check-in code also
  // needs the coach's phone to be near the meeting point. See lib/geo.js.
  checkin_location_required: false,
  // The app's look, from /admin: the brand colour ("#rrggbb") and two
  // uploaded images, each "" for the club's own. Put into every athlete page
  // by lib/theme.js before it paints.
  theme_color: "",
  logo_url: "",
  intro_url: "",
  intro_swoosh: true, // the swoosh beside the logo on the intro
  // The Pink Run/Walk page (routes/pink.js): shut until an admin has looked
  // it over and opened it, and how many people it takes.
  pink_open: false,
  pink_cap: 60,
};

/* The whole table in one read, shared by every key and every request this
   isolate serves for a minute. D1 is in Amsterdam: one query per key made a
   cold page wait on four round trips before it sent a byte, and /admin's
   settings card on seventeen in a row. */
const TTL = 60 * 1000;
let table = null; // { values: {key: value}, at }
let loading = null; // the read in flight, so Promise.all of four keys is one query

async function loadTable(env) {
  if (table && Date.now() - table.at < TTL) return table.values;
  if (!loading) {
    loading = readTable(env).then((values) => {
      table = { values: values, at: Date.now() };
      loading = null;
      return values;
    });
  }
  return loading;
}

/* Every row that parses; anything missing or broken falls to its default. */
async function readTable(env) {
  const values = {};
  if (!env.DB) return values;
  try {
    const rows = await env.DB.prepare("SELECT key, value FROM settings").all();
    for (const r of rows.results || []) {
      try {
        if (r.value != null) values[r.key] = JSON.parse(r.value);
      } catch (e) {} // a broken row means the default, not a broken site
    }
  } catch (e) {
    // A missing table means the defaults, not a broken site.
  }
  return values;
}

export async function getSetting(env, key) {
  const values = await loadTable(env);
  return key in values ? values[key] : DEFAULTS[key];
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)" +
      " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  )
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run();
  if (table) table.values[key] = value;
}

/** Every known setting, defaults filled in — for the admin page. */
export async function allSettings(env) {
  const values = await loadTable(env);
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = key in values ? values[key] : DEFAULTS[key];
  return out;
}
