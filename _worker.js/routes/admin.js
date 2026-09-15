/* The coach's side of the platform: members and the switches.

   Gated the same way as the dashboard for now — the club password in the
   body, checked against ADMIN_PASSWORD. Phase 3 moves this behind a coach
   login; the shape of the answers will not change. */

import { json, readBody, objectIn } from "../lib/http.js";
import { nowISO, currentUser, refuseUnlessAdmin } from "../lib/auth.js";
import { DEFAULTS, allSettings, setSetting } from "../lib/settings.js";
import { hasColumn } from "../lib/columns.js";
import { coachList } from "../lib/coaches.js";
import { resetLinkFor } from "./email.js";

const MEMBER_CAP = 500;

async function memberList(env) {
  const bio = (await hasColumn(env, "users", "birth_year")) ? " u.gender, u.birth_year," : " '' AS gender, NULL AS birth_year,";
  // Until 0010 is applied there is no column to read, and every coach still
  // runs the club — the same answer refuseUnlessAdmin() gives in that window,
  // so the screen and the guard cannot disagree about who can do what.
  const admin = (await hasColumn(env, "users", "is_admin"))
    ? " u.is_admin,"
    : " CASE WHEN u.role = 'coach' THEN 1 ELSE 0 END AS is_admin,";
  const leader = (await hasColumn(env, "users", "is_leader")) ? " u.is_leader," : " 0 AS is_leader,";
  const rows = await env.DB.prepare(
    "SELECT u.id, u.email, u.name, u.role, u.lang, u.status, u.created_at, u.last_seen_at, u.email_verified_at," +
      bio +
      admin +
      leader +
      " COALESCE((SELECT SUM(delta) FROM points_ledger p WHERE p.user_id = u.id), 0) AS points," +
      " (SELECT COUNT(*) FROM checkins c WHERE c.user_id = u.id AND c.voided_at IS NULL) AS checkins," +
      " (SELECT COUNT(*) FROM email_tokens t WHERE t.user_id = u.id AND t.purpose = 'reset'" +
      "   AND t.used_at IS NULL AND t.expires_at > ?) AS pending_reset" +
      " FROM users u ORDER BY u.created_at DESC LIMIT ?"
  )
    .bind(nowISO(), MEMBER_CAP)
    .all();
  return rows.results || [];
}

/* ---------- POST /api/admin/members -------------------------------------- */

/*
 * One route, four verbs. No `action` means "show me"; `block`/`unblock`,
 * `role` and `admin` change one member and answer with the fresh list, so
 * the page never has to guess what the database now says.
 *
 * `role` is who takes sessions; `admin` is who runs the club. Two columns,
 * because they are two questions — see migrations/0010_admin.sql.
 *
 * Blocking ends every session the member has, on the spot.
 */
/* Each verb changes one member and answers null, or refuses with a response. */
async function setStatus(request, env, body, action, id) {
  const blocking = action === "block";
  await env.DB.prepare("UPDATE users SET status = ? WHERE id = ?")
    .bind(blocking ? "blocked" : "active", id)
    .run();
  if (blocking) await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  return null;
}

/* A leader is a coach with another label (0024): same role, same guards. */
async function setRole(request, env, body, action, id) {
  const leader = body.role === "leader";
  const role = leader || body.role === "coach" ? "coach" : "athlete";
  if (await hasColumn(env, "users", "is_leader")) {
    await env.DB.prepare("UPDATE users SET role = ?, is_leader = ? WHERE id = ?").bind(role, leader ? 1 : 0, id).run();
  } else {
    if (leader) return json({ error: "no-column" }, 503);
    await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  }
  return null;
}

async function setAdmin(request, env, body, action, id) {
  // Nothing to write to until 0010 lands; saying so beats a 500 that reads
  // like the club is broken.
  if (!(await hasColumn(env, "users", "is_admin"))) return json({ error: "no-column" }, 503);
  // Say so rather than writing nothing, the way /api/admin/coaches does.
  const who = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!who) return json({ error: "no-member" }, 404);
  const want = !!body.admin;
  // Standing on the console and taking your own admin off it is a mis-tap
  // that locks you out of the screen you are on. The club password is the
  // way back, but somebody else has to do this one — the same rule the
  // coaches list follows, for the same reason.
  if (!want) {
    const self = await notYourself(request, env, id);
    if (self) return self;
  }
  await env.DB.prepare("UPDATE users SET is_admin = ? WHERE id = ?").bind(want ? 1 : 0, id).run();
  return null;
}

/* Refuses when the member being taken off something is the one asking. */
async function notYourself(request, env, id) {
  const me = await currentUser(request, env);
  return me && me.id === id ? json({ error: "not-yourself" }, 409) : null;
}

/* Not a change but an answer of its own: the link, for the admin to send. A
   blocked member stays out, so they get no way back in by this door either. */
