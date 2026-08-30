/* =========================================================================
   WE RUN Coaching — connect Worker.

   The only reason this exists: the intervals.icu client secret and the
   athlete's access token must never be in the browser. Everything else the
   site does is static.

   Routes
     GET  /oauth/start?return=<url>   send the athlete to intervals.icu
     GET  /oauth/callback?code&state  swap the code for a token, hand back
                                      an opaque handle
     GET  /api/me                     who is linked, and is Garmin upload on
     POST /api/push                   put a session on their calendar
     GET  /health                     deploy check

   Bindings (see wrangler.toml)
     LINKS                  KV namespace
     INTERVALS_CLIENT_ID    var
     INTERVALS_CLIENT_SECRET secret  (npx wrangler secret put ...)
     ALLOWED_ORIGINS        var, comma separated; "*" allows any
   ========================================================================= */

const INTERVALS = "https://intervals.icu";
const SCOPE = "CALENDAR:WRITE";
const STATE_TTL = 600; // 10 minutes to finish the approval
const LINK_TTL = 60 * 60 * 24 * 365; // a season

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return preflight(request, env);

    try {
      if (path === "/health") return json({ ok: true, configured: !!env.INTERVALS_CLIENT_ID }, 200, request, env);
      if (path === "/oauth/start") return oauthStart(request, env, url);
      if (path === "/oauth/callback") return oauthCallback(request, env, url);
      if (path === "/api/me") return apiMe(request, env);
      if (path === "/api/push") return apiPush(request, env);
      return json({ error: "Not found" }, 404, request, env);
    } catch (e) {
      return json({ error: e.message || "Unexpected error" }, 500, request, env);
    }
  },
};

/* ---------- CORS ---------------------------------------------------------- */

function allowOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const list = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes("*")) return origin || "*";
  return list.includes(origin) ? origin : "";
}

function corsHeaders(request, env) {
  const origin = allowOrigin(request, env);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function preflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders(request, env)),
  });
}

/* ---------- OAuth --------------------------------------------------------- */

