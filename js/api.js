"use strict";

/* =========================================================================
   WE RUN Coaching — talking to /api.

   One place that knows the shape of an answer: JSON in, JSON out, the
   session cookie riding along, and an error the page can put into words —
   every failure the Worker sends has a short code ("bad-login",
   "too-often"), and the string table carries one sentence per code under
   "e_<code>", falling back to "e_generic" for anything it has not met.
   ========================================================================= */

const API = {
  async call(method, path, body) {
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
  get: (path) => API.call("GET", path),
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
