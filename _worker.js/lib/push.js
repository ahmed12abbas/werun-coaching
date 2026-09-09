/* Web push, the short way round.

   A notification here carries no payload: the push is an empty knock, and
   the service worker asks /api/push/next what to say. That is deliberate —
   an encrypted payload means ECDH against the browser's keys, HKDF and
   AES128GCM by hand in a Worker with no bundler, and the only thing it would
   buy is text this club is happy to fetch a moment later anyway. What is
   left is one signature: the VAPID token, which WebCrypto signs natively.

   Two secrets, both from `node tools/vapid-keys.js`:
     VAPID_PUBLIC   the 65-byte public point, base64url — also the
                    applicationServerKey the browser subscribes with, so it
                    is handed to the page as well
     VAPID_PRIVATE  the 32-byte scalar, base64url, and never leaves here

   Neither set means no push at all, which the routes answer plainly rather
   than pretending — the same way email does without RESEND_API_KEY. */

const enc = new TextEncoder();

const b64url = (bytes) => {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const unb64url = (s) => {
  const pad = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(pad + "===".slice((pad.length + 3) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export const pushReady = (env) => !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE);

/* The signing key, rebuilt from the two secrets. The public point carries x
   and y after its 0x04 tag; the private scalar is d. Not cached across
   requests: importKey is cheap next to the network call that follows it. */
async function signingKey(env) {
  const pub = unb64url(env.VAPID_PUBLIC);
  if (pub.length !== 65) throw new Error("bad-vapid-public");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: b64url(pub.slice(1, 33)),
      y: b64url(pub.slice(33, 65)),
      d: String(env.VAPID_PRIVATE),
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

/**
 * One VAPID token for one push service.
 *
 * `aud` is the service's own origin and nothing else — a token minted for
 * Google's endpoint is not accepted by Mozilla's, which is the point of it.
 * Twelve hours is well inside the 24 the spec allows and means a sender run
 * never trips over a clock a few minutes out.
 */
export async function vapidToken(env, audience) {
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(
    enc.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT || "https://weruncoaching.pages.dev",
      })
    )
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await signingKey(env),
    enc.encode(head + "." + body)
  );
  return head + "." + body + "." + b64url(sig);
}

/**
 * Knock on one endpoint. Answers the status, because the caller's job is to
 * drop the rows the push service says are gone: 404 and 410 are a browser
 * that has been wiped or has revoked us, and keeping them means sending into
 * the dark for ever.
 *
 * TTL is half an hour: a reminder for a session that started twenty minutes
 * ago is worse than no reminder, so a phone that is off stays uninterrupted.
 */
export async function pushTo(env, endpoint) {
  let audience;
  try {
    audience = new URL(endpoint).origin;
  } catch (e) {
    return 400;
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "1800",
      "content-length": "0",
      authorization: "vapid t=" + (await vapidToken(env, audience)) + ", k=" + env.VAPID_PUBLIC,
    },
  });
  return res.status;
}
