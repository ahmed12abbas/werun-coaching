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
import { stravaReady, authorizeUrl, exchangeCode, freshToken, activitiesSince, recentActivities, activityDetail } from "../lib/strava.js";
import { clubWeekStart } from "../lib/week.js";
import { hasColumn } from "../lib/columns.js";

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
    if (action === "refresh-bests") return refreshBestsAction(e, user);
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
    const bests = await cachedBests(env, user, fresh.access_token);
    return json({ connected: true, week: weekSummary(activities, sunday), bests });
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

// Strava's own names for the splits it computes, mapped to our columns.
const BEST_NAMES = { "1K": "secs_1k", "5K": "secs_5k", "10K": "secs_10k", "Half-Marathon": "secs_21k", "Marathon": "secs_42k" };
// ponytail: recent runs only, not the athlete's whole history — a full scan
// is one Strava call per run against a rate limit shared by the whole club.
// A PR set before this window drops off until a run near it happens again.
const SCAN_RUNS = 20;
const RESCAN_AFTER_MS = 15 * 60 * 1000;

async function bestsRow(env, userId) {
  return env.DB.prepare("SELECT * FROM strava_bests WHERE user_id = ?").bind(userId).first();
}

/** Cached PRs for the Home card — scanned once on first connect, never blocking a normal load again.
    null while the migration hasn't landed yet (see hasColumn note in lib/columns.js). */
async function cachedBests(env, user, accessToken) {
  if (!(await hasColumn(env, "strava_bests", "user_id"))) return null;
  const row = await bestsRow(env, user.id);
  if (row) return pickBests(row);
  return refreshBests(env, user, accessToken, null);
}

async function refreshBestsAction(env, user) {
  if (!(await hasColumn(env, "strava_bests", "user_id"))) return json({ bests: null });
  const link = await env.DB.prepare("SELECT * FROM strava_links WHERE user_id = ?").bind(user.id).first();
  if (!link) return json({ error: "not-connected" }, 400);
  const row = await bestsRow(env, user.id);
  if (row && Date.now() - Date.parse(row.updated_at) < RESCAN_AFTER_MS) return json({ bests: pickBests(row) });
  const fresh = await freshToken(env, link);
  if (fresh.access_token !== link.access_token) await saveTokens(env, user.id, fresh);
  return json({ bests: await refreshBests(env, user, fresh.access_token, row) });
}

const pickBests = (row) => ({ secs_1k: row.secs_1k, secs_5k: row.secs_5k, secs_10k: row.secs_10k, secs_21k: row.secs_21k, secs_42k: row.secs_42k });

/** Scans the athlete's most recent runs for best_efforts, merged into whatever is already cached — a rescan only ever improves a PR, never loses one that fell outside this window. */
async function refreshBests(env, user, accessToken, prevRow) {
  const best = prevRow ? pickBests(prevRow) : { secs_1k: null, secs_5k: null, secs_10k: null, secs_21k: null, secs_42k: null };
  let activities;
  try {
    activities = await recentActivities(accessToken, SCAN_RUNS);
  } catch (err) {
    console.error("strava: bests scan failed (" + (err && err.message) + ")");
    return best;
  }
  const runs = activities.filter((a) => (a.type || "") === "Run");
  const details = await Promise.all(
    runs.map((r) => activityDetail(accessToken, r.id).catch(() => null))
  );
  for (const detail of details) {
    for (const effort of (detail && detail.best_efforts) || []) {
      const col = BEST_NAMES[effort.name];
      const secs = Number(effort.elapsed_time);
      if (col && secs > 0 && (best[col] == null || secs < best[col])) best[col] = secs;
    }
  }
  try {
    await env.DB.prepare(
      "INSERT INTO strava_bests (user_id, secs_1k, secs_5k, secs_10k, secs_21k, secs_42k, updated_at)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?)" +
        " ON CONFLICT(user_id) DO UPDATE SET secs_1k=excluded.secs_1k, secs_5k=excluded.secs_5k," +
        " secs_10k=excluded.secs_10k, secs_21k=excluded.secs_21k, secs_42k=excluded.secs_42k, updated_at=excluded.updated_at"
    )
      .bind(user.id, best.secs_1k, best.secs_5k, best.secs_10k, best.secs_21k, best.secs_42k, nowISO())
      .run();
  } catch (err) {
    console.error("strava: could not cache bests (" + (err && err.message) + ")");
  }
  return best;
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
