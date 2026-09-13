/* Intervals.icu, linked to an account and read on the Home screen.

   The same three parties as Strava (routes/strava.js) — "connect" hands the
   browser a URL, Intervals.icu sends it back to GET /api/intervals/callback
   with a code, "home" reads this week live. The state round trip is the CSRF
   defence, exactly as for Strava.

   Read-only for now: pushing the coach's sessions onto an athlete's calendar
   (CALENDAR:WRITE, the other scope this app was registered for) is a
   separate feature, not built yet. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { withMember, nowISO } from "../lib/auth.js";
import { hex } from "../lib/crypto.js";
import { intervalsReady, authorizeUrl, exchangeCode, freshToken, activitiesSince } from "../lib/intervals.js";
import { weekStartEpoch, weekSummary } from "../lib/week.js";

const STATE_TTL = 600;
const REDIRECT_TO = "/app.html#/home";

const redirectUri = (request) => new URL(request.url).origin + "/api/intervals/callback";
const stateKey = (state) => "illink:" + state;

/* ---------- POST /api/intervals -------------------------------------------- */

export async function intervals(request, env) {
  if (!env.DB || !env.STATS) return json({ error: "intervals-off" }, 503);
  if (!intervalsReady(env)) return json({ error: "intervals-off" }, 503);

  return withMember(async (req, e, user) => {
    const body = await readBody(req);
    const action = String(body.action || "home");
    if (await tooOften(e.STATS, "il", user.id, 30, 60)) return json({ error: "too-often" }, 429);

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
    await env.DB.prepare("DELETE FROM intervals_links WHERE user_id = ?").bind(user.id).run();
  } catch (err) {
    console.error("intervals: no intervals_links yet (" + (err && err.message) + ")");
  }
  return json({ connected: false });
}

async function home(env, user) {
  let link;
  try {
    link = await env.DB.prepare("SELECT * FROM intervals_links WHERE user_id = ?").bind(user.id).first();
  } catch (err) {
    console.error("intervals: no intervals_links yet (" + (err && err.message) + ")");
    return json({ connected: false });
  }
  if (!link) return json({ connected: false });

  try {
    const fresh = await freshToken(env, link);
    if (fresh.access_token !== link.access_token) await saveTokens(env, user.id, fresh);
    const { sunday } = weekStartEpoch();
    const activities = await activitiesSince(link.athlete_id, fresh.access_token, sunday);
    return json({ connected: true, week: weekSummary(activities, sunday) });
  } catch (err) {
    // A refresh Intervals.icu refuses is an athlete who revoked us on their
    // side — the row is dead either way, so it comes down rather than
    // failing the same way on every Home load from here on.
    console.error("intervals: home failed (" + (err && err.message) + ")");
    await env.DB.prepare("DELETE FROM intervals_links WHERE user_id = ?").bind(user.id).run();
    return json({ connected: false });
  }
}

async function saveTokens(env, userId, t) {
  await env.DB.prepare("UPDATE intervals_links SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?")
    .bind(t.access_token, t.refresh_token, t.expires_at, userId)
    .run();
}

/* ---------- GET /api/intervals/callback ------------------------------------ */

export async function intervalsCallback(request, env) {
  const url = new URL(request.url);
  const bounce = () => Response.redirect(url.origin + REDIRECT_TO, 302);

  if (!env.DB || !env.STATS || !intervalsReady(env)) return bounce();

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!state || !code) return bounce();

  const userId = await env.STATS.get(stateKey(state));
  await env.STATS.delete(stateKey(state)); // one-time, spent whether it matched or not
  if (!userId) return bounce();

  try {
    const t = await exchangeCode(env, code, redirectUri(request));
    await env.DB.prepare(
      "INSERT INTO intervals_links (user_id, athlete_id, access_token, refresh_token, expires_at, connected_at)" +
        " VALUES (?, ?, ?, ?, ?, ?)" +
        " ON CONFLICT(user_id) DO UPDATE SET athlete_id = excluded.athlete_id, access_token = excluded.access_token," +
        " refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, connected_at = excluded.connected_at"
    )
      .bind(userId, t.athlete_id, t.access_token, t.refresh_token, t.expires_at, nowISO())
      .run();
  } catch (err) {
    console.error("intervals: callback failed (" + (err && err.message) + ")");
  }
  return bounce();
}
