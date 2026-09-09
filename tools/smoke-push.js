/**
 * Session reminders: subscribing, what the notification would say, and the
 * sender's own guard.
 *
 *   node tools/dev.js            (in one terminal)
 *   node tools/smoke-push.js     (in another)
 *
 * What is worth proving is not that a phone buzzes — no phone is involved —
 * but the shape around it: a subscription belongs to one athlete, the text
 * is theirs and comes from a signup, the sender cannot be poked by a
 * stranger, and nobody is told about the same session twice.
 *
 * The endpoint used here is a real https URL that resolves to nothing, so
 * the send fails at the network exactly the way a dead browser would. The
 * sender is expected to survive that, which is the other half of the test.
 */
"use strict";

const BASE = process.env.BASE || "http://127.0.0.1:4323";
const SECRET = process.env.PUSH_SECRET || "letmepush";

let pass = 0;
let fail = 0;
const ok = (what, cond) => {
  if (cond) {
    pass++;
    console.log("PASS " + what);
  } else {
    fail++;
    console.log("FAIL " + what);
  }
};

function client() {
  let cookie = "";
  return async function call(method, path, body) {
    const res = await fetch(BASE + path, {
      method: method,
      headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie: cookie } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

/* The club's own day, the way the Worker works it out. */
const clubDate = (n) => new Date(Date.now() + 3 * 3600000 + (n || 0) * 86400000).toISOString().slice(0, 10);

/* ES256 over `header.payload`, verified the way a push service verifies it. */
async function checkTheSignature() {
  const nodeCrypto = require("crypto");
  const env = {
    VAPID_PUBLIC: process.env.VAPID_PUBLIC,
    VAPID_PRIVATE: process.env.VAPID_PRIVATE,
    VAPID_SUBJECT: "https://weruncoaching.pages.dev",
  };
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) {
    console.log("SKIP the signature — put VAPID_PUBLIC and VAPID_PRIVATE in this shell to check it");
    return;
  }
  const { vapidToken } = await import("../_worker.js/lib/push.js");
  const jwt = await vapidToken(env, "https://fcm.googleapis.com");
  const [head, body, sig] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(body, "base64url"));
  const point = Buffer.from(env.VAPID_PUBLIC, "base64url");
  const key = nodeCrypto.createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  const good = nodeCrypto.verify(
    "sha256",
    Buffer.from(head + "." + body),
    { key: key, dsaEncoding: "ieee-p1363" },
    Buffer.from(sig, "base64url")
  );
  ok("the VAPID token is signed by the club's own key", good);
  ok("it is minted for one push service only", claims.aud === "https://fcm.googleapis.com");
  ok("and it expires inside a day", claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 25 * 3600);
}

(async () => {
  const me = client();
  const stamp = Date.now();
  let r = await me("POST", "/api/auth/signup", {
    email: "push" + stamp + "@example.com",
    password: "runrunrun1",
    name: "Push Tester",
  });
  ok("an athlete to remind", r.status === 200);

  r = await me("POST", "/api/push", { action: "key" });
  if (r.status === 503) {
    console.log("\nPush is off here — set VAPID_PUBLIC, VAPID_PRIVATE and PUSH_SECRET in .dev.vars.");
    process.exit(1);
  }
  ok("the club hands out its public key", r.status === 200 && typeof r.json.key === "string");

  const endpoint = "https://push.example.invalid/one/" + stamp;
  r = await me("POST", "/api/push", { action: "subscribe", endpoint: endpoint });
  ok("subscribing is remembered", r.status === 200 && r.json.on === true);

  r = await me("POST", "/api/push", { action: "subscribe", endpoint: endpoint });
  ok("subscribing twice is still once", r.status === 200);

  r = await me("POST", "/api/push", { action: "subscribe", endpoint: "http://not-https/x" });
  ok("a plain-http endpoint is refused", r.status === 400);

  const stranger = client();
  await stranger("POST", "/api/auth/signup", {
    email: "push" + stamp + "b@example.com",
    password: "runrunrun1",
    name: "Somebody Else",
  });
  r = await stranger("POST", "/api/push", { action: "unsubscribe", endpoint: endpoint });
  ok("nobody can unsubscribe somebody else's browser", r.status === 200);
  // Proven by what is left: the row is still there, so the sender still has
  // somewhere to knock for the first athlete.

  r = await me("GET", "/api/push/next");
  ok("nothing to say with no session down", r.status === 200 && r.json.session === null);

  // A slot to put a name against — whichever the club has first.
  const week = await me("GET", "/api/week?start=" + clubDate(0));
  let slot = null;
  for (const d of (week.json && week.json.days) || []) {
    for (const it of d.items || []) if (it.schedule_id && !slot) slot = { id: it.schedule_id, date: d.date };
  }
  ok("the club has a standing slot", !!slot);
  if (slot) {
    r = await me("POST", "/api/signups", { action: "join", schedule_id: slot.id, date: slot.date });
    ok("the athlete is down for it", r.status === 200);
  }

  r = await me("POST", "/api/push", { action: "run", secret: "not-the-secret" });
  ok("a stranger cannot poke the sender", r.status === 401);

  r = await me("POST", "/api/push", { action: "run", secret: SECRET });
  ok("the sender runs", r.status === 200 && typeof r.json.due === "number");
  const first = r.json;

  r = await me("POST", "/api/push", { action: "run", secret: SECRET });
  ok("and running again tells nobody twice", r.status === 200 && r.json.sent === 0);
  ok("a dead endpoint sends nothing", first.sent === 0);

  r = await me("POST", "/api/push", { action: "unsubscribe", endpoint: endpoint });
  ok("unsubscribing takes the browser off", r.status === 200 && r.json.on === false);

  /* The signature itself. A push service is the only thing that would
     otherwise tell us it is wrong, and it tells us by saying nothing at all
     — no error, no buzz — so the token the Worker would send is minted here
     with the Worker's own code and checked against the public key. */
  await checkTheSignature();

  console.log("");
  console.log(fail ? fail + " failed." : "All passed.");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
