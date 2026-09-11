/* The coach editing the standing week, and calling one session off. */

import { json, readBody, objectIn, savedId } from "../lib/http.js";
import { uid, nowISO, refuseUnlessCoach, refuseUnlessAdmin } from "../lib/auth.js";
import { validTime } from "../lib/weekplan.js";
import { cleanCoachId, coachRoster } from "../lib/coaches.js";
import { hasColumn } from "../lib/columns.js";
import { windowMinutes } from "../lib/checkin.js";

const MAX = { title: 80, place: 100, url: 300, note: 200, desc: 200 };
const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

/* A pin has to be a link to a map, not a link to anywhere at all: this is put
   in front of the whole club, and http:// on a phone is a downgrade nobody
   asked for. */
function cleanUrl(v) {
  const s = clean(v, MAX.url);
  if (!s) return "";
  return /^https:\/\/\S+$/.test(s) ? s : null;
}

async function list(env) {
  const rows = await env.DB.prepare("SELECT * FROM schedule ORDER BY weekday ASC, at ASC").all();
  return rows.results || [];
}

/* ---------- POST /api/admin/schedule -------------------------------------- */

const slotPoints = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1000, Math.round(Number(v)))) : 10);

/* The columns a save writes, in the order the UPDATE and INSERT name them —
   or why the form cannot be saved. */
function readEntry(e) {
  const title_en = clean(e.title_en, MAX.title);
  const title_ar = clean(e.title_ar, MAX.title);
  if (!title_en && !title_ar) return { error: "bad-title" };
  const weekday = Math.round(Number(e.weekday));
  if (!(weekday >= 0 && weekday <= 6)) return { error: "bad-day" };
  if (!validTime(e.at)) return { error: "bad-time" };
  const map_url = cleanUrl(e.map_url);
  if (map_url === null) return { error: "bad-url" };
  return {
    fields: [
      weekday, String(e.at), title_en, title_ar,
      clean(e.place_en, MAX.place), clean(e.place_ar, MAX.place),
      map_url, slotPoints(e.points), e.active ? 1 : 0,
      cleanCoachId(e.coach_id) || null, // who usually takes it
    ],
  };
}

/* The line about what the session is, once the migration that adds it is in —
   and only when the caller actually named it. seed-schedule.js writes the
   printed schedule and says nothing about descriptions; a re-run of it must
   not wipe what the coach has written. */
async function descColumns(env, e) {
  const said = e.desc_en !== undefined || e.desc_ar !== undefined;
  if (!said || !(await hasColumn(env, "schedule", "desc_en"))) return { sql: "", set: "", values: [] };
  return {
    sql: ", desc_en, desc_ar",
    set: ", desc_en = ?, desc_ar = ?",
    values: [clean(e.desc_en, MAX.desc), clean(e.desc_ar, MAX.desc)],
  };
}

async function updateEntry(env, id, fields, cols) {
  const before = await env.DB.prepare("SELECT id FROM schedule WHERE id = ?").bind(id).first();
  if (!before) return json({ error: "no-entry" }, 404);
  await env.DB.prepare(
    "UPDATE schedule SET weekday = ?, at = ?, title_en = ?, title_ar = ?, place_en = ?," +
      " place_ar = ?, map_url = ?, points = ?, active = ?, coach_id = ?" + cols.set +
      ", updated_at = ? WHERE id = ?"
  )
    .bind(...fields, ...cols.values, nowISO(), id)
    .run();
  return null;
}

async function insertEntry(env, fields, cols) {
  const now = nowISO();
  await env.DB.prepare(
    "INSERT INTO schedule (id, weekday, at, title_en, title_ar, place_en, place_ar, map_url," +
      " points, active, coach_id" + cols.sql + ", created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?" + cols.values.map(() => ", ?").join("") + ", ?, ?)"
  )
    .bind(uid(), ...fields, ...cols.values, now, now)
    .run();
}

async function saveEntry(body, env) {
  const e = objectIn(body.entry);
  const entry = readEntry(e);
  if (entry.error) return json({ error: entry.error }, 400);
  const cols = await descColumns(env, e);
  const id = savedId(e);
  const failed = id ? await updateEntry(env, id, entry.fields, cols) : await insertEntry(env, entry.fields, cols);
  return failed || json({ schedule: await list(env), coaches: await coachRoster(env) });
}

/* Changes recorded against it go with it, which is right: they described an
   occurrence of something that no longer happens. */
async function deleteEntry(body, env) {
  await env.DB.prepare("DELETE FROM schedule WHERE id = ?").bind(String(body.id || "")).run();
  return json({ schedule: await list(env), coaches: await coachRoster(env) });
}

