/* lib/intervals.js against the token answer Intervals.icu actually sends —
   { access_token, scope, athlete: { id, name } }, no refresh token, no expiry
   (forum.intervals.icu/t/intervals-icu-oauth-support/2759). Reading it wrong
   unlinked every athlete on their first Home visit, so this pins it.

     node tools/intervals-test.mjs
*/
import assert from "node:assert/strict";
import { exchangeCode, freshToken, putEvents, activitiesSince } from "../_worker.js/lib/intervals.js";

const env = { INTERVALS_CLIENT_ID: "961", INTERVALS_CLIENT_SECRET: "x" };
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts });
  if (String(url).endsWith("/oauth/token")) {
    return Response.json({ token_type: "Bearer", access_token: "tok", scope: "ACTIVITY:READ,CALENDAR:WRITE", athlete: { id: "i547603", name: "A" } });
  }
  return Response.json([]);
};

const t = await exchangeCode(env, "code", "https://x/cb");
assert.equal(t.athlete_id, "i547603", "athlete id comes from athlete.id");
assert.ok(t.expires_at > Date.now() / 1000 + 365 * 86400, "a token with no expires_in does not expire");

// A row saved before this fix: an hour's made-up expiry, long past, and no refresh token.
const old = { access_token: "tok", refresh_token: "", expires_at: 1, athlete_id: "" };
assert.equal(await freshToken(env, old), old, "no refresh token means no refresh attempt");

calls.length = 0;
await activitiesSince("", "tok", "2026-10-18");
assert.match(calls[0].url, /\/athlete\/0\/activities\?/, "an empty athlete id falls back to 0, the token's own");

calls.length = 0;
await putEvents("i547603", "tok", []);
assert.match(calls[0].url, /\/athlete\/i547603\/events\/bulk\?upsert=true&upsertOnUid=false&updatePlanApplied=false$/);

console.log("intervals: all passed");
