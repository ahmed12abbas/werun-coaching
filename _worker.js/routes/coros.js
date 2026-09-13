/* COROS, linked to an account and read on the Home screen.

   The same three parties as Strava (routes/strava.js) — "connect" hands the
   browser a URL, COROS sends it back to GET /api/coros/callback with a code,
   "home" reads this week live — but through COROS's self-service MCP server
   rather than a partner API, so there is nothing to apply for and nothing to
   set on Pages. Read-only: COROS lists the tools that write workouts as
   "coming soon", and they go in here once they ship.

   What is different from Strava:
   - No client secret. The Worker registers itself with COROS the first time
     anyone connects from an origin (lib/coros.js, clientIdFor).
   - PKCE, so the verifier rides in the same one-time KV state as the user id,
     along with the cluster and client id it was minted for.
   - COROS runs three clusters and a token is only good at the one that issued
     it, so the row remembers which.

   The state round trip is the CSRF defence, exactly as for Strava. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { withMember, nowISO } from "../lib/auth.js";
import { hex } from "../lib/crypto.js";
import { discoverIssuer, clientIdFor, pkcePair, authorizeUrl, exchangeCode, freshToken, runsSince } from "../lib/coros.js";
import { weekStartEpoch, weekSummary, riyadhToday } from "../lib/week.js";

const STATE_TTL = 600;
const REDIRECT_TO = "/app.html#/home";

const redirectUri = (request) => new URL(request.url).origin + "/api/coros/callback";
const stateKey = (state) => "colink:" + state;

/* ---------- POST /api/coros ----------------------------------------------- */

export async function coros(request, env) {
  if (!env.DB || !env.STATS) return json({ error: "coros-off" }, 503);

  return withMember(async (req, e, user) => {
    const body = await readBody(req);
    const action = String(body.action || "home");
    if (await tooOften(e.STATS, "cl", user.id, 30, 60)) return json({ error: "too-often" }, 429);

    if (action === "connect") return connect(e, req, user);
    if (action === "disconnect") return disconnect(e, user);
    if (action === "home") return home(e, user);
    return json({ error: "bad-request" }, 400);
  })(request, env);
}

async function connect(env, request, user) {
  const issuer = await discoverIssuer();
  const redirect = redirectUri(request);
  const clientId = await clientIdFor(env.STATS, issuer, redirect);
  const { verifier, challenge } = await pkcePair();
  const state = hex(crypto.getRandomValues(new Uint8Array(16)));
  await env.STATS.put(stateKey(state), JSON.stringify({ u: user.id, v: verifier, i: issuer, c: clientId }), {
    expirationTtl: STATE_TTL,
  });
  return json({ url: authorizeUrl(issuer, clientId, redirect, challenge, state) });
}

async function disconnect(env, user) {
  try {
    await env.DB.prepare("DELETE FROM coros_links WHERE user_id = ?").bind(user.id).run();
  } catch (err) {
    console.error("coros: no coros_links yet (" + (err && err.message) + ")");
  }
  return json({ connected: false });
}

async function home(env, user) {
  let link;
  try {
    link = await env.DB.prepare("SELECT * FROM coros_links WHERE user_id = ?").bind(user.id).first();
  } catch (err) {
    console.error("coros: no coros_links yet (" + (err && err.message) + ")");
    return json({ connected: false });
  }
  if (!link) return json({ connected: false });

  let fresh;
  try {
    fresh = await freshToken(link);
  } catch (err) {
    console.error("coros: refresh failed (" + (err && err.message) + ")");
    // Refused outright is an athlete who revoked us on COROS's side: the row
    // is dead, so it comes down. A timeout or a 500 is COROS having a bad
    // minute, and must not unlink anybody.
    if (err && err.refused) {
      await env.DB.prepare("DELETE FROM coros_links WHERE user_id = ?").bind(user.id).run();
      return json({ connected: false });
    }
    return json({ error: "coros-unavailable" }, 502);
  }
  if (fresh.access_token !== link.access_token) {
    await env.DB.prepare("UPDATE coros_links SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?")
      .bind(fresh.access_token, fresh.refresh_token, fresh.expires_at, user.id)
      .run();
  }

  const { sunday } = weekStartEpoch();
  try {
    const runs = await runsSince(link.issuer, fresh.access_token, sunday, riyadhToday());
    return json({ connected: true, week: weekSummary(runs, sunday) });
  } catch (err) {
    // A week of zeros would be a lie; saying nothing is not.
    console.error("coros: runs failed (" + (err && err.message) + ")");
    return json({ error: "coros-unavailable" }, 502);
  }
}

/* ---------- GET /api/coros/callback ---------------------------------------- */

export async function corosCallback(request, env) {
  const url = new URL(request.url);
  const bounce = () => Response.redirect(url.origin + REDIRECT_TO, 302);

  if (!env.DB || !env.STATS) return bounce();

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!state || !code) return bounce(); // includes an athlete who pressed "deny"

  const raw = await env.STATS.get(stateKey(state));
  await env.STATS.delete(stateKey(state)); // one-time, spent whether it matched or not
  if (!raw) return bounce();

  try {
    const s = JSON.parse(raw);
    const t = await exchangeCode(s.i, s.c, redirectUri(request), code, s.v);
    await env.DB.prepare(
      "INSERT INTO coros_links (user_id, issuer, client_id, access_token, refresh_token, expires_at, connected_at)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?)" +
        " ON CONFLICT(user_id) DO UPDATE SET issuer = excluded.issuer, client_id = excluded.client_id," +
        " access_token = excluded.access_token, refresh_token = excluded.refresh_token," +
        " expires_at = excluded.expires_at, connected_at = excluded.connected_at"
    )
      .bind(s.u, s.i, s.c, t.access_token, t.refresh_token, t.expires_at, nowISO())
      .run();
  } catch (err) {
    console.error("coros: callback failed (" + (err && err.message) + ")");
  }
  return bounce();
}