const rand = (n) => {
  const b = new Uint8Array(n || 24);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

function redirectUri(url) {
  return url.origin + "/oauth/callback";
}

async function oauthStart(request, env, url) {
  if (!env.INTERVALS_CLIENT_ID) {
    return html("One-tap delivery isn't configured yet — the club's coach still needs to finish setup.", 503);
  }
  const back = url.searchParams.get("return") || "";
  if (!back || !/^https?:\/\//.test(back)) return html("Missing return address.", 400);

  const state = rand(16);
  await env.LINKS.put("state:" + state, back, { expirationTtl: STATE_TTL });

  const go = new URL(INTERVALS + "/oauth/authorize");
  go.searchParams.set("client_id", env.INTERVALS_CLIENT_ID);
  go.searchParams.set("redirect_uri", redirectUri(url));
  go.searchParams.set("scope", SCOPE);
  go.searchParams.set("state", state);
  return Response.redirect(go.toString(), 302);
}

async function oauthCallback(request, env, url) {
  const state = url.searchParams.get("state") || "";
  const back = state ? await env.LINKS.get("state:" + state) : null;
  if (!back) return html("That approval link expired. Go back to the session and tap Connect again.", 400);
  await env.LINKS.delete("state:" + state);

  const denied = url.searchParams.get("error");
  if (denied) return Response.redirect(withParam(back, "link_error", denied), 302);

  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(withParam(back, "link_error", "no_code"), 302);

  // Swap the one-time code for an access token. The token stays here.
  const form = new URLSearchParams({
    client_id: env.INTERVALS_CLIENT_ID,
    client_secret: env.INTERVALS_CLIENT_SECRET,
    code: code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(url),
  });
  const res = await fetch(INTERVALS + "/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) return Response.redirect(withParam(back, "link_error", "token_" + res.status), 302);

  const tok = await res.json();
  if (!tok.access_token) return Response.redirect(withParam(back, "link_error", "no_token"), 302);

  const handle = rand(24);
  await env.LINKS.put(
    "link:" + handle,
    JSON.stringify({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || null,
      athlete_id: tok.athlete_id || (tok.athlete && tok.athlete.id) || 0,
      created: Date.now(),
    }),
    { expirationTtl: LINK_TTL }
  );

  return Response.redirect(withParam(back, "linked", handle), 302);
}

/** Add a query param while leaving any #w= fragment intact. */
function withParam(href, key, value) {
  const u = new URL(href);
  u.searchParams.set(key, value);
  return u.toString();
}

function html(message, status) {
  return new Response(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;display:grid;" +
      "place-items:center;min-height:100vh;background:#f7f7fa;color:#14121c;padding:24px;text-align:center}" +
      "div{max-width:26rem}</style><div><p>" + message + "</p></div>",
    { status: status || 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

/* ---------- authenticated calls ------------------------------------------ */

async function linkFor(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const handle = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!handle) return null;
  const raw = await env.LINKS.get("link:" + handle);
  return raw ? JSON.parse(raw) : null;
}

function icu(link, path, init) {
  return fetch(INTERVALS + path,
    Object.assign({}, init, {
      headers: Object.assign(
        { Authorization: "Bearer " + link.access_token, "Content-Type": "application/json" },
        (init && init.headers) || {}
      ),
    })
  );
}

async function apiMe(request, env) {
  const link = await linkFor(request, env);
  if (!link) return json({ error: "Not linked" }, 401, request, env);

  const res = await icu(link, "/api/v1/athlete/0/profile");
  if (res.status === 401 || res.status === 403) return json({ error: "Not linked" }, 401, request, env);
  if (!res.ok) return json({ error: "intervals.icu said " + res.status }, 502, request, env);

  const p = await res.json();
  const a = p.athlete || p;
  return json(
    {
      athlete: a.name || a.first_name || "your intervals.icu account",
      // Athletes must tick "Upload planned workouts" over there for the
      // session to reach Garmin. The flag's name has moved around, so treat
      // "can't tell" as fine rather than nagging people wrongly.
      garminLinked: readGarminFlag(a),
    },
    200,
    request,
    env
  );
}

function readGarminFlag(a) {
  const candidates = [a.icu_sync_garmin_workouts, a.upload_planned_workouts, a.garmin_upload_workouts];
  for (const c of candidates) if (typeof c === "boolean") return c;
  return null; // unknown — don't warn
}

async function apiPush(request, env) {
  const link = await linkFor(request, env);
  if (!link) return json({ error: "Not linked" }, 401, request, env);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Bad request" }, 400, request, env);
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : null;
  if (!date) return json({ error: "Pick a date first" }, 400, request, env);
  const name = String(body.name || "Session").slice(0, 120);

  const event = {
    category: "WORKOUT",
    start_date_local: date + "T00:00:00",
    type: "Run",
    name: name,
    description: String(body.description || "").slice(0, 8000),
    // external_id makes a re-send replace the same event instead of stacking
    // duplicates on the athlete's calendar.
    external_id: "werun-" + date + "-" + hash(name),
  };

  // The .fit built in the browser carries the exact steps and targets;
  // the description is the human-readable version alongside it.
  if (body.fitBase64) {
    event.filename = (body.filename || "session.fit").replace(/[^a-zA-Z0-9._-]/g, "-");
    event.file_contents_base64 = body.fitBase64;
  }

  const res = await icu(link, "/api/v1/athlete/0/events", {
    method: "POST",
    body: JSON.stringify(event),
  });

  if (res.status === 401 || res.status === 403) return json({ error: "Not linked" }, 401, request, env);
  if (!res.ok) {
    const text = await res.text();
    return json({ error: "intervals.icu rejected it (" + res.status + "): " + text.slice(0, 200) }, 502, request, env);
  }
  return json({ ok: true, date: date }, 200, request, env);
}

/** Small stable id so the same session on the same day upserts. */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
