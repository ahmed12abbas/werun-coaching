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

/* Who scanned a session — the name, and not the email: this is the coach
   tier, and a name is what ticks somebody off a list. Walking every session id
   would otherwise be the whole membership's addresses. The CSVs in
   routes/export.js are the admin-only way to those. */
async function rosterOf(env, sessionId) {
  const rows = await env.DB.prepare(
    "SELECT c.id, c.at, c.voided_at, u.name FROM checkins c JOIN users u ON u.id = c.user_id" +
      " WHERE c.session_id = ? ORDER BY c.at ASC"
  )
    .bind(sessionId)
    .all();
  return rows.results || [];
}

/* The window comes from the settings, so the coach moves it once for every
   session rather than per session. */
async function windowAround(env, starts) {
  const w = windowFor({ starts_at: starts.toISOString() }, await windowMinutes(env));
  return { window_open_at: w.open, window_close_at: w.close };
}

async function insertSession(env, row) {
  await env.DB.prepare(
    "INSERT INTO club_sessions (id, date, day, name, payload, starts_at, window_open_at," +
      " window_close_at, points, created_at, schedule_id, coach_id)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(row.id, row.date, row.day, row.name, row.payload, row.starts_at, row.window_open_at,
      row.window_close_at, row.points, nowISO(), row.schedule_id, row.coach_id)
    .run();
}

/* ---- publish ---- */

function readPublishForm(body) {
  const form = {
    name: String(body.name || "").replace(/\s+/g, " ").trim().slice(0, MAX.name),
    payload: String(body.payload || "").slice(0, MAX.payload),
    date: String(body.date || ""),
    startsAt: new Date(String(body.starts_at || "")),
  };
  if (!form.name) return { error: "bad-name" };
  if (!form.payload) return { error: "bad-payload" };
  if (!ISO_DATE.test(form.date)) return { error: "bad-date" };
  if (isNaN(form.startsAt)) return { error: "bad-time" };
  return form;
}

async function pointsFrom(body, env) {
  const asked = Number(body.points);
  if (!Number.isFinite(asked)) return getSetting(env, "points_per_checkin");
  return Math.max(0, Math.min(1000, Math.round(asked)));
}

/* Which standing slot this fills, if it fills one: the week then shows the
   workout in its place rather than both. */
