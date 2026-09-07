/* The coach's side of the sessions: putting one in front of the club,
   showing the code at the track, and seeing who came.

   Gated by the club password in the body, like the rest of the console.
   Phase 3 moves this behind a coach login; the answers keep their shape. */

import { json, readBody } from "../lib/http.js";
import { uid, nowISO, refuseUnlessCoach, refuseUnlessAdmin } from "../lib/auth.js";
import { getSetting } from "../lib/settings.js";
import { signSlot, slotNow, slotRemaining, checkinUrl, windowMinutes, windowFor } from "../lib/checkin.js";
import { addPoints } from "../lib/points.js";
import { dayFromName, DAYS } from "../lib/week.js";
import { weekdayOf } from "../lib/weekplan.js";
import { cleanCoachId, coachRoster } from "../lib/coaches.js";

/* Riyadh is UTC+3 all year with no daylight saving, so a standing session's
   wall-clock "04:55" becomes a real instant by saying which clock it is on. */
const CLUB_OFFSET = "+03:00";
const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/* The actions /coach needs, and the only ones a coach who is not an admin
   can reach. Everything else on this route changes the club. */
const TRACK = new Set(["list", "roster", "open"]);

/* How far either side of today a code may be opened for. Wide enough for a
   coach setting up next month's race, short enough that the calendar cannot
   be filled with sessions nobody asked for. */
const OPEN_DAYS = 60;
const shiftDate = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

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
  // The window each row is under *now*, not the one it was written with, so
  // the console and the app cannot disagree about whether a session is open.
  const mins = await windowMinutes(env);
  return (rows.results || []).map((row) => Object.assign({}, row, {
    window_open_at: windowFor(row, mins).open,
    window_close_at: windowFor(row, mins).close,
  }));
}

/* ---------- POST /api/admin/sessions -------------------------------------- */

