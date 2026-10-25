/* lib/intervals.js against the token answer Intervals.icu actually sends —
   { access_token, scope, athlete: { id, name } }, no refresh token, no expiry
   (forum.intervals.icu/t/intervals-icu-oauth-support/2759). Reading it wrong
   unlinked every athlete on their first Home visit, so this pins it.

     node tools/intervals-test.mjs
*/
import assert from "node:assert/strict";
import { exchangeCode, freshToken, putEvents, activitiesSince, activityRoute } from "../_worker.js/lib/intervals.js";
import { weekSummary, latestRuns } from "../_worker.js/lib/week.js";

const env = { INTERVALS_CLIENT_ID: "961", INTERVALS_CLIENT_SECRET: "x" };
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts });
  if (String(url).endsWith("/oauth/token")) {
    return Response.json({ token_type: "Bearer", access_token: "tok", scope: "ACTIVITY:READ,CALENDAR:WRITE", athlete: { id: "i547603", name: "A" } });
  }
  if (String(url).endsWith("/map")) {
    return Response.json({ latlngs: Array.from({ length: 1000 }, (_, i) => (i === 3 ? null : [24.7 + i / 1e5, 46.6 + i / 1e5])) });
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

const wk = weekSummary([{ id: "i9", type: "Run", name: "Tempo", distance: 12000, moving_time: 3000, start_date_local: "2026-10-20T05:00:00" }], "2026-10-18");
assert.deepEqual(wk.runs, [{ id: "i9", day: 2, date: "2026-10-20", name: "Tempo", distance_m: 12000, moving_s: 3000, hr: null }], "each run rides along with its day");

calls.length = 0;
const pts = await activityRoute("tok", "i123", 400);
assert.match(calls[0].url, /\/api\/v1\/activity\/i123\/map$/);
assert.ok(pts.length <= 400 && pts.length > 300, "a long track is thinned to the cap");
assert.ok(pts.every((p) => p.length === 2 && Number.isFinite(p[0])), "a gap in the track is dropped, not drawn");

const latest = latestRuns([
  { id: "a", type: "Run", start_date_local: "2026-10-01T05:00:00" },
  { id: "b", type: "Ride", start_date_local: "2026-10-23T05:00:00" },
  { id: "c", type: "Run", start_date_local: "2026-10-22T05:00:00" },
  { id: "d", type: "Run", start_date_local: "2026-10-12T05:00:00" },
  { id: "e", type: "Run", start_date_local: "2026-10-20T05:00:00" },
], 3);
assert.deepEqual(latest.map((r) => r.id), ["c", "e", "d"], "the newest three runs, rides left out");

console.log("intervals: all passed");
