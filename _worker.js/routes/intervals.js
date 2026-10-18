/* Intervals.icu, linked to an account and read on the Home screen.

   The same three parties as Strava (routes/strava.js) — "connect" hands the
   browser a URL, Intervals.icu sends it back to GET /api/intervals/callback
   with a code, "home" reads this week live. The state round trip is the CSRF
   defence, exactly as for Strava.

   "sync" writes the club's next four weeks onto the athlete's Intervals.icu
   calendar, which passes them on to their watch. The phone builds the events
   — it already decodes a session and writes its .fit (js/model.js, js/fit.js),
   and the Worker has neither — and this only checks their shape and forwards
   them. All it can write is the caller's own calendar, which they could
   write themselves. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { withMember, nowISO } from "../lib/auth.js";
import { hex } from "../lib/crypto.js";
import { intervalsReady, authorizeUrl, exchangeCode, freshToken, activitiesSince, putEvents, dropEvents } from "../lib/intervals.js";
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
    if (await tooOften(e.DB, "il", user.id, 30, 60)) return json({ error: "too-often" }, 429);

    if (action === "connect") return connect(e, req, user);
    if (action === "disconnect") return disconnect(e, user);
    if (action === "home") return home(e, user);
    if (action === "sync") return sync(e, user, body);
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

/* What the phone may send: four weeks of the club's sessions and nothing
   bigger. A .fit for a speed session is a couple of kilobytes. */
const SYNC_MAX = 80; // ten slots a week over four weeks is ~48, plus one-offs
const FIT_MAX = 12000; // base64 characters
const EXT_ID = /^werun-[A-Za-z0-9_-]{1,64}-\d{4}-\d{2}-\d{2}$/;
const LOCAL_START = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/;
const cut = (v, n) => String(v == null ? "" : v).slice(0, n);

function cleanEvent(e) {
  if (!e || !EXT_ID.test(String(e.external_id)) || !LOCAL_START.test(String(e.start))) return null;
  const out = {
    category: "WORKOUT",
    type: "Run",
    external_id: e.external_id,
    start_date_local: e.start,
    name: cut(e.name, 120) || "WE RUN",
    description: cut(e.description, 500),
  };
  const fit = String(e.fit || "");
  if (fit && fit.length <= FIT_MAX && /^[A-Za-z0-9+/]+=*$/.test(fit)) {
    out.filename = "werun.fit";
    out.file_contents_base64 = fit;
  }
  return out;
}

async function sync(env, user, body) {
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, SYNC_MAX).map(cleanEvent).filter(Boolean);
  const remove = (Array.isArray(body.remove) ? body.remove : []).slice(0, SYNC_MAX).filter((id) => EXT_ID.test(String(id)));
  let link;
  try {
    link = await env.DB.prepare("SELECT * FROM intervals_links WHERE user_id = ?").bind(user.id).first();
  } catch (err) {
    link = null;
  }
  if (!link) return json({ error: "intervals-not-linked" }, 409);

  const fresh = await freshToken(env, link);
  if (fresh.access_token !== link.access_token) await saveTokens(env, user.id, fresh);
  try {
    if (events.length) await putEvents(link.athlete_id, fresh.access_token, events);
    if (remove.length) await dropEvents(link.athlete_id, fresh.access_token, remove);
  } catch (err) {
    // Linked before calendar writing was asked for: the token can read runs
    // but not write the calendar, and only connecting again fixes that.
    if (err.status === 401 || err.status === 403) return json({ error: "intervals-reconnect" }, 409);
    throw err;
  }
  return json({ ok: true, sent: events.length, removed: remove.length });
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