export async function adminSessions(request, env) {
  const body = await readBody(request);
  const action = String(body.action || "list");

  // Which guard depends on the verb. Reading the week, opening a code and
  // seeing who scanned it are what a coach is at the track to do; publishing
  // a workout, voiding somebody's check-in and removing a session from the
  // calendar are running the club.
  const no = TRACK.has(action)
    ? await refuseUnlessCoach(request, env, body)
    : await refuseUnlessAdmin(request, env, body);
  if (no) return no;

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
    let slot = null;
    if (scheduleId) {
      slot = await env.DB.prepare("SELECT * FROM schedule WHERE id = ?").bind(scheduleId).first();
      if (!slot) return json({ error: "no-entry" }, 404);
    }

    // Who is taking it: what the form said, or whoever usually has the slot.
    // Written now rather than resolved on the way out, so a coach who later
    // stops coaching does not take this session's history with them.
    const coachId = cleanCoachId(body.coach_id) || cleanCoachId(slot && slot.coach_id) || null;

    /* Publishing the same session twice is the coach correcting it, not the
       club running it twice: a row already on that date, in that slot or at
       that minute, is this one and gets rewritten. Rewritten rather than
       deleted and replaced, because anybody who has already scanned the code
       checked in to *this* session and their row points at this id. */
    const same = await env.DB.prepare(
      "SELECT s.id, s.schedule_id," +
        " (SELECT COUNT(*) FROM checkins c WHERE c.session_id = s.id AND c.voided_at IS NULL) AS came" +
        " FROM club_sessions s WHERE s.date = ?" +
        " AND (s.starts_at = ? OR (s.schedule_id IS NOT NULL AND s.schedule_id = ?))" +
        " ORDER BY came DESC, s.created_at DESC"
    )
      .bind(date, startsAt.toISOString(), scheduleId)
      .all();
    const dup = (same.results || [])[0];
    if (dup) {
      await env.DB.prepare(
        "UPDATE club_sessions SET day = ?, name = ?, payload = ?, starts_at = ?," +
          " window_open_at = ?, window_close_at = ?, points = ?, schedule_id = ?, coach_id = ?" +
          " WHERE id = ?"
      )
        .bind(
          dayFromName(name),
          name,
          payload,
          startsAt.toISOString(),
          new Date(startsAt.getTime() - before * 60000).toISOString(),
          new Date(startsAt.getTime() + after * 60000).toISOString(),
          points,
          // A form with no slot picker must not un-slot a session it is only
          // correcting: the row keeps whichever slot it already filled.
          scheduleId || dup.schedule_id || null,
          coachId,
          dup.id
        )
        .run();
      /* Anything else already sitting on that minute is the double this is
         here to end — gone, unless somebody scanned it. A row with check-ins
         is a session that happened, and attendance is not ours to delete; the
         coach is left to sort those two out by hand. */
      for (const other of (same.results || []).slice(1)) {
        if (other.came) continue;
        await env.DB.prepare("DELETE FROM club_sessions WHERE id = ?").bind(other.id).run();
      }
      return json({ id: dup.id, replaced: true, sessions: await sessionList(env), coaches: await coachRoster(env) });
    }

    const id = uid();
    await env.DB.prepare(
      "INSERT INTO club_sessions (id, date, day, name, payload, starts_at, window_open_at," +
        " window_close_at, points, created_at, schedule_id, coach_id)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        scheduleId,
        coachId
      )
      .run();
    return json({ id: id, sessions: await sessionList(env), coaches: await coachRoster(env) });
  }

  if (action === "roster") {
    // The name, and not the email: this is the coach tier, and a name is what
    // ticks somebody off a list. Walking every session id would otherwise be
    // the whole membership's addresses. The CSVs in routes/export.js are the
    // admin-only way to those.
    const rows = await env.DB.prepare(
      "SELECT c.id, c.at, c.voided_at, u.name FROM checkins c JOIN users u ON u.id = c.user_id" +
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
      "SELECT c.id, c.at, c.voided_at, u.name FROM checkins c JOIN users u ON u.id = c.user_id" +
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

  /* ---- a code for a session that carries no workout ---- */

  /*
   * Seven of the club's ten weekly sessions are standing ones the coach never
   * attaches a workout to — and until this existed that meant seven sessions
   * nobody could check in to, because a code is signed against a session row
   * and there was none. Opening one makes it: same table, same window, same
   * points, same roster, only with no steps behind it.
   *
   * Find before create, so tapping the button twice on the morning of a run
   * shows the same session rather than splitting the roster across two.
   */
  if (action === "open") {
    const scheduleId = String(body.schedule_id || "");
    const date = String(body.date || "");
    if (!ISO_DATE.test(date)) return json({ error: "bad-date" }, 400);
    // This is the only action on the coach tier that writes, and the row it
    // writes is a real session the whole club's week then shows. Find-or-
    // create means one date can only ever make one row, so bounding the date
    // bounds the lot: a code is for a session near enough to stand at, and
    // nobody opens one for 2087.
    if (date < shiftDate(-OPEN_DAYS) || date > shiftDate(OPEN_DAYS)) {
      return json({ error: "bad-date" }, 400);
    }

    const already = await env.DB.prepare(
      "SELECT * FROM club_sessions WHERE schedule_id = ? AND date = ?"
    )
      .bind(scheduleId, date)
      .first();
    if (already) return json({ session: already, sessions: await sessionList(env) });

    const slot = await env.DB.prepare("SELECT * FROM schedule WHERE id = ?").bind(scheduleId).first();
    if (!slot) return json({ error: "no-entry" }, 404);

    // The pattern's time, unless a change moved this one occurrence — and
    // nothing at all if it was called off, because a session nobody is
    // holding is not one to hand out a code for.
    const change = await env.DB.prepare(
      "SELECT at, cancelled FROM schedule_changes WHERE schedule_id = ? AND date = ?"
    )
      .bind(scheduleId, date)
      .first();
    if (change && change.cancelled) return json({ error: "called-off" }, 409);

    const at = (change && change.at) || slot.at;
    const starts = new Date(date + "T" + at + ":00" + CLUB_OFFSET);
    if (isNaN(starts)) return json({ error: "bad-time" }, 400);

    const before = await getSetting(env, "window_before_min");
    const after = await getSetting(env, "window_after_min");
    const id = uid();
    // The day comes from the date, not from the name: dayFromName reads the
    // day out of a session the coach titled "Monday | WeRUN", and a standing
    // slot's title says what it is rather than when.
    // No form to ask, so it inherits: whoever usually takes this slot is who
    // is standing at the track holding the phone up.
    await env.DB.prepare(
      "INSERT INTO club_sessions (id, date, day, name, payload, starts_at, window_open_at," +
        " window_close_at, points, created_at, schedule_id, coach_id)" +
        " VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        id,
        date,
        DAYS[(weekdayOf(date) + 6) % 7],
        slot.title_en || slot.title_ar,
        starts.toISOString(),
        new Date(starts.getTime() - before * 60000).toISOString(),
        new Date(starts.getTime() + after * 60000).toISOString(),
        slot.points,
        nowISO(),
        scheduleId,
        cleanCoachId(slot.coach_id) || null
      )
      .run();

    const made = await env.DB.prepare("SELECT * FROM club_sessions WHERE id = ?").bind(id).first();
    return json({ session: made, sessions: await sessionList(env) });
  }

  if (action !== "list") return json({ error: "bad-request" }, 400);
  return json({
    sessions: await sessionList(env),
    // Both halves of the picker: who can be chosen, and the names to put on
    // the ids the sessions already carry. No join — see lib/coaches.js.
    coaches: await coachRoster(env),
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
    "SELECT id, name, starts_at, window_open_at, window_close_at FROM club_sessions WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!session) return json({ error: "no-session" }, 404);

  const slot = slotNow();
  const sig = await signSlot(env.QR_SECRET, session.id, slot);
  const origin = new URL(request.url).origin;
  const now = nowISO();
  const w = windowFor(session, await windowMinutes(env));

  return json({
    url: checkinUrl(origin, session.id, slot, sig),
    slot: slot,
    seconds: slotRemaining(),
    name: session.name,
    open: now >= w.open && now <= w.close,
    window_open_at: w.open,
    window_close_at: w.close,
    came: ((await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM checkins WHERE session_id = ? AND voided_at IS NULL"
    )
      .bind(session.id)
      .first()) || {}).n || 0,
  });
}
