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

const MAX = { email: 120, name: 40, password: 200, bio: 160, instagram: 30 };
const MIN_PASSWORD = 8;

const cleanEmail = (s) => String(s || "").trim().toLowerCase().slice(0, MAX.email);
const emailLooksRight = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, MAX.name);
const cleanLang = (s) => (s === "ar" ? "ar" : "en");
/* One line, on one line: newlines out, runs of space squeezed, then cut. A
   bio that arrives as a paragraph is still a bio — it is just a shorter one. */
const cleanBio = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, MAX.bio);

/* An Instagram handle, however it was written down: people paste the whole
   address, and people type the @. What is kept is the handle itself, so the
   link is built where it is drawn and nothing else can ride in on this field.
   Whatever is left that is not a handle becomes "". */
const cleanHandle = (s) =>
  String(s || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@+/, "")
    .split(/[/?#]/)[0]
    .replace(/[^A-Za-z0-9._]/g, "")
    .slice(0, MAX.instagram);

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

/* Sessions a week to aim for. The club runs ten, so anything above that is
   a typo rather than an ambition, and nought is not a goal — an athlete who
   wants no target simply stops looking at the bar. */
function cleanGoal(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 10) return undefined; // undefined = refuse
  return n;
}

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
async function signupRefusal(env) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  // Without KV there is nowhere to keep the count, and an open signup route
  // with no limit at all is worse than one that is briefly shut.
  if (!env.STATS) return json({ error: "no-store" }, 503);
  if (!(await getSetting(env, "signups_open"))) return json({ error: "signups-closed" }, 403);
  return null;
}

/* The join form as it came in, or why it cannot make an account. */
function readSignup(body) {
  const form = {
    email: cleanEmail(body.email),
    name: cleanName(body.name),
    password: String(body.password || ""),
    birthYear: cleanYear(body.birth_year),
  };
  if (!emailLooksRight(form.email)) return { error: "bad-email" };
  if (!form.name) return { error: "bad-name" };
  if (form.password.length < MIN_PASSWORD || form.password.length > MAX.password) return { error: "bad-password" };
  if (form.birthYear === undefined) return { error: "bad-year" };
  return form;
}

/* Until 0006 is applied, gender and birth year are not there — and joining
   the club matters far more than recording an age group, so the row goes in
   without them rather than the whole signup failing. */
async function insertUser(env, u) {
  const now = nowISO();
  if (await hasColumn(env, "users", "birth_year")) {
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, pass_salt, pass_hash, role, lang, status, created_at, last_seen_at, gender, birth_year)" +
        " VALUES (?, ?, ?, ?, ?, 'athlete', ?, 'active', ?, ?, ?, ?)"
    )
      .bind(u.id, u.email, u.name, u.salt, u.hash, u.lang, now, now, u.gender, u.birthYear)
      .run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO users (id, email, name, pass_salt, pass_hash, role, lang, status, created_at, last_seen_at)" +
      " VALUES (?, ?, ?, ?, ?, 'athlete', ?, 'active', ?, ?)"
  )
    .bind(u.id, u.email, u.name, u.salt, u.hash, u.lang, now, now)
    .run();
}

export async function signup(request, env) {
  const shut = await signupRefusal(env);
  if (shut) return shut;

  const body = await readBody(request);
  const form = readSignup(body);
  if (form.error) return json({ error: form.error }, 400);
  // Counted once the form is right, so two typos and a short password do not
  // cost an hour, and it is the expensive half -- hashing, then the insert --
  // that the cap actually protects.
  if (await tooOften(env.STATS, "su", ipOf(request), 3, 3600)) return json({ error: "too-often" }, 429);

  const { salt, hash } = await hashPassword(form.password);
  const id = uid();
  try {
    await insertUser(env, Object.assign({}, form, {
      id, salt, hash, lang: cleanLang(body.lang), gender: cleanGender(body.gender),
    }));
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

/* What the form sent, cleaned — or, for a field it left out, what the account
   already says. */
const sentOr = (body, key, clean, kept) => (body[key] !== undefined ? clean(body[key]) : kept);
const flag = (v) => (v ? 1 : 0);

function readProfile(body, user) {
  return {
    name: body.name != null ? cleanName(body.name) : user.name,
    lang: body.lang != null ? cleanLang(body.lang) : user.lang,
    gender: body.gender != null ? cleanGender(body.gender) : user.gender || "",
    birth_year: sentOr(body, "birth_year", cleanYear, user.birth_year),
    avatar: sentOr(body, "avatar", cleanAvatar, user.avatar || ""),
    bio: sentOr(body, "bio", cleanBio, user.bio || ""),
    instagram: sentOr(body, "instagram", cleanHandle, user.instagram || ""),
    instagram_hidden: flag(sentOr(body, "instagram_hidden", Boolean, user.instagram_hidden)),
    bio_hidden: flag(sentOr(body, "bio_hidden", Boolean, user.bio_hidden)),
    // Not `user.week_goal` on its own: before 0012 there is no column to read
    // back, and undefined there would look exactly like a refused number.
    week_goal: sentOr(body, "week_goal", cleanGoal, user.week_goal == null ? 3 : user.week_goal),
  };
}

function refusedField(p) {
  if (!p.name) return "bad-name";
  if (p.birth_year === undefined) return "bad-year";
  if (p.week_goal === undefined) return "bad-goal";
  return null;
}

/* Only the columns this database actually has: 0006 and 0007 are applied by
   hand here, so between a deploy and its migration the name and the language
   must still save rather than the whole form failing on a column nobody made
   yet. Each row comes out once its migration is in. `probe` is the column
   whose presence says the migration ran. */
const OPTIONAL_COLUMNS = [
  { probe: "birth_year", cols: ["gender", "birth_year"] },
  { probe: "avatar", cols: ["avatar"] },
  { probe: "week_goal", cols: ["week_goal"] },
  { probe: "bio", cols: ["bio"] },
  { probe: "bio_hidden", cols: ["bio_hidden"] },
  { probe: "instagram", cols: ["instagram"] },
  { probe: "instagram_hidden", cols: ["instagram_hidden"] },
];

/* What went in is what comes back: a field the database could not hold is not
   echoed as though it had been kept, or the app shows an avatar that the next
   reload takes away again. */
async function columnsHeld(env, p) {
  const saved = { name: p.name, lang: p.lang };
  for (const { probe, cols } of OPTIONAL_COLUMNS) {
    if (!(await hasColumn(env, "users", probe))) continue;
    for (const col of cols) saved[col] = p[col];
  }
  return saved;
}

export const profile = withUser(async (request, env, user) => {
  const p = readProfile(await readBody(request), user);
  const refused = refusedField(p);
  if (refused) return json({ error: refused }, 400);

  // Column names come only from OPTIONAL_COLUMNS above, never from the body.
  const saved = await columnsHeld(env, p);
  const cols = Object.keys(saved);
  await env.DB.prepare("UPDATE users SET " + cols.map((c) => c + " = ?").join(", ") + " WHERE id = ?")
    .bind(...cols.map((c) => saved[c]), user.id)
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
