/**
 * The two secrets web push needs, printed once.
 *
 *   node tools/vapid-keys.js
 *
 * VAPID is one P-256 key pair. The public half is not a secret at all — the
 * browser is handed it to subscribe with — and the private half signs the
 * token that says a knock came from this club. Generate them once and keep
 * them: changing the pair invalidates every subscription the club has, and
 * every athlete would have to turn reminders on again.
 *
 * Nothing is written to disk. Paste the two commands it prints; secrets live
 * in Cloudflare, never in the repo.
 */
"use strict";

const { generateKeyPairSync } = require("crypto");

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const priv = privateKey.export({ format: "jwk" });
const pub = publicKey.export({ format: "jwk" });

const b64 = (s) => Buffer.from(s, "base64url");
// The applicationServerKey a browser subscribes with is the uncompressed
// point: 0x04, then x, then y. The JWK carries x and y separately.
const point = Buffer.concat([Buffer.from([4]), b64(pub.x), b64(pub.y)]);

const PUBLIC = point.toString("base64url");
const PRIVATE = priv.d;

console.log("VAPID_PUBLIC  " + PUBLIC);
console.log("VAPID_PRIVATE " + PRIVATE);
console.log("");
console.log("Set them on the site (each command asks for the value):");
console.log("  npx wrangler pages secret put VAPID_PUBLIC  --project-name weruncoaching");
console.log("  npx wrangler pages secret put VAPID_PRIVATE --project-name weruncoaching");
console.log("  npx wrangler pages secret put PUSH_SECRET   --project-name weruncoaching");
console.log("");
console.log("And the same PUSH_SECRET where the reminder job runs:");
console.log("  gh secret set PUSH_SECRET");
console.log("");
console.log("For local work, put all three in .dev.vars (never committed).");

// A key that cannot be rebuilt the way the Worker rebuilds it is no use, so
// it is checked here rather than at 04:00 on a Saturday.
const back = Buffer.from(PUBLIC, "base64url");
if (back.length !== 65 || back[0] !== 4) throw new Error("public key is not an uncompressed point");
if (Buffer.from(PRIVATE, "base64url").length !== 32) throw new Error("private scalar is not 32 bytes");
