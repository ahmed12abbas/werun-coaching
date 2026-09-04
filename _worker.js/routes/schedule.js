/* The coach's side of the sessions: putting one in front of the club,
   showing the code at the track, and seeing who came.

   Gated by the club password in the body, like the rest of the console.
   Phase 3 moves this behind a coach login; the answers keep their shape. */

import { json, readBody } from "../lib/http.js";
import { uid, nowISO, refuseUnlessCoach } from "../lib/auth.js";
import { getSetting } from "../lib/settings.js";
import { signSlot, slotNow, slotRemaining, checkinUrl } from "../lib/checkin.js";
import { addPoints } from "../lib/points.js";
import { dayFromName } from "../lib/week.js";

const MAX = { name: 80, payload: 4000 };
const LIST = 40;

/** Everything the coach's list needs: the session, and how many came. */
async function sessionList(env) {
  const rows = await env.DB.prepare(
    "SELECT s.*, (SELECT COUNT(*) FROM checkins c WHERE c.session_id = s.id AND c.voided_at IS NULL) AS came" +
      " FROM club_sessions s ORDER BY s.starts_at DESC LIMIT ?"
  )
    .bind(LIST)
    .all();
  return rows.results || [];
}

/* ---------- POST /api/admin/sessions -------------------------------------- */

export async function adminSessions(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  const action = String(body.action || "list");

  if (action === "publish") {
    const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, MAX.name);
    const payload = String(body.payload || "").slice(0, MAX.payload);
    const date = String(body.date || "");
    const startsAt = new Date(String(body.starts_at || ""));
    if (!name) return json({ error: "bad-name" }, 400);
    if (!payload) return json({ error: "bad-payload" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad-date" }, 400);
    if (isNaN(startsAt)) return json({ error: "bad-time" }, 400);

    // The window comes from the settings, so the coach moves it once for
    // every session rather than per session.
    const before = await getSetting(env, "window_before_min");
    const after = await getSetting(env, "window_after_min");
    const points = Number.isFinite(Number(body.points))
      ? Math.max(0, Math.min(1000, Math.round(Number(body.points))))
      : await getSetting(env, "points_per_checkin");

    // Which standing slot this fills, if it fills one: the week then shows the
    // workout in its place rather than both.
    const scheduleId = /^[A-Za-z0-9_-]{1,64}$/.test(String(body.schedule_id || "")) ? String(body.schedule_id) : null;
    if (scheduleId) {
      const slot = await env.DB.prepare("SELECT id FROM schedule WHERE id = ?").bind(scheduleId).first();
      if (!slot) return json({ error: "no-entry" }, 404);
    }

    const id = uid();
    await env.DB.prepare(
      "INSERT INTO club_sessions (id, date, day, name, payload, starts_at, window_open_at, window_close_at, points, created_at, schedule_id)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        id,
        date,
        dayFromName(name),
        name,
        payload,
        startsAt.toISOString(),
        new Date(startsAt.getTime() - before * 60000).toISOString(),
        new Date(startsAt.getTime() + after * 60000).toISOString(),
        points,
        nowISO(),
        scheduleId
      )
      .run();
    return json({ id: id, sessions: await sessionList(env) });
  }

  if (action === "roster") {
    const rows = await env.DB.prepare(
      "SELECT c.id, c.at, c.voided_at, u.name, u.email FROM checkins c JOIN users u ON u.id = c.user_id" +
        " WHERE c.session_id = ? ORDER BY c.at ASC"
    )
      .bind(String(body.id || ""))
      .all();
    return json({ roster: rows.results || [] });
  }

  if (action === "void") {
    // Taking a check-in back takes its points with it — as a reversing row,
    // so the athlete's history says what happened rather than quietly
    // shrinking. Voiding an already-voided one changes nothing.
    const row = await env.DB.prepare("SELECT * FROM checkins WHERE id = ?").bind(String(body.id || "")).first();
    if (!row) return json({ error: "no-checkin" }, 404);
    if (!row.voided_at) {
      await env.DB.prepare("UPDATE checkins SET voided_at = ?, voided_by = 'coach' WHERE id = ?")
        .bind(nowISO(), row.id)
        .run();
      const back = await env.DB.prepare(
        "SELECT COALESCE(SUM(delta), 0) AS n FROM points_ledger WHERE ref_id = ? AND user_id = ?"
      )
        .bind(row.id, row.user_id)
        .first();
      const owed = (back && back.n) || 0;
      if (owed) await addPoints(env, row.user_id, -owed, "void", row.id, null);
    }
    const rows = await env.DB.prepare(
      "SELECT c.id, c.at, c.voided_at, u.name, u.email FROM checkins c JOIN users u ON u.id = c.user_id" +
        " WHERE c.session_id = ? ORDER BY c.at ASC"
    )
      .bind(row.session_id)
      .all();
    return json({ roster: rows.results || [], sessions: await sessionList(env) });
  }

  if (action === "delete") {
    // Only while nobody has been counted: a session with check-ins is part of
    // people's points, and deleting it would take them away silently. Void
    // the check-ins first, deliberately, and then it can go.
    const id = String(body.id || "");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM checkins WHERE session_id = ?").bind(id).first();
    if ((n && n.n) || 0) return json({ error: "has-checkins" }, 409);
    await env.DB.prepare("DELETE FROM club_sessions WHERE id = ?").bind(id).run();
    return json({ sessions: await sessionList(env) });
  }

  if (action !== "list") return json({ error: "bad-request" }, 400);
  return json({
    sessions: await sessionList(env),
    qr: !!env.QR_SECRET,
    points_per_checkin: await getSetting(env, "points_per_checkin"),
  });
}

/* ---------- POST /api/admin/qr -------------------------------------------- */

/*
 * One code, good for this thirty-second slot and the ones either side of it.
 * The screen asks again as each slot turns over, which is what makes a
 * photograph of the code useless a minute later.
 */
export async function adminQr(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;
  if (!env.QR_SECRET) return json({ error: "qr-off" }, 503);

  const id = String(body.id || "");
  const session = await env.DB.prepare(
    "SELECT id, name, window_open_at, window_close_at FROM club_sessions WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!session) return json({ error: "no-session" }, 404);

  const slot = slotNow();
  const sig = await signSlot(env.QR_SECRET, session.id, slot);
  const origin = new URL(request.url).origin;
  const now = nowISO();

  return json({
    url: checkinUrl(origin, session.id, slot, sig),
    slot: slot,
    seconds: slotRemaining(),
    name: session.name,
    open: now >= session.window_open_at && now <= session.window_close_at,
    window_open_at: session.window_open_at,
    window_close_at: session.window_close_at,
    came: ((await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM checkins WHERE session_id = ? AND voided_at IS NULL"
    )
      .bind(session.id)
      .first()) || {}).n || 0,
  });
}
