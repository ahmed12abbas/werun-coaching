/* COROS through its self-service MCP server ("Build on COROS MCP" on
   support.coros.com): OAuth 2.0 with PKCE, a public client registered on the
   fly, and one tool call for the week's runs. Modelled on COROS's own login
   helper (github.com/coroslab/COROS-MCP, skill/coros_mcp_login_gateway),
   which is the nearest thing there is to documentation of the flow. */

import { sha256 } from "./crypto.js";

const GATEWAY = "https://mcp.coros.com";
const SCOPES = "openid offline_access mcp.tools";
const CLIENT_NAME = "WE RUN Coaching";
// COROS's own sport codes for Run, Indoor Run, Trail Run and Track Run.
const RUN_TYPES = [100, 101, 102, 103];
const RIYADH_S = 3 * 3600; // UTC+3 all year

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The cluster the gateway picks — US, EU or CN — as its issuer URL. */
export async function discoverIssuer() {
  const res = await fetch(GATEWAY + "/.well-known/openid-configuration");
  if (!res.ok) throw new Error("coros-discovery-" + res.status);
  const issuer = String((await res.json()).issuer || "");
  // Tokens are sent wherever this says, so it had better be COROS.
  if (!/^https:\/\/[a-z0-9-]+\.coros\.com$/.test(issuer)) throw new Error("coros-discovery-issuer");
  return issuer;
}

/* One registration per cluster and origin, kept for good. COROS hands a
   client id to anyone who asks (RFC 7591), so there is no secret to set and
   nothing lost if KV forgets one but a second registration. Three clusters
   times the origins the site is served from: the keys cannot pile up. */
export async function clientIdFor(kv, issuer, redirectUri) {
  const key = "coros:client:" + issuer + " " + redirectUri;
  const known = await kv.get(key);
  if (known) return known;
  const res = await fetch(issuer + "/connect/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: SCOPES,
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) throw new Error("coros-register-" + res.status);
  const id = String((await res.json()).client_id || "");
  if (!id) throw new Error("coros-register-empty");
  await kv.put(key, id);
  return id;
}

export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier: verifier, challenge: b64url(await sha256(verifier)) };
}

/** The COROS sign-in screen the browser is sent to. */
export function authorizeUrl(issuer, clientId, redirectUri, challenge, state) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: issuer + "/mcp",
    state: state,
  });
  return issuer + "/oauth2/authorize?" + q.toString();
}

async function tokenRequest(issuer, form) {
  const res = await fetch(issuer + "/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    const err = new Error("coros-token-" + res.status);
    err.refused = res.status === 400 || res.status === 401; // invalid_grant: revoked, for good
    throw err;
  }
  const t = await res.json();
  if (!t.access_token) throw new Error("coros-token-empty");
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token || form.refresh_token || "",
    expires_at: Math.floor(Date.now() / 1000) + (Number(t.expires_in) || 3600),
  };
}