async function resetLink(request, env, body, action, id) {
  const who = await env.DB.prepare("SELECT status FROM users WHERE id = ?").bind(id).first();
  if (!who) return json({ error: "no-member" }, 404);
  if (who.status === "blocked") return json({ error: "blocked" }, 409);
  return json({ link: await resetLinkFor(env, request, id) });
}

/* Off a session's "Who came" list: this athlete's next check-in ends in the
   feedback box, once — routes/checkin.js spends the flag, and `ask: false`
   takes it back. An answer of its own, like the reset link: the roster that
   asked has no use for the whole members table. */
async function askFeedback(request, env, body, action, id) {
  if (!(await hasColumn(env, "users", "ask_feedback"))) return json({ error: "no-column" }, 503);
  const who = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!who) return json({ error: "no-member" }, 404);
  const on = body.ask !== false;
  await env.DB.prepare("UPDATE users SET ask_feedback = ? WHERE id = ?").bind(on ? 1 : 0, id).run();
  return json({ ask_feedback: on });
}

const MEMBER_ACTIONS = new Map([
  ["block", setStatus],
  ["unblock", setStatus],
  ["role", setRole],
  ["admin", setAdmin],
  ["reset-link", resetLink],
  ["ask-feedback", askFeedback],
]);

export async function members(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessAdmin(request, env, body);
  if (no) return no;

  const action = String(body.action || "");
  const id = String(body.id || "");
  if (action && !id) return json({ error: "bad-request" }, 400);

  // No action is "show me": straight to the list.
  if (action) {
    const change = MEMBER_ACTIONS.get(action);
    if (!change) return json({ error: "bad-request" }, 400);
    const refused = await change(request, env, body, action, id);
    if (refused) return refused;
  }

  return json({ members: await memberList(env), at: nowISO() });
}

/* ---------- POST /api/admin/coaches -------------------------------------- */

/*
 * The coaches, on their own screen.
 *
 * Promoting somebody has always been possible from the members table, but
 * finding them there means reading five hundred rows for the four that
 * matter — and nothing anywhere answered "who are the coaches?", which is
 * the question a picker on a session has to ask. So: the short list, plus
 * the members who could join it, and the two verbs that move somebody
 * between them.
 *
 * `role` on /api/admin/members still does the same thing; this is the same
 * column, read the other way round.
 */
export async function coaches(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessAdmin(request, env, body);
  if (no) return no;

  const action = String(body.action || "list");
  if (action === "add" || action === "remove") {
    const refused = await changeCoach(request, env, action, String(body.id || ""), !!body.leader);
    if (refused) return refused;
  } else if (action !== "list") {
    return json({ error: "bad-request" }, 400);
  }

  return json(await coachesAndCandidates(env));
}

/* One member onto the coaches list or off it. Null once done, or the refusal. */
async function changeCoach(request, env, action, id, leader) {
  if (!id) return json({ error: "bad-request" }, 400);
  const who = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!who) return json({ error: "no-member" }, 404);
  // Signing yourself out of the console mid-change is not a thing to let
  // happen by mis-tap. The club password is the way back either way, but a
  // coach who demotes themselves loses the screen they are standing on.
  if (action === "remove") {
    const self = await notYourself(request, env, id);
    if (self) return self;
  }
  // `add` on somebody already coaching is how the label flips coach <-> leader.
  const add = action === "add";
  await env.DB.prepare("UPDATE users SET role = ?, is_leader = ? WHERE id = ?")
    .bind(add ? "coach" : "athlete", add && leader ? 1 : 0, id)
    .run();
  return null;
}

/* The coaches, and everyone who could be one: active members, not already a
   coach, newest first — the same order the members table uses, because the
   coach being made is nearly always somebody the club took on recently. */
async function coachesAndCandidates(env) {
  const rows = await env.DB.prepare(
    "SELECT id, name, email FROM users WHERE role <> 'coach' AND status = 'active'" +
      " ORDER BY created_at DESC LIMIT ?"
  )
    .bind(MEMBER_CAP)
    .all();
  return { coaches: await coachList(env), candidates: rows.results || [], at: nowISO() };
}

/* ---------- POST /api/admin/settings ------------------------------------- */

/* `set` carries only the keys being changed; unknown keys are ignored rather
   than stored, so a typo cannot plant a setting nothing reads. */
export async function settings(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessAdmin(request, env, body);
  if (no) return no;

  const set = objectIn(body.set);
  for (const key of Object.keys(set)) {
    if (!(key in DEFAULTS)) continue;
    const value = settingValue(DEFAULTS[key], set[key]);
    if (value !== undefined) await setSetting(env, key, value);
  }

  return json({ settings: await allSettings(env) });
}

/* What the page sent, made into the type the setting's default already is:
   a switch, a whole number within bounds, or a line of text. undefined for a
   number that will not do, which leaves the setting as it was. */
function settingValue(fallback, want) {
  if (typeof fallback === "boolean") return !!want;
  if (typeof fallback === "number") {
    const n = Number(want);
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n) : undefined;
  }
  return String(want).slice(0, 500);
}
