// The meeting-point check in _worker.js/lib/geo.js: reading a pin off a maps
// link, following a short one, and whether a position is inside the circle.
// node tools/geo-test.mjs
import assert from "node:assert/strict";
import { coordsIn, pinFor, metres, beyond, NEAR_M } from "../_worker.js/lib/geo.js";

// What maps.app.goo.gl/fwSWCrLb9cxV7JHB6 (Wadi Mahdia Road) redirects to.
const MAHDIA = "https://maps.google.com/?q=24.6697610,46.5784310&entry=gps&shh=CAE";
assert.deepEqual(coordsIn(MAHDIA), { lat: 24.669761, lng: 46.578431 });
assert.deepEqual(coordsIn("https://www.google.com/maps/place/x/@24.7348,46.7161,17z"), { lat: 24.7348, lng: 46.7161 });
assert.deepEqual(coordsIn("https://maps.google.com/?q=24.73%2C46.71"), { lat: 24.73, lng: 46.71 });
// Alfaisal University's link resolves to a name, not a point.
assert.equal(coordsIn("https://maps.google.com/?q=Princess+Haya+Auditorium&ftid=0x3e2f:0x34"), null);
assert.equal(coordsIn(""), null);

// A degree of latitude is ~111 km.
assert.ok(Math.abs(metres({ lat: 24, lng: 46 }, { lat: 25, lng: 46 }) - 111195) < 50);

const pin = { lat: 24.669761, lng: 46.578431 };
const north = (m) => ({ lat: pin.lat + m / 111195, lng: pin.lng });
assert.ok(beyond(pin, { ...north(0), acc: 10 }) <= 0, "on the pin");
assert.ok(beyond(pin, { ...north(NEAR_M - 20), acc: 10 }) <= 0, "just inside");
assert.ok(beyond(pin, { ...north(NEAR_M + 50), acc: 0 }) > 0, "just outside");
assert.ok(beyond(pin, { ...north(NEAR_M + 50), acc: 80 }) <= 0, "outside, but inside the phone's own error");
assert.ok(beyond(pin, { ...north(2000), acc: 5000 }) > 0, "a vague phone is not credited 5 km");

// A short link is followed once, then answered from KV.
const kv = new Map();
const env = { STATS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) } };
let fetched = 0;
globalThis.fetch = async () => {
  fetched++;
  return { headers: new Headers({ location: MAHDIA }) };
};
const short = "https://maps.app.goo.gl/fwSWCrLb9cxV7JHB6";
assert.deepEqual(await pinFor(env, short), pin);
assert.deepEqual(await pinFor(env, short), pin);
assert.equal(fetched, 1, "followed once");
// Anything that is not Google's shortener is never fetched.
assert.equal(await pinFor(env, "https://example.com/somewhere"), null);
assert.equal(fetched, 1);
assert.equal(await pinFor(env, ""), null);

console.log("geo: ok");