/* The upcoming changes ride along: the console needs both to draw the card,
   and a second request to learn "nothing has moved" is a wasted one. */
async function listWeek(body, env) {
  return json({
    schedule: await list(env),
    changes: await changesAround(env, nowISO().slice(0, 10)),
    coaches: await coachRoster(env),
    // The club's check-in window, so the coach's week can light the session
    // that is open now on the same rule the athlete's week uses.
    window_after_min: (await windowMinutes(env)).after,
  });
}

const SCHEDULE_ACTIONS = new Map([["save", saveEntry], ["delete", deleteEntry], ["list", listWeek]]);

export async function adminSchedule(request, env) {
  const body = await readBody(request);
  const action = String(body.action || "list");

  // /coach draws its week from this read, so a coach may have it. Saving a
  // slot or deleting one moves every week after it, and is the club's.
  const no = action === "list"
    ? await refuseUnlessCoach(request, env, body)
    : await refuseUnlessAdmin(request, env, body);
  if (no) return no;

  const run = SCHEDULE_ACTIONS.get(action);
  return run ? run(body, env) : json({ error: "bad-request" }, 400);
}

/* ---------- POST /api/admin/schedule-change -------------------------------
   Moving or calling off one occurrence, and putting it back.
   ------------------------------------------------------------------------- */

/* A place left out means "where it usually is"; a note left empty means none. */
const optionalPlace = (v) => (v === undefined ? null : clean(v, MAX.place));
const optionalNote = (v) => clean(v, MAX.note) || null;

/* One occurrence as the form describes it, or why it cannot be saved. */
function readChange(body) {
  const at = body.at ? String(body.at) : null;
  if (at !== null && !validTime(at)) return { error: "bad-time" };
  const map_url = body.map_url === undefined ? null : cleanUrl(body.map_url);
  if (map_url === null && body.map_url) return { error: "bad-url" };
  return {
    cancelled: body.cancelled ? 1 : 0,
    at: at,
    place_en: optionalPlace(body.place_en),
    place_ar: optionalPlace(body.place_ar),
    map_url: map_url,
    note_en: optionalNote(body.note_en),
    note_ar: optionalNote(body.note_ar),
  };
}

async function upsertChange(env, scheduleId, date, c) {
  await env.DB.prepare(
    "INSERT INTO schedule_changes (id, schedule_id, date, cancelled, at, place_en, place_ar, map_url, note_en, note_ar, created_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" +
      " ON CONFLICT(schedule_id, date) DO UPDATE SET cancelled = excluded.cancelled, at = excluded.at," +
      " place_en = excluded.place_en, place_ar = excluded.place_ar, map_url = excluded.map_url," +
      " note_en = excluded.note_en, note_ar = excluded.note_ar"
  )
    .bind(uid(), scheduleId, date, c.cancelled, c.at, c.place_en, c.place_ar, c.map_url, c.note_en, c.note_ar, nowISO())
    .run();
}

async function clearChange(env, scheduleId, date) {
  await env.DB.prepare("DELETE FROM schedule_changes WHERE schedule_id = ? AND date = ?")
    .bind(scheduleId, date)
    .run();
}

export async function adminScheduleChange(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessAdmin(request, env, body);
  if (no) return no;

  const scheduleId = String(body.schedule_id || "");
  const date = String(body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad-date" }, 400);

  const entry = await env.DB.prepare("SELECT * FROM schedule WHERE id = ?").bind(scheduleId).first();
  if (!entry) return json({ error: "no-entry" }, 404);

  const action = String(body.action || "set");
  if (action === "clear") {
    await clearChange(env, scheduleId, date);
    return json({ changes: await changesAround(env, date) });
  }
  if (action !== "set") return json({ error: "bad-request" }, 400);

  const change = readChange(body);
  if (change.error) return json({ error: change.error }, 400);
  await upsertChange(env, scheduleId, date, change);
  return json({ changes: await changesAround(env, date) });
}

/** Everything changed in the fortnight around a date — what the console shows. */
async function changesAround(env, date) {
  const from = new Date(Date.parse(date + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(date + "T00:00:00Z") + 21 * 86400000).toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    "SELECT c.*, s.title_en, s.title_ar FROM schedule_changes c JOIN schedule s ON s.id = c.schedule_id" +
      " WHERE c.date BETWEEN ? AND ? ORDER BY c.date ASC"
  )
    .bind(from, to)
    .all();
  return rows.results || [];
}
