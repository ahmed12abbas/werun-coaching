/* Who is asking.

   An athlete logs in once per device and gets a cookie: 32 random bytes,
   HttpOnly so no script on the page can read it, Secure, SameSite=Lax so a
   link from the group chat still opens logged in. The database keeps only
   the SHA-256 of that token, so reading the table out does not hand anyone
   a live login. Passwords are PBKDF2-SHA256 with a per-user salt, via
   WebCrypto — nothing here is home-made. */

import { json } from "./http.js";
import { hex, safeEqual, sha256 } from "./crypto.js";

const COOKIE = "werun_s";
const SESSION_DAYS = 90;
const PBKDF2_ITERATIONS = 100000;
const enc = new TextEncoder();

export const nowISO = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

const fromHex = (h) => new Uint8Array(h.match(/../g).map((b) => parseInt(b, 16)));

/* ---------- passwords ---------------------------------------------------- */

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return { salt: hex(salt), hash: hex(bits) };
}

export async function verifyPassword(password, saltHex, hashHex) {
  const got = await hashPassword(password, saltHex);
  return safeEqual(got.hash, hashHex);
}

/* A login for an email nobody has costs the same as one for an email
   somebody has, so the clock does not say which. */
const DUMMY = { salt: "00000000000000000000000000000000", hash: "0".repeat(64) };
export const burnTime = (password) => verifyPassword(password, DUMMY.salt, DUMMY.hash);

/* ---------- the cookie --------------------------------------------------- */

function readCookie(request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === COOKIE && v) return v;
  }
  return null;
}

export function cookieHeader(token, maxAge) {
  return (
    COOKIE + "=" + (token || "") +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + (maxAge == null ? SESSION_DAYS * 86400 : maxAge)
  );
}

/** A JSON response that also sets (or, with token "", clears) the cookie. */
export function jsonWithCookie(body, status, token) {
  const res = json(body, status);
  res.headers.append("set-cookie", cookieHeader(token, token ? undefined : 0));
  return res;
}

/* ---------- sessions ----------------------------------------------------- */

export async function createSession(env, userId, request) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = hex(await sha256(token));
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400 * 1000);
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(tokenHash, userId, now.toISOString(), expires.toISOString(), (request.headers.get("user-agent") || "").slice(0, 200))
    .run();
  return token;
}

export async function dropSession(env, request) {
  const token = readCookie(request);
  if (!token) return;
  const tokenHash = hex(await sha256(token));
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function dropOtherSessions(env, request, userId) {
  const token = readCookie(request);
  const keep = token ? hex(await sha256(token)) : "";
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").bind(userId, keep).run();
}

/** The user behind the cookie, or null. Touches last_seen_at about hourly. */
export async function currentUser(request, env) {
  if (!env.DB) return null;
  const token = readCookie(request);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = hex(await sha256(token));
  const now = nowISO();
  const row = await env.DB.prepare(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  )
    .bind(tokenHash, now)
    .first();
  if (!row) return null;
  if (!row.last_seen_at || Date.parse(now) - Date.parse(row.last_seen_at) > 3600 * 1000) {
    await env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(now, row.id).run();
  }
  return row;
}

/** What the page may know about an account. Never the hash, never the salt. */
export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  lang: u.lang,
  created_at: u.created_at,
});

/* ---------- guards ------------------------------------------------------- */

/** Wrap a handler so it only runs for a logged-in, unblocked athlete. */
export const withUser = (fn) => async (request, env) => {
  if (!env.DB) return json({ error: "no-db" }, 503);
  const user = await currentUser(request, env);
  if (!user) return json({ error: "not-logged-in" }, 401);
  if (user.status === "blocked") return json({ error: "blocked" }, 403);
  return fn(request, env, user);
};

/** The same, and they must be a coach. */
export const withCoach = (fn) =>
  withUser((request, env, user) => {
    if (user.role !== "coach") return json({ error: "not-coach" }, 403);
    return fn(request, env, user);
  });
