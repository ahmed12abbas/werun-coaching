/* Intervals.icu, the read-only way round, same shape as Strava (lib/strava.js).
   Two secrets from the app's own settings page at intervals.icu/settings/apps
   (client id 961, "WE RUN Coaching"): INTERVALS_CLIENT_ID and
   INTERVALS_CLIENT_SECRET. Neither set means no Intervals.icu at all.

   Intervals.icu hands the athlete's id back in the token response itself —
   no separate profile call needed, unlike Strava's `athlete.id`. */

import { postForm } from "./oauth.js";

export const intervalsReady = (env) => !!(env.INTERVALS_CLIENT_ID && env.INTERVALS_CLIENT_SECRET);

const TOKEN_URL = "https://intervals.icu/api/oauth/token";

/** The authorize screen the browser is sent to: read their runs, write the club's sessions onto their calendar. */
export function authorizeUrl(env, redirectUri, state) {
  const q = new URLSearchParams({
    client_id: env.INTERVALS_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "ACTIVITY:READ,CALENDAR:WRITE",
    state: state,
  });
  return "https://intervals.icu/oauth/authorize?" + q.toString();
}

async function tokenRequest(env, form) {
  const t = await postForm(TOKEN_URL, { client_id: env.INTERVALS_CLIENT_ID, client_secret: env.INTERVALS_CLIENT_SECRET, ...form }, "intervals-token");
  // The answer is { access_token, scope, athlete: { id, name } }: no refresh
  // token and no expiry — the token lasts until the athlete revokes it. Reading
  // `athlete_id` and assuming an hour's life is what dropped every link on its
  // first Home read (forum.intervals.icu/t/intervals-icu-oauth-support/2759).
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token || form.refresh_token || "",
    expires_at: t.expires_in ? Math.floor(Date.now() / 1000) + Number(t.expires_in) : NEVER,
    athlete_id: String((t.athlete && t.athlete.id) || t.athlete_id || ""),
  };
}

const NEVER = 2147483647;

/* "0" is the token's own athlete in any path, so a row saved before the
   athlete id was read correctly still works. */
const athletePath = (athleteId) => "https://intervals.icu/api/v1/athlete/" + encodeURIComponent(athleteId || "0");

/** The one-time code Intervals.icu sent back, spent for a token pair. */
export const exchangeCode = (env, code, redirectUri) =>
  tokenRequest(env, { code: code, grant_type: "authorization_code", redirect_uri: redirectUri });

/** A live access token for this row, refreshing it first if it is due to expire. */
export async function freshToken(env, link) {
  // No refresh token means one that does not expire — and links saved before
  // that was known carry a made-up hour, so the expiry alone cannot say.
  if (!link.refresh_token || link.expires_at > Math.floor(Date.now() / 1000) + 60) return link;
  return tokenRequest(env, { refresh_token: link.refresh_token, grant_type: "refresh_token" });
}

/** This week's activities, Sunday to today, in the shape weekSummary reads. */
export async function activitiesSince(athleteId, accessToken, sunday) {
  const res = await fetch(athletePath(athleteId) + "/activities?oldest=" + sunday, {
    headers: { authorization: "Bearer " + accessToken },
  });
  if (!res.ok) {
    const err = new Error("intervals-activities-" + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** One activity's laps as Intervals.icu splits them — reps and recoveries
    for a session, one long interval for an easy run. The token only reads
    its own athlete's activities, so an id is all that needs checking. */
export async function activityIntervals(accessToken, id) {
  const res = await fetch("https://intervals.icu/api/v1/activity/" + encodeURIComponent(id) + "/intervals", {
    headers: { authorization: "Bearer " + accessToken },
  });
  if (!res.ok) {
    const err = new Error("intervals-activity-" + res.status);
    err.status = res.status;
    throw err;
  }
  const d = await res.json();
  return (d.icu_intervals || []).slice(0, 80).map((i) => ({
    work: i.type === "WORK",
    distance_m: Number(i.distance) || 0,
    moving_s: Number(i.moving_time || i.elapsed_time) || 0,
    hr: Math.round(Number(i.average_heartrate)) || null,
  }));
}

/* The club's sessions onto the athlete's Intervals.icu calendar, which hands
   them on to whatever watch they linked there (Garmin, COROS, Suunto…).
   external_id is the upsert key, so sending the same four weeks again updates
   them in place rather than stacking copies. */
async function calendarCall(athleteId, accessToken, method, path, body) {
  const res = await fetch(athletePath(athleteId) + "/events/" + path, {
    method: method,
    headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error("intervals-events-" + res.status);
    err.status = res.status;
    throw err;
  }
}

export const putEvents = (athleteId, token, events) => calendarCall(athleteId, token, "POST", "bulk?upsert=true&upsertOnUid=false&updatePlanApplied=false", events);
export const dropEvents = (athleteId, token, ids) =>
  calendarCall(athleteId, token, "PUT", "bulk-delete", ids.map((id) => ({ external_id: id })));
