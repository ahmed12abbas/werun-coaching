/* Intervals.icu, the read-only way round, same shape as Strava (lib/strava.js).
   Two secrets from the app's own settings page at intervals.icu/settings/apps
   (client id 961, "WE RUN Coaching"): INTERVALS_CLIENT_ID and
   INTERVALS_CLIENT_SECRET. Neither set means no Intervals.icu at all.

   Intervals.icu hands the athlete's id back in the token response itself —
   no separate profile call needed, unlike Strava's `athlete.id`. */

export const intervalsReady = (env) => !!(env.INTERVALS_CLIENT_ID && env.INTERVALS_CLIENT_SECRET);

const TOKEN_URL = "https://intervals.icu/api/oauth/token";

/** The authorize screen the browser is sent to, scoped to read-only. */
export function authorizeUrl(env, redirectUri, state) {
  const q = new URLSearchParams({
    client_id: env.INTERVALS_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "ACTIVITY:READ",
    state: state,
  });
  return "https://intervals.icu/oauth/authorize?" + q.toString();
}

async function tokenRequest(env, form) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.INTERVALS_CLIENT_ID, client_secret: env.INTERVALS_CLIENT_SECRET, ...form }).toString(),
  });
  if (!res.ok) throw new Error("intervals-token-" + res.status);
  const t = await res.json();
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token || form.refresh_token || "",
    expires_at: Math.floor(Date.now() / 1000) + (Number(t.expires_in) || 3600),
    athlete_id: String(t.athlete_id || ""),
  };
}

/** The one-time code Intervals.icu sent back, spent for a token pair. */
export const exchangeCode = (env, code, redirectUri) =>
  tokenRequest(env, { code: code, grant_type: "authorization_code", redirect_uri: redirectUri });

/** A live access token for this row, refreshing it first if it is due to expire. */
export async function freshToken(env, link) {
  if (link.expires_at > Math.floor(Date.now() / 1000) + 60) return link;
  return tokenRequest(env, { refresh_token: link.refresh_token, grant_type: "refresh_token" });
}

/** This week's activities, Sunday to today, in the shape weekSummary reads. */
export async function activitiesSince(athleteId, accessToken, sunday) {
  const res = await fetch(
    "https://intervals.icu/api/v1/athlete/" + encodeURIComponent(athleteId) + "/activities?oldest=" + sunday,
    { headers: { authorization: "Bearer " + accessToken } }
  );
  if (!res.ok) throw new Error("intervals-activities-" + res.status);
  return res.json();
}
