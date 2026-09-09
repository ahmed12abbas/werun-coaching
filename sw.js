"use strict";

/* =========================================================================
   WE RUN Coaching — the offline shell.

   An athlete standing in Wadi Hanifa at 04:55 has one bar of signal and a
   session about to start. This is what makes the app open anyway: the page,
   its scripts and the last answers the club gave, kept on the phone.

   Three rules, by what is being asked for:

   - **Pages** (a navigation) go to the network first and fall back to the
     copy on the phone. A deploy has to be able to reach people; an outage
     must not.
   - **Scripts, styles and images** are stamped with `?v=<hash>` by
     tools/version-assets.js, so a cached copy can never be the wrong one —
     a changed file is a changed URL. Serve it off the phone and refresh it
     behind, which is also what makes the *next* visit instant.
   - **The API** is the club's own answers. A handful of reads are worth
     keeping (the week, who you are, one session, the feed, your points);
     everything else — check-in, signing up, anything that writes — is the
     network's business and is not touched here. Those reads go to the
     network first too, so what is on screen is current whenever there is
     signal at all, and fall back to the last answer when there is not.

   Nothing is precached: the first visit fills the shelf. That keeps this
   file from having to know the stamped filenames, which change on every
   deploy — the cost is that an app installed and never opened online has
   nothing to fall back on, which is not a state anybody is in.

   The data cache holds one athlete's own answers, so js/auth.js drops it on
   the way out — see logout() there.
   ========================================================================= */

const SHELL = "werun-shell-v1";
const DATA = "werun-data-v1";

/* The reads worth keeping. Anything not on this list is never cached: a
   check-in, a signup or a code must fail honestly rather than answer out of
   yesterday's cache. */
const KEEP = /^\/api\/(week|feed|session|auth\/me|points\/(me|board))$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    if (KEEP.test(url.pathname)) event.respondWith(networkFirst(req, DATA));
    return;
  }
  if (req.mode === "navigate") return event.respondWith(networkFirst(req, SHELL));
  event.respondWith(staleWhileRevalidate(req, SHELL));
});

/** Ask the network; keep what it says; answer from the phone if it cannot. */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    // Only a real answer is worth keeping: a 401 or a 500 cached here would
    // be handed back for as long as the phone is offline.
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const kept = await cache.match(req);
    if (kept) return kept;
    throw e;
  }
}

/** Answer off the phone at once, and put a fresh copy behind it for next time. */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const kept = await cache.match(req);
  const fresh = fetch(req)
    .then((r) => {
      if (r && r.ok) cache.put(req, r.clone());
      return r;
    })
    .catch(() => kept); // offline: whatever is on the shelf, or nothing
  return kept || fresh;
}
