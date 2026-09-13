/* Who is asking.

   An athlete logs in once per device and gets a cookie: 32 random bytes,
   HttpOnly so no script on the page can read it, Secure, SameSite=Lax so a
   link from the group chat still opens logged in. The database keeps only
   the SHA-256 of that token, so reading the table out does not hand anyone
   a live login. Passwords are PBKDF2-SHA256 with a per-user salt, via
   WebCrypto — nothing here is home-made. */

import { json } from "./http.js";
import { hex, safeEqual, sha256, guessingTooOften } from "./crypto.js";
import { getSetting } from "./settings.js";

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
  // Rows nobody could use any more, cleared on the way past: a login is rare
  // enough to carry one extra delete, and nothing else would ever do it.
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date().toISOString()).run();
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
  await touchLastSeen(env, row, now);
  return row;
}

/* About hourly, not on every request: often enough to say who is still
   coming, rarely enough that a busy screen is not a write each time. A date
   that will not parse is left alone, as it always has been. */
async function touchLastSeen(env, row, now) {
  const stale = !row.last_seen_at || Date.parse(now) - Date.parse(row.last_seen_at) > 3600 * 1000;
  if (stale) await env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(now, row.id).run();
}

/** What the page may know about an account. Never the hash, never the salt. */
export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  lang: u.lang,
  created_at: u.created_at,
  // The app shows a "confirm your email" line until this is filled in, so it
  // has to travel; it says nothing a member does not already know.
  email_verified_at: u.email_verified_at || null,
  // The face beside their name, or "" for their initial. Until 0007 is
  // applied the column is not there, and "" is exactly the right answer.
  avatar: u.avatar || "",
  // Whether the Me screen offers the console. Until 0010 is applied the
  // column is not there, and every coach still runs the club — which is what
  // adminUnknown() below decides, and this has to agree with it.
  is_admin: u.is_admin === undefined ? undefined : !!u.is_admin,
  // How many sessions a week they are aiming for, which the home screen
  // counts against. Until 0012 is applied the column is not there and three
  // is the club's own week — the same answer the migration's default gives,
  // so the number does not change under them when it lands.
  week_goal: u.week_goal === null || u.week_goal === undefined ? 3 : u.week_goal,
  // The line they wrote about themselves. Until 0013 is applied there is no
  // column, and "" is exactly what an athlete who has written nothing has.
  bio: u.bio || "",
  // Whether it stays off the club board. Before 0014 there is no column and
  // the board was showing every line, so false is both the fallback and what
  // was actually happening.
  bio_hidden: !!u.bio_hidden,
  // Their Instagram, and whether the club may have it. 0015 lands after the
  // deploy that reads it: no column means no handle, which is what every
  // member has until they type one.
  instagram: u.instagram || "",
  instagram_hidden: !!u.instagram_hidden,
  // Their Strava athlete number (0022); no column yet means none typed.
  strava_athlete: u.strava_athlete || "",
  // Their own answers, so the Me screen can show what they said.
  gender: u.gender || "",
  birth_year: u.birth_year === null || u.birth_year === undefined ? null : u.birth_year,
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

/**
 * The athlete-facing reads — the week, a session, the feed, checking in,
 * points. The same as withUser, plus the maintenance switch.
 *
 * Deliberately not applied to logging in, logging out, /me or the password
 * form: whatever else is switched off, an athlete must always be able to get
 * into and out of their own account.
 */
export const withMember = (fn) =>
  withUser(async (request, env, user) => {
    // An admin who does not coach is the one doing the repairing, so the
    // switch must not hold them out either.
    if (!isCoach(user) && !isAdmin(user) && (await getSetting(env, "maintenance"))) {
      return json({ error: "maintenance" }, 503);
    }
    return fn(request, env, user);
  });

/**
 * The track guard: a coach or an admin, known either by their login or by the
 * club password in the body. What a coach needs standing at the gate — the
 * head count, the week, the code, the roster.
 *
 * The password is not retired along with the switch to accounts, because it
 * is the only way back in if the admin loses their account — and it is how
 * the first one gets made in the first place, since a club that has never had
 * one has nobody to promote. It is rate-limited before it is compared, and
 * somebody who is logged in never sends it at all.
 *
 * Answers with the Response to send instead, or null to go on.
 */
export async function refuseUnlessCoach(request, env, body) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  const user = await currentUser(request, env);
  if (isCoach(user) || isAdmin(user)) return null;
  return clubPasswordRefusal(request, env, passwordIn(body), () => json({ error: "bad-password" }, 401));
}

const passwordIn = (body) => String((body && body.password) || "");

/* The club password, for both guards: refused outright when none is set, and
   rate-limited before it is compared. Null when it matched; otherwise the
   refusal, with `wrong()` saying what a wrong one is answered with. */
async function clubPasswordRefusal(request, env, given, wrong) {
  if (!env.ADMIN_PASSWORD) return json({ error: "not-configured" }, 503);
  const slow = await guessingTooOften(request, env);
  if (slow) return slow;
  if (await safeEqual(given, env.ADMIN_PASSWORD)) return null;
  return wrong();
}

/** A coach in good standing — the person who takes sessions. */
export const isCoach = (u) => !!(u && u.role === "coach" && u.status !== "blocked");

/** An admin in good standing — the person who runs the club. */
export const isAdmin = (u) => !!(u && u.is_admin && u.status !== "blocked");

/*
 * The window between a deploy and the migration behind it: 0010 adds
 * `is_admin`, and until it is applied nobody has one, which would lock every
 * coach out of the console they had this morning. So while the column is
 * missing the old rule stands — a coach runs the club — and the moment it
 * lands the real boundary takes over. Take this out once 0010 is in.
 *
 * Read off the row rather than asked of the schema: currentUser() does
 * SELECT u.*, so a missing column is `undefined` and a present one is 0 or 1.
 * hasColumn() would answer this too, but it caches — and it cannot tell a
 * column that is absent from a PRAGMA that threw, so one transient D1 error
 * on a cold isolate would hand every coach the whole console for the life of
 * that isolate. A row that could not be read is no user at all, and refused
 * a line above. Fail closed, and say why.
 */
const adminUnknown = (u) => !!u && u.is_admin === undefined;

/**
 * The console's own guard: an admin, known either by their login or by the
 * club password in the body.
 *
 * Everything that changes the club goes through this — publishing, the
 * standing week, members, the news, the shop, the switches and the exports.
 * What a coach needs at the track goes through refuseUnlessCoach() instead.
 */
export async function refuseUnlessAdmin(request, env, body) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  const user = await currentUser(request, env);
  if (isAdmin(user)) return null;
  if (isCoach(user) && adminUnknown(user)) return null;

  // A coach who is logged in and sent no password is told what they are,
  // rather than asked for one they have no reason to have: they are not a
  // stranger at the door, they are staff on the wrong screen. But a password
  // they did send is still tried — the club password is documented as the way
  // back when an account is lost, and a coach cookie must not be what stops
  // it working.
  const given = passwordIn(body);
  const coach = isCoach(user);
  if (!given && coach) return json({ error: "not-admin" }, 403);

  // A coach who guessed wrong is still told what they are rather than what the
  // password was: which of the two failed is not theirs to learn.
  return clubPasswordRefusal(request, env, given, () =>
    coach ? json({ error: "not-admin" }, 403) : json({ error: "bad-password" }, 401)
  );
}
