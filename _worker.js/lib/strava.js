/* Strava, the read-only way round.
   Two secrets from the app's own settings page at
   strava.com/settings/api: STRAVA_CLIENT_ID (public, but kept a secret here
   since there is no other place on Pages to put it) and
   STRAVA_CLIENT_SECRET. Neither set means no Strava at all, answered
   plainly, the same way push and email do without their own secrets. */

export const stravaReady = (env) => !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);

const TOKEN_URL = "https://www.strava.com/oauth/token";

/** The authorize screen the browser is sent to, scoped to read-only. */
export function authorizeUrl(env, redirectUri, state) {
  const q = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "activity:read",
    state: state,
  });
  return "https://www.strava.com/oauth/authorize?" + q.toString();
}

/** The one-time code Strava sent back, spent for a token pair. */
export async function exchangeCode(env, code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      code: code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error("strava-exchange-" + res.status);
  return res.json(); // { access_token, refresh_token, expires_at, athlete: { id } }
}

/** A live access token for this row, refreshing it first if it is due to expire. */
export async function freshToken(env, link) {
  if (link.expires_at > Math.floor(Date.now() / 1000) + 60) return link;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token: link.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("strava-refresh-" + res.status);
  const t = await res.json();
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at };
}

/** Every activity since `afterEpoch` (unix seconds), newest first. */
export async function activitiesSince(accessToken, afterEpoch) {
  const res = await fetch(
    "https://www.strava.com/api/v3/athlete/activities?after=" + afterEpoch + "&per_page=100",
    { headers: { authorization: "Bearer " + accessToken } }
  );
  if (!res.ok) throw new Error("strava-activities-" + res.status);
  return res.json();
}
