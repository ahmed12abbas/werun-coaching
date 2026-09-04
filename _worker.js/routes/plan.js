/* The coach editing the standing week, and calling one session off. */

import { json, readBody } from "../lib/http.js";
import { uid, nowISO, refuseUnlessCoach } from "../lib/auth.js";
import { validTime } from "../lib/weekplan.js";

const MAX = { title: 80, place: 100, url: 300, note: 200 };
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

export async function adminSchedule(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  const action = String(body.action || "list");

  if (action === "save") {
    const e = body.entry && typeof body.entry === "object" ? body.entry : {};
    const title_en = clean(e.title_en, MAX.title);
    const title_ar = clean(e.title_ar, MAX.title);
    if (!title_en && !title_ar) return json({ error: "bad-title" }, 400);

    const weekday = Math.round(Number(e.weekday));
    if (!(weekday >= 0 && weekday <= 6)) return json({ error: "bad-day" }, 400);
    if (!validTime(e.at)) return json({ error: "bad-time" }, 400);

    const map_url = cleanUrl(e.map_url);
    if (map_url === null) return json({ error: "bad-url" }, 400);

    const points = Number.isFinite(Number(e.points))
      ? Math.max(0, Math.min(1000, Math.round(Number(e.points))))
      : 10;

    const fields = [
      weekday, String(e.at), title_en, title_ar,
      clean(e.place_en, MAX.place), clean(e.place_ar, MAX.place),
      map_url, points, e.active ? 1 : 0,
    ];
    const id = /^[A-Za-z0-9_-]{1,64}$/.test(String(e.id || "")) ? String(e.id) : null;
    const now = nowISO();

    if (id) {
      const before = await env.DB.prepare("SELECT id FROM schedule WHERE id = ?").bind(id).first();
      if (!before) return json({ error: "no-entry" }, 404);
      await env.DB.prepare(
        "UPDATE schedule SET weekday = ?, at = ?, title_en = ?, title_ar = ?, place_en = ?," +
          " place_ar = ?, map_url = ?, points = ?, active = ?, updated_at = ? WHERE id = ?"
      )
        .bind(...fields, now, id)
        .run();
    } else {
      await env.DB.prepare(
        "INSERT INTO schedule (id, weekday, at, title_en, title_ar, place_en, place_ar, map_url, points, active, created_at, updated_at)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(uid(), ...fields, now, now)
        .run();
    }
    return json({ schedule: await list(env) });
  }

  if (action === "delete") {
    // Changes recorded against it go with it, which is right: they described
    // an occurrence of something that no longer happens.
    await env.DB.prepare("DELETE FROM schedule WHERE id = ?").bind(String(body.id || "")).run();
    return json({ schedule: await list(env) });
  }

  if (action !== "list") return json({ error: "bad-request" }, 400);
  // The upcoming changes ride along: the console needs both to draw the card,
  // and a second request to learn "nothing has moved" is a wasted one.
  return json({ schedule: await list(env), changes: await changesAround(env, nowISO().slice(0, 10)) });
}

/* ---------- POST /api/admin/schedule-change -------------------------------
   Moving or calling off one occurrence, and putting it back.
   ------------------------------------------------------------------------- */

export async function adminScheduleChange(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  const scheduleId = String(body.schedule_id || "");
  const date = String(body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad-date" }, 400);

  const entry = await env.DB.prepare("SELECT * FROM schedule WHERE id = ?").bind(scheduleId).first();
  if (!entry) return json({ error: "no-entry" }, 404);

  const action = String(body.action || "set");

  if (action === "clear") {
    await env.DB.prepare("DELETE FROM schedule_changes WHERE schedule_id = ? AND date = ?")
      .bind(scheduleId, date)
      .run();
    return json({ changes: await changesAround(env, date) });
  }

  if (action !== "set") return json({ error: "bad-request" }, 400);

  const at = body.at ? String(body.at) : null;
  if (at !== null && !validTime(at)) return json({ error: "bad-time" }, 400);
  const map_url = body.map_url === undefined ? null : cleanUrl(body.map_url);
  if (map_url === null && body.map_url) return json({ error: "bad-url" }, 400);

  await env.DB.prepare(
    "INSERT INTO schedule_changes (id, schedule_id, date, cancelled, at, place_en, place_ar, map_url, note_en, note_ar, created_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" +
      " ON CONFLICT(schedule_id, date) DO UPDATE SET cancelled = excluded.cancelled, at = excluded.at," +
      " place_en = excluded.place_en, place_ar = excluded.place_ar, map_url = excluded.map_url," +
      " note_en = excluded.note_en, note_ar = excluded.note_ar"
  )
    .bind(
      uid(), scheduleId, date, body.cancelled ? 1 : 0, at,
      body.place_en === undefined ? null : clean(body.place_en, MAX.place),
      body.place_ar === undefined ? null : clean(body.place_ar, MAX.place),
      map_url,
      clean(body.note_en, MAX.note) || null,
      clean(body.note_ar, MAX.note) || null,
      nowISO()
    )
    .run();

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
