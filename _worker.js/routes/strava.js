/* Strava, linked to an account and read on the Home screen.

   Three parties, same shape as push (see lib/push.js): the app calls
   action "connect" for the URL to send the browser to, Strava sends the
   browser back to GET /api/strava/callback with a code, and action "home"
   is what the Home screen reads afterwards — a live call to Strava, not a
   mirrored copy, so a run deleted there stops showing up here too.

   The `state` round trip is the whole of the CSRF defence: connect() mints
   one, keyed to this user, in STATS with a ten-minute TTL; the callback
   spends it once and never trusts its own cookie, because Strava's redirect
   is what proves which browser asked, not who happens to be logged in when
   it lands. No state, or a state nobody minted, is a code worth nothing.

   The table arrives after the code that reads it, as everything here does,
   so every read is wrapped and answers "off" rather than 500. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { withMember, nowISO } from "../lib/auth.js";
import { hex } from "../lib/crypto.js";
import { stravaReady, authorizeUrl, exchangeCode, freshToken, activitiesSince } from "../lib/strava.js";
import { clubWeekStart } from "../lib/week.js";

const CLUB_OFFSET = "+03:00"; // Riyadh, all year, no daylight saving

/** Unix seconds for Sunday 00:00 in the club's own week, by the club's own clock. */
function weekStartEpoch() {
  const riyadhToday = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const sunday = clubWeekStart(riyadhToday);
  return { epoch: Math.floor(Date.parse(sunday + "T00:00:00" + CLUB_OFFSET) / 1000), sunday };
}

/* Strava's start_date_local is local wall-clock time written with a "Z" —
   parsing it as UTC and reading the UTC weekday back out gives the athlete's
   own day, not the club server's. */
function weekSummary(activities, sunday) {
  const days = new Array(7).fill(0);
  let total_m = 0;
  for (const a of activities) {
    if ((a.type || "") !== "Run") continue;
    const d = new Date(a.start_date_local || a.start_date);
    if (isNaN(d)) continue;
    const meters = Number(a.distance) || 0;
    days[d.getUTCDay()] += meters;
    total_m += meters;
  }
  return { start: sunday, days: days, total_m: total_m };
}

const STATE_TTL = 600;
const REDIRECT_TO = "/app.html#/home";

const redirectUri = (request) => new URL(request.url).origin + "/api/strava/callback";
const stateKey = (state) => "stlink:" + state;

/* ---------- POST /api/strava ---------------------------------------------- */

export async function strava(request, env) {
  if (!env.DB || !env.STATS) return json({ error: "strava-off" }, 503);
  if (!stravaReady(env)) return json({ error: "strava-off" }, 503);

  return withMember(async (req, e, user) => {
    const body = await readBody(req);
    const action = String(body.action || "home");
    if (await tooOften(e.STATS, "sl", user.id, 30, 60)) return json({ error: "too-often" }, 429);

    if (action === "connect") return connect(e, req, user);
    if (action === "disconnect") return disconnect(e, user);
    if (action === "home") return home(e, user);
    return json({ error: "bad-request" }, 400);
  })(request, env);
}

async function connect(env, request, user) {
  const state = hex(crypto.getRandomValues(new Uint8Array(16)));
  await env.STATS.put(stateKey(state), user.id, { expirationTtl: STATE_TTL });
  return json({ url: authorizeUrl(env, redirectUri(request), state) });
}

async function disconnect(env, user) {
  try {
    await env.DB.prepare("DELETE FROM strava_links WHERE user_id = ?").bind(user.id).run();
  } catch (err) {
    console.error("strava: no strava_links yet (" + (err && err.message) + ")");
  }
  return json({ connected: false });
}

async function home(env, user) {
  let link;
  try {
    link = await env.DB.prepare("SELECT * FROM strava_links WHERE user_id = ?").bind(user.id).first();
  } catch (err) {
    console.error("strava: no strava_links yet (" + (err && err.message) + ")");
    return json({ connected: false });
  }
  if (!link) return json({ connected: false });

  try {
    const fresh = await freshToken(env, link);
    if (fresh.access_token !== link.access_token) await saveTokens(env, user.id, fresh);
    const { epoch, sunday } = weekStartEpoch();
    const activities = await activitiesSince(fresh.access_token, epoch);
    return json({ connected: true, week: weekSummary(activities, sunday) });
  } catch (err) {
    // A refresh Strava refuses is an athlete who revoked us on their side —
    // the row is dead either way, so it comes down rather than failing the
    // same way on every Home load from here on.
    console.error("strava: home failed (" + (err && err.message) + ")");
    await env.DB.prepare("DELETE FROM strava_links WHERE user_id = ?").bind(user.id).run();
    return json({ connected: false });
  }
}

async function saveTokens(env, userId, t) {
  await env.DB.prepare("UPDATE strava_links SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?")
    .bind(t.access_token, t.refresh_token, t.expires_at, userId)
    .run();
}

/* ---------- GET /api/strava/callback --------------------------------------- */

export async function stravaCallback(request, env) {
  const url = new URL(request.url);
  const bounce = () => Response.redirect(url.origin + REDIRECT_TO, 302);

  if (!env.DB || !env.STATS || !stravaReady(env)) return bounce();

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!state || !code) return bounce();

  const userId = await env.STATS.get(stateKey(state));
  await env.STATS.delete(stateKey(state)); // one-time, spent whether it matched or not
  if (!userId) return bounce();

  try {
    const t = await exchangeCode(env, code);
    await env.DB.prepare(
      "INSERT INTO strava_links (user_id, athlete_id, access_token, refresh_token, expires_at, connected_at)" +
        " VALUES (?, ?, ?, ?, ?, ?)" +
        " ON CONFLICT(user_id) DO UPDATE SET athlete_id = excluded.athlete_id, access_token = excluded.access_token," +
        " refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, connected_at = excluded.connected_at"
    )
      .bind(userId, String((t.athlete && t.athlete.id) || ""), t.access_token, t.refresh_token, t.expires_at, nowISO())
      .run();
  } catch (err) {
    console.error("strava: callback failed (" + (err && err.message) + ")");
  }
  return bounce();
}
