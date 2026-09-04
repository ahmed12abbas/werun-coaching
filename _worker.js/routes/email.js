/* Confirming an address, and getting back in without one.

   Two flows, one shape: mint a random token, keep only its hash, mail the
   link, and let it be spent once before it expires.

   Verification is deliberately not a gate. Signups are open, email may never
   be configured, and locking an athlete out of the week because a message
   went to spam would be the club's problem and not theirs. It marks the
   account and shows the coach who is confirmed; that is all.

   The password reset is the one that matters: without it, an athlete who
   forgets their password has no way back at all. */

import { json, readBody } from "../lib/http.js";
import { hex, sha256 } from "../lib/crypto.js";
import { tooOften, ipOf } from "../lib/limit.js";
import { getSetting } from "../lib/settings.js";
import { nowISO, hashPassword, withUser, publicUser, currentUser } from "../lib/auth.js";
import { emailOn, send, verifyMail, resetMail } from "../lib/mail.js";

const LIFETIME = { verify: 7 * 24 * 3600 * 1000, reset: 3600 * 1000 };
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

/**
 * A new token for this user and purpose. Any earlier one for the same purpose
 * is dropped first, so a second "send it again" makes the first link dead
 * rather than leaving two ways in.
 */
async function mintToken(env, userId, purpose) {
  await env.DB.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?").bind(userId, purpose).run();
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(hex(await sha256(token)), userId, purpose, new Date(now).toISOString(), new Date(now + LIFETIME[purpose]).toISOString())
    .run();
  return token;
}

/** The row behind a token, if it is real, unspent and in date. */
async function spend(env, token, purpose) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ""))) return null;
  const hash = hex(await sha256(String(token)));
  const row = await env.DB.prepare(
    "SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?"
  )
    .bind(hash, purpose, nowISO())
    .first();
  if (!row) return null;
  await env.DB.prepare("UPDATE email_tokens SET used_at = ? WHERE token_hash = ?").bind(nowISO(), hash).run();
  return row;
}

const linkTo = (request, route, token) => new URL(request.url).origin + "/app#/" + route + "/" + token;

/*
 * With no key set the link cannot be sent — but it has been minted, and a
 * test needs some way to follow it. EMAIL_ECHO returns it in the answer, and
 * exists for `node tools/dev.js` and nothing else: it is in .dev.vars, the
 * bindings workflow never sets it, and /api/health reports it loudly so that
 * a copy of it in production is visible rather than silent.
 */
const echoing = (env) => !emailOn(env) && env.EMAIL_ECHO === "1";

async function deliver(env, request, user, purpose) {
  const token = await mintToken(env, user.id, purpose);
  const url = linkTo(request, purpose, token);
  const club = await getSetting(env, "club_name");
  const letter = purpose === "verify" ? verifyMail(club, url) : resetMail(club, url);

  if (echoing(env)) return json({ ok: true, echo: url });
  const out = await send(env, user.email, letter.subject, letter.text, letter.html);
  if (!out.ok) return json({ error: out.error }, 503);
  return json({ ok: true });
}

/* ---------- POST /api/auth/verify/send ------------------------------------ */

export const verifySend = withUser(async (request, env, user) => {
  if (user.email_verified_at) return json({ ok: true, already: true });
  if (!emailOn(env) && !echoing(env)) return json({ error: "email-off" }, 503);
  if (env.STATS && (await tooOften(env.STATS, "vs", user.id, 3, 3600))) return json({ error: "too-often" }, 429);
  return deliver(env, request, user, "verify");
});

/* ---------- POST /api/auth/verify ----------------------------------------- */

/* No login needed: the link is opened from a mail app, which may well be a
   browser that has never seen this site. The token is the proof. */
export async function verify(request, env) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  const body = await readBody(request);
  const row = await spend(env, body.token, "verify");
  if (!row) return json({ error: "bad-token" }, 400);
  await env.DB.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").bind(nowISO(), row.user_id).run();

  // If this is the athlete's own browser, hand back who they now are so the
  // app can redraw without a second round trip.
  const user = await currentUser(request, env);
  return json({ ok: true, user: user ? publicUser(user) : null });
}

/* ---------- POST /api/auth/reset/request ---------------------------------- */

/*
 * Always 200, whatever the address was. A form that says "no such account"
 * is a form that tells anyone who asks whether a given person runs with this
 * club, and the club's membership is nobody else's business.
 *
 * The work is the same either way too: an unknown address still costs a
 * lookup, so the answer's timing says as little as its wording.
 */
export async function resetRequest(request, env) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  if (!emailOn(env) && !echoing(env)) return json({ error: "email-off" }, 503);

  const body = await readBody(request);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 120);
  if (env.STATS) {
    const byIp = await tooOften(env.STATS, "rq", ipOf(request), 5, 3600);
    const byWho = email && (await tooOften(env.STATS, "rw", ipOf(request) + ":" + email, 3, 3600));
    if (byIp || byWho) return json({ error: "too-often" }, 429);
  }

  const user = email ? await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first() : null;
  if (!user || user.status === "blocked") return json({ ok: true });

  const out = await deliver(env, request, user, "reset");
  // A provider failure is worth saying — the athlete is waiting for a message
  // that is not coming — but nothing above it reveals whether the account
  // exists, because that path is only reached once it does.
  if (out.status !== 200) return out;
  return echoing(env) ? out : json({ ok: true });
}

/* ---------- POST /api/auth/reset ------------------------------------------ */

/*
 * The new password, and every other device logged out with it: a reset is
 * what someone does when they think a password is known, and leaving old
 * sessions alive would defeat the point of asking.
 */
export async function reset(request, env) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  const body = await readBody(request);
  const next = String(body.password || "");
  if (next.length < MIN_PASSWORD || next.length > MAX_PASSWORD) return json({ error: "bad-password" }, 400);

  const row = await spend(env, body.token, "reset");
  if (!row) return json({ error: "bad-token" }, 400);

  const { salt, hash } = await hashPassword(next);
  await env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?")
    .bind(salt, hash, row.user_id)
    .run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id).run();
  return json({ ok: true });
}
