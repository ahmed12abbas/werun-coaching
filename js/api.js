"use strict";

/* =========================================================================
   WE RUN Coaching — talking to /api.

   One place that knows the shape of an answer: JSON in, JSON out, the
   session cookie riding along, and an error the page can put into words —
   every failure the Worker sends has a short code ("bad-login",
   "too-often"), and the string table carries one sentence per code under
   "e_<code>", falling back to "e_generic" for anything it has not met.
   ========================================================================= */

/* Reads a tab draws from, kept 30s so swiping back to a tab is instant rather
   than another round trip. Any write clears them all: after a check-in or a
   signup nothing may be drawn from before it. Not the order page, which is
   polled until Stripe's webhook lands. */
const MEMO = /^\/api\/(week|feed|session|points|auth\/me)/;
const MEMO_MS = 30000;
const recent = new Map();

const API = {
  async call(method, path, body) {
    // Strava's "home" is a read sent as a POST, on every Home visit.
    const read = method === "GET" || (path === "/api/strava" && body && body.action === "home");
    if (!read) recent.clear();
    const opts = { method: method, credentials: "same-origin", headers: { accept: "application/json" } };
    if (body !== undefined) {
      opts.headers["content-type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      throw apiError("offline", 0);
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    if (!res.ok) throw apiError((data && data.error) || "http-" + res.status, res.status);
    return data;
  },
  get(path) {
    if (!MEMO.test(path)) return API.call("GET", path);
    const hit = recent.get(path);
    if (hit && Date.now() - hit.at < MEMO_MS) return hit.p;
    const p = API.call("GET", path);
    recent.set(path, { at: Date.now(), p: p });
    p.catch(() => recent.delete(path));
    return p;
  },
  post: (path, body) => API.call("POST", path, body || {}),
};

function apiError(code, status) {
  const e = new Error(code);
  e.code = code;
  e.status = status;
  return e;
}

/** The sentence for an error, in the athlete's language. */
function errorText(e) {
  const key = "e_" + ((e && e.code) || "generic");
  const s = t(key);
  return s === key ? t("e_generic") : s;
}