/** The one-time code COROS sent back, spent for a token pair. */
export const exchangeCode = (issuer, clientId, redirectUri, code, verifier) =>
  tokenRequest(issuer, {
    grant_type: "authorization_code",
    client_id: clientId,
    code: code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

/** A live access token for this row, refreshing it first if it is due to expire. */
export async function freshToken(link) {
  if (link.expires_at > Math.floor(Date.now() / 1000) + 60) return link;
  return tokenRequest(link.issuer, {
    grant_type: "refresh_token",
    client_id: link.client_id,
    refresh_token: link.refresh_token,
  });
}

/* The last message in a server-sent event stream: events are separated by a
   blank line, and one event's data may run over several data: lines. */
function lastEvent(text) {
  const events = text
    .split(/\r?\n\r?\n/)
    .map((ev) =>
      ev
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n")
    )
    .filter(Boolean);
  return events[events.length - 1] || "{}";
}

/* One JSON-RPC request to the stateless /mcp endpoint. The answer comes back
   as plain JSON or as an event stream; either way it is the last message. */
async function rpc(issuer, token, id, method, params) {
  const res = await fetch(issuer + "/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params }),
  });
  if (!res.ok) throw new Error("coros-mcp-" + method + "-" + res.status);
  const text = await res.text();
  const body = (res.headers.get("content-type") || "").includes("text/event-stream") ? lastEvent(text) : text;
  const msg = JSON.parse(body);
  if (msg.error) throw new Error("coros-mcp-" + method + "-" + (msg.error.code || "error"));
  return msg.result;
}

/** This week's runs, Sunday to today, in the shape weekSummary reads. */
export async function runsSince(issuer, token, sunday, today) {
  // COROS's own helper opens every call this way. The endpoint is stateless:
  // no session id to carry, and no "initialized" notification to send.
  await rpc(issuer, token, 1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: CLIENT_NAME, version: "1" },
  });
  const result = await rpc(issuer, token, 2, "tools/call", {
    name: "querySportRecords",
    arguments: {
      startDate: sunday.replace(/-/g, ""), // COROS wants YYYYMMDD
      endDate: today.replace(/-/g, ""),
      sportTypeCodes: RUN_TYPES,
      limit: 100,
      timezone: "Asia/Riyadh",
    },
  });
  if (result && result.isError) throw new Error("coros-tool-error");
  return parseRuns(result);
}

/* The runs in a querySportRecords answer.

   COROS writes this tool's answer for a language model to read, not for a
   program: today it is numbered blocks of text ("1. Run — 2026-09-10 …
   LabelId: … SportType: 100 … Distance: 5.02 km … startTimestamp=…"), and it
   may yet become JSON. Both are read; anything that is neither is no runs
   rather than an error. tools/coros-test.js holds a sample of each. */
export function parseRuns(result) {
  const found = new Map();
  const add = (r) => {
    if (r.labelId != null && !found.has(String(r.labelId))) found.set(String(r.labelId), r);
  };
  walk(result && result.structuredContent, add);
  for (const c of (result && result.content) || []) {
    if (!c || typeof c.text !== "string") continue;
    let parsed = null;
    try {
      parsed = JSON.parse(c.text);
    } catch (e) {}
    if (parsed && typeof parsed === "object") walk(parsed, add);
    else textRecords(typeof parsed === "string" ? parsed : c.text).forEach(add);
  }

  const runs = [];
  for (const r of found.values()) {
    if (!RUN_TYPES.includes(Number(r.sportType))) continue;
    const when = startLocal(r);
    const km = Number(r.distanceKm);
    if (!when || !(km > 0)) continue;
    runs.push({ type: "Run", start_date_local: when, distance: km * 1000 });
  }
  return runs;
}

function walk(v, add) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, add));
  else if (v && typeof v === "object") {
    if (v.labelId != null && v.sportType != null) add(v);
    else Object.values(v).forEach((x) => walk(x, add));
  }
}

function textRecords(text) {
  return text
    .split(/\n\s*(?=\d+\.\s+)/)
    .map((block) => {
      const one = (re) => {
        const m = block.match(re);
        return m ? m[1] : null;
      };
      const dist = block.match(/Distance:\s*([0-9.]+)\s*(km|m)\b/);
      return {
        labelId: one(/LabelId:\s*(\d+)/),
        sportType: one(/SportType:\s*(\d+)/),
        startTimestamp: one(/startTimestamp=(\d+)/),
        date: one(/\s—\s(\d{4}-\d{2}-\d{2})/),
        distanceKm: dist ? Number(dist[1]) / (dist[2] === "m" ? 1000 : 1) : null,
      };
    })
    .filter((r) => r.labelId != null && r.sportType != null);
}

/* Riyadh wall-clock time written with a "Z", the shape of Strava's
   start_date_local: the club runs on Riyadh time, so a run at 1am on Monday
   belongs to Monday even though it is still Sunday in UTC. */
function startLocal(r) {
  let s = Number(r.startTimestamp);
  if (s > 1e12) s = s / 1000; // milliseconds, should it ever come that way
  if (s > 0) return new Date((s + RIYADH_S) * 1000).toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date + "T12:00:00Z" : null;
}
