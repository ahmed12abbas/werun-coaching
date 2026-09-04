/* The coach's side of the platform: members and the switches.

   Gated the same way as the dashboard for now — the club password in the
   body, checked against ADMIN_PASSWORD. Phase 3 moves this behind a coach
   login; the shape of the answers will not change. */

import { json, readBody } from "../lib/http.js";
import { nowISO, refuseUnlessCoach } from "../lib/auth.js";
import { DEFAULTS, allSettings, setSetting } from "../lib/settings.js";

const MEMBER_CAP = 500;

async function memberList(env) {
  const rows = await env.DB.prepare(
    "SELECT u.id, u.email, u.name, u.role, u.lang, u.status, u.created_at, u.last_seen_at, u.email_verified_at," +
      " u.gender, u.birth_year," +
      " COALESCE((SELECT SUM(delta) FROM points_ledger p WHERE p.user_id = u.id), 0) AS points," +
      " (SELECT COUNT(*) FROM checkins c WHERE c.user_id = u.id AND c.voided_at IS NULL) AS checkins" +
      " FROM users u ORDER BY u.created_at DESC LIMIT ?"
  )
    .bind(MEMBER_CAP)
    .all();
  return rows.results || [];
}

/* ---------- POST /api/admin/members -------------------------------------- */

/*
 * One route, three verbs. No `action` means "show me"; `block`/`unblock`
 * and `role` change one member and answer with the fresh list, so the page
 * never has to guess what the database now says.
 *
 * Blocking ends every session the member has, on the spot.
 */
export async function members(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  const action = String(body.action || "");
  const id = String(body.id || "");
  if (action && !id) return json({ error: "bad-request" }, 400);

  if (action === "block" || action === "unblock") {
    await env.DB.prepare("UPDATE users SET status = ? WHERE id = ?")
      .bind(action === "block" ? "blocked" : "active", id)
      .run();
    if (action === "block") await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  } else if (action === "role") {
    const role = body.role === "coach" ? "coach" : "athlete";
    await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  } else if (action) {
    return json({ error: "bad-request" }, 400);
  }

  return json({ members: await memberList(env), at: nowISO() });
}

/* ---------- POST /api/admin/settings ------------------------------------- */

/* `set` carries only the keys being changed; unknown keys are ignored rather
   than stored, so a typo cannot plant a setting nothing reads. */
export async function settings(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  const set = body.set && typeof body.set === "object" ? body.set : {};
  for (const key of Object.keys(set)) {
    if (!(key in DEFAULTS)) continue;
    const want = set[key];
    const fallback = DEFAULTS[key];
    let value;
    if (typeof fallback === "boolean") value = !!want;
    else if (typeof fallback === "number") {
      value = Number(want);
      if (!Number.isFinite(value) || value < 0 || value > 100000) continue;
      value = Math.round(value);
    } else value = String(want).slice(0, 500);
    await setSetting(env, key, value);
  }

  return json({ settings: await allSettings(env) });
}
