/* Accounts: join, log in, who am I, and the few things an athlete can change. */

import { json, readBody } from "../lib/http.js";
import { tooOften, ipOf } from "../lib/limit.js";
import { getSetting } from "../lib/settings.js";
import {
  nowISO, uid, hashPassword, verifyPassword, burnTime,
  createSession, dropSession, dropOtherSessions, currentUser, publicUser,
  jsonWithCookie, withUser,
} from "../lib/auth.js";

const MAX = { email: 120, name: 40, password: 200 };
const MIN_PASSWORD = 8;

const cleanEmail = (s) => String(s || "").trim().toLowerCase().slice(0, MAX.email);
const emailLooksRight = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, MAX.name);
const cleanLang = (s) => (s === "ar" ? "ar" : "en");

/* ---------- POST /api/auth/signup ---------------------------------------- */

/*
 * Open to anyone, which is the club's choice — so it is the most rate-limited
 * route on the site, and the coach has a switch to close it. Three accounts
 * an hour from one address is a family on one router; more is a script.
 */
export async function signup(request, env) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  if (!(await getSetting(env, "signups_open"))) return json({ error: "signups-closed" }, 403);
  if (env.STATS && (await tooOften(env.STATS, "su", ipOf(request), 3, 3600))) {
    return json({ error: "too-often" }, 429);
  }

  const body = await readBody(request);
  const email = cleanEmail(body.email);
  const name = cleanName(body.name);
  const password = String(body.password || "");
  if (!emailLooksRight(email)) return json({ error: "bad-email" }, 400);
  if (!name) return json({ error: "bad-name" }, 400);
  if (password.length < MIN_PASSWORD || password.length > MAX.password) return json({ error: "bad-password" }, 400);

  const { salt, hash } = await hashPassword(password);
  const id = uid();
  const now = nowISO();
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, pass_salt, pass_hash, role, lang, status, created_at, last_seen_at)" +
        " VALUES (?, ?, ?, ?, ?, 'athlete', ?, 'active', ?, ?)"
    )
      .bind(id, email, name, salt, hash, cleanLang(body.lang), now, now)
      .run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return json({ error: "email-taken" }, 409);
    throw e;
  }

  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  const token = await createSession(env, id, request);
  return jsonWithCookie({ user: publicUser(user) }, 200, token);
}

/* ---------- POST /api/auth/login ----------------------------------------- */

/*
 * One answer for a wrong password and for an unknown email, taking the same
 * time either way, so the form cannot be used to find out who is a member.
 * Two limits: per address, so a script cannot hammer, and per email, so one
 * account cannot be worked at from many addresses.
 */
export async function login(request, env) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  const body = await readBody(request);
  const email = cleanEmail(body.email);
  const password = String(body.password || "");

  if (env.STATS) {
    const byIp = await tooOften(env.STATS, "li", ipOf(request), 10, 60);
    const byEmail = email && (await tooOften(env.STATS, "le", email, 20, 3600));
    if (byIp || byEmail) return json({ error: "too-often" }, 429);
  }

  const user = email ? await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first() : null;
  const ok = user ? await verifyPassword(password, user.pass_salt, user.pass_hash) : await burnTime(password);
  if (!user || !ok) return json({ error: "bad-login" }, 401);
  if (user.status === "blocked") return json({ error: "blocked" }, 403);

  const token = await createSession(env, user.id, request);
  return jsonWithCookie({ user: publicUser(user) }, 200, token);
}

/* ---------- POST /api/auth/logout, /api/auth/logout-all ------------------ */

export async function logout(request, env) {
  if (env.DB) await dropSession(env, request);
  return jsonWithCookie({ ok: true }, 200, "");
}

export const logoutAll = withUser(async (request, env, user) => {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  return jsonWithCookie({ ok: true }, 200, "");
});

/* ---------- GET /api/auth/me --------------------------------------------- */

/* 200 with user: null rather than a 401: "who am I" is a question every page
   load asks, and "nobody yet" is an ordinary answer, not an error. */
export async function me(request, env) {
  const user = await currentUser(request, env);
  if (!user || user.status === "blocked") return json({ user: null });
  return json({ user: publicUser(user) });
}

/* ---------- POST /api/auth/profile --------------------------------------- */

export const profile = withUser(async (request, env, user) => {
  const body = await readBody(request);
  const name = body.name != null ? cleanName(body.name) : user.name;
  const lang = body.lang != null ? cleanLang(body.lang) : user.lang;
  if (!name) return json({ error: "bad-name" }, 400);
  await env.DB.prepare("UPDATE users SET name = ?, lang = ? WHERE id = ?").bind(name, lang, user.id).run();
  return json({ user: publicUser(Object.assign({}, user, { name: name, lang: lang })) });
});

/* ---------- POST /api/auth/password -------------------------------------- */

/* The current password is asked for again, so a phone left unlocked cannot
   quietly become someone else's account. Other devices are logged out; this
   one stays. */
export const password = withUser(async (request, env, user) => {
  const body = await readBody(request);
  const current = String(body.current || "");
  const next = String(body.next || "");
  if (next.length < MIN_PASSWORD || next.length > MAX.password) return json({ error: "bad-password" }, 400);
  if (!(await verifyPassword(current, user.pass_salt, user.pass_hash))) return json({ error: "wrong-password" }, 401);
  const { salt, hash } = await hashPassword(next);
  await env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?").bind(salt, hash, user.id).run();
  await dropOtherSessions(env, request, user.id);
  return json({ ok: true });
});
