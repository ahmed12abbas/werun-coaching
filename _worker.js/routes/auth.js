/* Accounts: join, log in, who am I, and the few things an athlete can change. */

import { json, readBody } from "../lib/http.js";
import { tooOften, ipOf } from "../lib/limit.js";
import { getSetting } from "../lib/settings.js";
import { emailOn } from "../lib/mail.js";
import { hasColumn } from "../lib/columns.js";
import { storeOn } from "../lib/stripe.js";
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

/* Empty is a real answer: someone who would rather not say still runs with
   the club, so anything unrecognised becomes "" rather than an error. */
const GENDERS = ["woman", "man", "other"];
const cleanGender = (s) => (GENDERS.includes(String(s || "")) ? String(s) : "");

/* The twelve drawings in js/avatars.js, by id. The list lives in both places
   on purpose: the page needs it to draw the picker and the Worker needs it to
   refuse everything else, and there is no bundler here to share one copy.
   Anything unrecognised becomes "" — the member's initial — rather than an
   error, so an old app that sends a retired id still saves its other fields. */
const AVATARS = [
  "m1", "m2", "m3", "f1", "f2", "f3",
  "cheetah", "horse", "hare", "formula", "rally", "supercar",
];
const cleanAvatar = (s) => (AVATARS.includes(String(s || "")) ? String(s) : "");

/* A birth year, or nothing. The bounds are the ones a person could
   plausibly have: a typo of 1090 or 2190 is not a runner. */
function cleanYear(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Math.round(Number(v));
  const now = new Date().getUTCFullYear();
  if (!Number.isFinite(n) || n < now - 100 || n > now - 5) return undefined; // undefined = refuse
  return n;
}

/**
 * The club's own settings, as a member is allowed to see them: the name, the
 * announcement in both languages, and whether the site is being worked on.
 * Never the whole table — the points rules and the check-in window are the
 * coach's business.
 *
 * It rides along with every answer that says who someone is, so the app
 * learns all of it in requests it was making anyway.
 */
async function clubFor(env) {
  return {
    // Whether the mail flows work at all, so the app only offers "confirm
    // your email" and "forgotten your password" when they would do something.
    // EMAIL_ECHO counts because under it the flows really do work — it is
    // never set on the live site, so production reads this as the key alone.
    email: emailOn(env) || env.EMAIL_ECHO === "1",
    // The Store tab appears only when there is something behind it.
    store: storeOn(env) && (await getSetting(env, "store_open")),
    name: await getSetting(env, "club_name"),
    announcement_en: await getSetting(env, "announcement_en"),
    announcement_ar: await getSetting(env, "announcement_ar"),
    maintenance: !!(await getSetting(env, "maintenance")),
  };
}

/* ---------- POST /api/auth/signup ---------------------------------------- */

/*
 * Open to anyone, which is the club's choice — so it is the most rate-limited
 * route on the site, and the coach has a switch to close it. Three accounts
 * an hour from one address is a family on one router; more is a script.
 */
