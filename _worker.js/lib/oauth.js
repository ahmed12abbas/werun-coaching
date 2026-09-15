/* The one shape every watch/fitness OAuth token endpoint shares: POST a
   body, get JSON back, or throw a named error. Strava, COROS and
   Intervals.icu still each write their own token shaping on top — the
   fields in the response, and what counts as expired, genuinely differ. */

async function post(url, headers, body, errPrefix) {
  const res = await fetch(url, { method: "POST", headers: headers, body: body });
  if (!res.ok) {
    const err = new Error(errPrefix + "-" + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const postJson = (url, body, errPrefix) =>
  post(url, { "content-type": "application/json" }, JSON.stringify(body), errPrefix);

export const postForm = (url, body, errPrefix) =>
  post(url, { "content-type": "application/x-www-form-urlencoded" }, new URLSearchParams(body).toString(), errPrefix);
