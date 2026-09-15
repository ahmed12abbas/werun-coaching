/* Is the coach holding up the code actually at the meeting point?

   Only asked at all when the admin has turned `checkin_location_required`
   on — see lib/settings.js. Off by default: a club that has never had a
   coach show the wrong code should see nothing change.

   The pin is the one the athletes are sent to — the map link on the slot, or
   on the day's change when one moved it — so a morning moved to the far gate
   is checked against the far gate. Most of the club's links are short Google
   ones that say nothing until followed; followed once, the answer is kept.

   A pin that carries no coordinates (Google sometimes resolves to a place
   name instead) is no check at all rather than a coach locked out of their
   own session. */

/* Generous on purpose: a park's meeting point is a gate, not a paving slab,
   and a phone's first fix at five in the morning can wander. What stops a
   code being shown from the sofa is the distance, not the last fifty metres. */
export const NEAR_M = 300;
/* The phone's own error bar, credited up to this much and no further — or a
   phone that says "somewhere within 5 km" would count as here. */
const ACC_MAX = 100;

const KEEP_S = 30 * 86400;
const SHORT = new Set(["maps.app.goo.gl", "goo.gl"]);
const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";
const PAIR = [
  new RegExp("[?&](?:q|query|ll|destination)=" + NUM + ",\\s*" + NUM),
  new RegExp("@" + NUM + "," + NUM),
];

/** { lat, lng } read straight off a maps URL, or null. */
export function coordsIn(url) {
  let s = String(url || "");
  try { s = decodeURIComponent(s); } catch (e) {}
  for (const re of PAIR) {
    const m = re.exec(s);
    if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

/** Where a map link points, following a short link once and keeping it. */
export async function pinFor(env, url) {
  if (!url) return null;
  const direct = coordsIn(url);
  if (direct) return direct;

  let host = "";
  try { host = new URL(url).hostname; } catch (e) { return null; }
  // Only Google's own shortener is followed: the link is typed by an admin,
  // but the Worker fetching whatever it is told to is not a habit to start.
  if (!SHORT.has(host)) return null;

  const key = "pin:" + url;
  const kept = env.STATS ? await env.STATS.get(key) : null;
  if (kept) return kept === "none" ? null : JSON.parse(kept);

  let to = "";
  try {
    const res = await fetch(url, { redirect: "manual" });
    to = res.headers.get("location") || "";
  } catch (e) {
    console.error("pin: could not follow " + url + " (" + (e && e.message) + ")");
    return null; // not kept: next time may reach it
  }
  if (!to) return null;
  const pin = coordsIn(to);
  if (env.STATS) await env.STATS.put(key, pin ? JSON.stringify(pin) : "none", { expirationTtl: KEEP_S });
  return pin;
}

/** Metres between two points on the Earth, near enough for a park. */
export function metres(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** How far outside the circle a reported position is; 0 or less is inside. */
export function beyond(pin, at) {
  const acc = Math.min(Math.max(Number(at.acc) || 0, 0), ACC_MAX);
  return metres(pin, at) - acc - NEAR_M;
}