export async function signup(request, env) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  // Without KV there is nowhere to keep the count, and an open signup route
  // with no limit at all is worse than one that is briefly shut.
  if (!env.STATS) return json({ error: "no-store" }, 503);
  if (!(await getSetting(env, "signups_open"))) return json({ error: "signups-closed" }, 403);

  const body = await readBody(request);
  const email = cleanEmail(body.email);
  const name = cleanName(body.name);
  const password = String(body.password || "");
  if (!emailLooksRight(email)) return json({ error: "bad-email" }, 400);
  if (!name) return json({ error: "bad-name" }, 400);
  if (password.length < MIN_PASSWORD || password.length > MAX.password) return json({ error: "bad-password" }, 400);
  const birthYear = cleanYear(body.birth_year);
  if (birthYear === undefined) return json({ error: "bad-year" }, 400);
  // Counted once the form is right, so two typos and a short password do not
  // cost an hour, and it is the expensive half -- hashing, then the insert --
  // that the cap actually protects.
  if (await tooOften(env.STATS, "su", ipOf(request), 3, 3600)) return json({ error: "too-often" }, 429);

  const { salt, hash } = await hashPassword(password);
  const id = uid();
  const now = nowISO();
  try {
    // Until 0006 is applied, these columns are not there — and joining the
    // club matters far more than recording an age group, so the row goes in
    // without them rather than the whole signup failing.
    if (await hasColumn(env, "users", "birth_year")) {
      await env.DB.prepare(
        "INSERT INTO users (id, email, name, pass_salt, pass_hash, role, lang, status, created_at, last_seen_at, gender, birth_year)" +
          " VALUES (?, ?, ?, ?, ?, 'athlete', ?, 'active', ?, ?, ?, ?)"
      )
        .bind(id, email, name, salt, hash, cleanLang(body.lang), now, now, cleanGender(body.gender), birthYear)
        .run();
    } else {
      await env.DB.prepare(
        "INSERT INTO users (id, email, name, pass_salt, pass_hash, role, lang, status, created_at, last_seen_at)" +
          " VALUES (?, ?, ?, ?, ?, 'athlete', ?, 'active', ?, ?)"
      )
        .bind(id, email, name, salt, hash, cleanLang(body.lang), now, now)
        .run();
    }
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return json({ error: "email-taken" }, 409);
    throw e;
  }

  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  const token = await createSession(env, id, request);
  return jsonWithCookie({ user: publicUser(user), club: await clubFor(env) }, 200, token);
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
  // Same rule as signup: no counter, no attempts.
  if (!env.STATS) return json({ error: "no-store" }, 503);
  const body = await readBody(request);
  const email = cleanEmail(body.email);
  const password = String(body.password || "");

  const byIp = await tooOften(env.STATS, "li", ipOf(request), 10, 60);
  // The slower count is per address *and* email, not per email alone: keyed
  // on the email by itself, anyone who knows a member address could lock
  // that member out for an hour from somewhere else.
  const byWho = email && (await tooOften(env.STATS, "le", ipOf(request) + ":" + email, 20, 3600));
  if (byIp || byWho) return json({ error: "too-often" }, 429);

  const user = email ? await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first() : null;
  const ok = user ? await verifyPassword(password, user.pass_salt, user.pass_hash) : await burnTime(password);
  if (!user || !ok) return json({ error: "bad-login" }, 401);
  if (user.status === "blocked") return json({ error: "blocked" }, 403);

  const token = await createSession(env, user.id, request);
  return jsonWithCookie({ user: publicUser(user), club: await clubFor(env) }, 200, token);
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
  return json({ user: publicUser(user), club: await clubFor(env) });
}

/* ---------- POST /api/auth/profile --------------------------------------- */

export const profile = withUser(async (request, env, user) => {
  const body = await readBody(request);
  const name = body.name != null ? cleanName(body.name) : user.name;
  const lang = body.lang != null ? cleanLang(body.lang) : user.lang;
  if (!name) return json({ error: "bad-name" }, 400);

  const gender = body.gender != null ? cleanGender(body.gender) : user.gender || "";
  const birthYear = body.birth_year !== undefined ? cleanYear(body.birth_year) : user.birth_year;
  if (birthYear === undefined) return json({ error: "bad-year" }, 400);
  const avatar = body.avatar !== undefined ? cleanAvatar(body.avatar) : user.avatar || "";

  // Only the columns this database actually has: 0006 and 0007 are applied by
  // hand here, so between a deploy and its migration the name and the language
  // must still save rather than the whole form failing on a column nobody made
  // yet. Both branches come out once the migrations are in.
  const sets = ["name = ?", "lang = ?"];
  const vals = [name, lang];
  // What went in is what comes back: a field the database could not hold is
  // not echoed as though it had been kept, or the app shows an avatar that
  // the next reload takes away again.
  const saved = { name: name, lang: lang };
  if (await hasColumn(env, "users", "birth_year")) {
    sets.push("gender = ?", "birth_year = ?");
    vals.push(gender, birthYear);
    saved.gender = gender;
    saved.birth_year = birthYear;
  }
  if (await hasColumn(env, "users", "avatar")) {
    sets.push("avatar = ?");
    vals.push(avatar);
    saved.avatar = avatar;
  }
  await env.DB.prepare("UPDATE users SET " + sets.join(", ") + " WHERE id = ?")
    .bind(...vals, user.id)
    .run();

  return json({ user: publicUser(Object.assign({}, user, saved)) });
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
  // Asking for the current one is what stops a borrowed phone quietly
  // becoming someone else account, so it cannot be guessed at either.
  if (env.STATS && (await tooOften(env.STATS, "pw", user.id, 5, 3600))) return json({ error: "too-often" }, 429);
  if (!(await verifyPassword(current, user.pass_salt, user.pass_hash))) return json({ error: "wrong-password" }, 401);
  const { salt, hash } = await hashPassword(next);
  await env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?").bind(salt, hash, user.id).run();
  await dropOtherSessions(env, request, user.id);
  return json({ ok: true });
});