function slotIdFrom(body) {
  const id = String(body.schedule_id || "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/* Who is taking it: what the form said, or whoever usually has the slot.
   Written now rather than resolved on the way out, so a coach who later stops
   coaching does not take this session's history with them. */
function coachFor(body, slot) {
  return cleanCoachId(body.coach_id) || cleanCoachId(slot && slot.coach_id) || null;
}

/* Publishing the same session twice is the coach correcting it, not the club
   running it twice: a row already on that date, in that slot or at that
   minute, is this one and gets rewritten. Rewritten rather than deleted and
   replaced, because anybody who has already scanned the code checked in to
   *this* session and their row points at this id. Most-attended first. */
async function sameSessions(env, row) {
  const same = await env.DB.prepare(
    "SELECT s.id, s.schedule_id," +
      " (SELECT COUNT(*) FROM checkins c WHERE c.session_id = s.id AND c.voided_at IS NULL) AS came" +
      " FROM club_sessions s WHERE s.date = ?" +
      " AND (s.starts_at = ? OR (s.schedule_id IS NOT NULL AND s.schedule_id = ?))" +
      " ORDER BY came DESC, s.created_at DESC"
  )
    .bind(row.date, row.starts_at, row.schedule_id)
    .all();
  return same.results || [];
}

async function rewriteSession(env, dup, others, row) {
  await env.DB.prepare(
    "UPDATE club_sessions SET day = ?, name = ?, payload = ?, starts_at = ?," +
      " window_open_at = ?, window_close_at = ?, points = ?, schedule_id = ?, coach_id = ?" +
      " WHERE id = ?"
  )
    .bind(row.day, row.name, row.payload, row.starts_at, row.window_open_at, row.window_close_at, row.points,
      // A form with no slot picker must not un-slot a session it is only
      // correcting: the row keeps whichever slot it already filled.
      row.schedule_id || dup.schedule_id || null,
      row.coach_id, dup.id)
    .run();
  /* Anything else already sitting on that minute is the double this is here
     to end — gone, unless somebody scanned it. A row with check-ins is a
     session that happened, and attendance is not ours to delete; the coach is
     left to sort those two out by hand. */
  for (const other of others) {
    if (other.came) continue;
    await env.DB.prepare("DELETE FROM club_sessions WHERE id = ?").bind(other.id).run();
  }
}

async function publish(body, env) {
  const form = readPublishForm(body);
  if (form.error) return json({ error: form.error }, 400);

  const scheduleId = slotIdFrom(body);
  const slot = scheduleId && (await env.DB.prepare("SELECT * FROM schedule WHERE id = ?").bind(scheduleId).first());
  if (scheduleId && !slot) return json({ error: "no-entry" }, 404);

  const row = Object.assign({
    date: form.date,
    day: dayFromName(form.name),
    name: form.name,
    payload: form.payload,
    starts_at: form.startsAt.toISOString(),
    points: await pointsFrom(body, env),
    schedule_id: scheduleId,
    coach_id: coachFor(body, slot),
  }, await windowAround(env, form.startsAt));

  const [dup, ...others] = await sameSessions(env, row);
  if (dup) {
    await rewriteSession(env, dup, others, row);
    return json({ id: dup.id, replaced: true, sessions: await sessionList(env), coaches: await coachRoster(env) });
  }
  row.id = uid();
  await insertSession(env, row);
  return json({ id: row.id, sessions: await sessionList(env), coaches: await coachRoster(env) });
}

/* ---- roster, void, delete ---- */

async function roster(body, env) {
  return json({ roster: await rosterOf(env, String(body.id || "")) });
}

/* Taking a check-in back takes its points with it — as a reversing row, so
   the athlete's history says what happened rather than quietly shrinking. */
async function reverseCheckin(env, row) {
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

async function voidCheckin(body, env) {
  const row = await env.DB.prepare("SELECT * FROM checkins WHERE id = ?").bind(String(body.id || "")).first();
  if (!row) return json({ error: "no-checkin" }, 404);
  // Voiding an already-voided one changes nothing.
  if (!row.voided_at) await reverseCheckin(env, row);
  return json({ roster: await rosterOf(env, row.session_id), sessions: await sessionList(env) });
}

/* Only while nobody has been counted: a session with check-ins is part of
   people's points, and deleting it would take them away silently. Void the
   check-ins first, deliberately, and then it can go. Voided ones do not
   count: their points have already gone back as a reversing row, so there is
   nothing left to take away silently — which is what makes "void them first,
   then it can go" true rather than just written down. */
async function deleteSession(body, env) {
  const id = String(body.id || "");
  if (await liveCheckins(env, id)) return json({ error: "has-checkins" }, 409);
  await env.DB.prepare("DELETE FROM club_sessions WHERE id = ?").bind(id).run();
  return json({ sessions: await sessionList(env) });
}

/* ---- a code for a session that carries no workout ---- */

/* This is the only action on the coach tier that writes, and the row it
   writes is a real session the whole club's week then shows. Find-or-create
   means one date can only ever make one row, so bounding the date bounds the
   lot: a code is for a session near enough to stand at, and nobody opens one
   for 2087. */
function openableDate(date) {
  return ISO_DATE.test(date) && date >= shiftDate(-OPEN_DAYS) && date <= shiftDate(OPEN_DAYS);
}

/* The pattern's time, unless a change moved this one occurrence — and nothing
   at all if it was called off, because a session nobody is holding is not
   one to hand out a code for. */
async function occurrenceOf(env, slot, date) {
  const change = await env.DB.prepare(
    "SELECT at, cancelled FROM schedule_changes WHERE schedule_id = ? AND date = ?"
  )
    .bind(slot.id, date)
    .first();
  if (change && change.cancelled) return { cancelled: true };
  return { starts: new Date(date + "T" + ((change && change.at) || slot.at) + ":00" + CLUB_OFFSET) };
}

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
async function openSession(body, env) {
  const scheduleId = String(body.schedule_id || "");
  const date = String(body.date || "");
  if (!openableDate(date)) return json({ error: "bad-date" }, 400);

  const already = await env.DB.prepare(
    "SELECT * FROM club_sessions WHERE schedule_id = ? AND date = ?"
  )
    .bind(scheduleId, date)
    .first();
  if (already) return json({ session: already, sessions: await sessionList(env) });

  const slot = await env.DB.prepare("SELECT * FROM schedule WHERE id = ?").bind(scheduleId).first();
  if (!slot) return json({ error: "no-entry" }, 404);

  const { cancelled, starts } = await occurrenceOf(env, slot, date);
  if (cancelled) return json({ error: "called-off" }, 409);
  if (isNaN(starts)) return json({ error: "bad-time" }, 400);

  const id = uid();
  await insertSession(env, Object.assign({
    id: id,
    date: date,
    // The day comes from the date, not from the name: dayFromName reads the
    // day out of a session the coach titled "Monday | WeRUN", and a standing
    // slot's title says what it is rather than when.
    day: DAYS[(weekdayOf(date) + 6) % 7],
    name: slot.title_en || slot.title_ar,
    payload: "",
    starts_at: starts.toISOString(),
    points: slot.points,
    schedule_id: scheduleId,
    // No form to ask, so it inherits: whoever usually takes this slot is who
    // is standing at the track holding the phone up.
    coach_id: cleanCoachId(slot.coach_id) || null,
  }, await windowAround(env, starts)));

  const made = await env.DB.prepare("SELECT * FROM club_sessions WHERE id = ?").bind(id).first();
  return json({ session: made, sessions: await sessionList(env) });
}

async function list(body, env) {
  return json({
    sessions: await sessionList(env),
    // Both halves of the picker: who can be chosen, and the names to put on
    // the ids the sessions already carry. No join — see lib/coaches.js.
    coaches: await coachRoster(env),
    qr: !!env.QR_SECRET,
    points_per_checkin: await getSetting(env, "points_per_checkin"),
  });
}

/* A Map rather than an object, so an action called "constructor" is not one. */
const ACTIONS = new Map([
  ["list", list],
  ["roster", roster],
  ["open", openSession],
  ["publish", publish],
  ["void", voidCheckin],
  ["delete", deleteSession],
]);

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

  const run = ACTIONS.get(action);
  return run ? run(body, env) : json({ error: "bad-request" }, 400);
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
    came: await liveCheckins(env, session.id),
  });
}

/* Check-ins on a session that still count. A voided one is a check-in the
   coach took back, and its points have already gone back with it. */
async function liveCheckins(env, sessionId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM checkins WHERE session_id = ? AND voided_at IS NULL"
  )
    .bind(sessionId)
    .first();
  return (row && row.n) || 0;
}
