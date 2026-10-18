/* The club's next four weeks as a calendar feed, for the phone's own calendar
   app — which is how the week reaches every watch, Apple's included: the
   watch shows what the phone's calendar has.

   A calendar app polls a URL and sends no cookie, so the link carries who it
   is for and an HMAC over that under QR_SECRET. Nothing is stored and nothing
   needs a migration; the price is that a link cannot be revoked short of
   rotating the secret, which is fine for a feed of times and meeting points
   that every member can already read. The user is still looked up, so a
   blocked account's feed stops. */

import { json } from "../lib/http.js";
import { withMember } from "../lib/auth.js";
import { safeEqual } from "../lib/crypto.js";
import { tooOften } from "../lib/limit.js";
import { signSlot } from "../lib/checkin.js";
import { loadWeek, buildDays } from "../lib/weekplan.js";
import { shiftDay } from "../lib/week.js";

const DAYS_BACK = 7; // last week stays, so a run just done does not vanish
const DAYS_AHEAD = 28;
const HOUR_MS = 3600 * 1000;

const sigFor = (env, userId) => signSlot(env.QR_SECRET, "cal", userId);

/* ---------- POST /api/calendar — this athlete's feed link ------------------ */

export const calendarLink = withMember(async (request, env, user) => {
  if (!env.QR_SECRET) return json({ error: "calendar-off" }, 503);
  const q = new URLSearchParams({ u: user.id, s: await sigFor(env, user.id) });
  return json({ url: new URL(request.url).origin + "/api/calendar.ics?" + q.toString() });
});

/* ---------- GET /api/calendar.ics?u=&s=&lang= ----------------------------- */

export async function calendarFeed(request, env) {
  if (!env.DB || !env.QR_SECRET) return new Response("calendar-off", { status: 503 });
  const url = new URL(request.url);
  const userId = url.searchParams.get("u") || "";
  const sig = url.searchParams.get("s") || "";
  if (!userId || !(await safeEqual(sig, await sigFor(env, userId)))) return new Response("Not found", { status: 404 });
  // Calendar apps poll every few minutes at most; this is somebody leaning on it.
  if (await tooOften(env.DB, "cal", userId, 20, 60)) return new Response("too-often", { status: 429 });

  const user = await env.DB.prepare("SELECT id, status FROM users WHERE id = ?").bind(userId).first();
  if (!user || user.status === "blocked") return new Response("Not found", { status: 404 });

  // Riyadh's today, not the Worker's: the club is UTC+3 all year.
  const today = new Date(Date.now() + 3 * HOUR_MS).toISOString().slice(0, 10);
  const dates = [];
  for (let i = -DAYS_BACK; i <= DAYS_AHEAD; i++) dates.push(shiftDay(today, i));
  const days = buildDays(dates, await loadWeek(env, dates[0], dates[dates.length - 1], userId, false));

  const ar = url.searchParams.get("lang") === "ar";
  return new Response(icsFor(days, ar), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="werun.ics"',
      "cache-control": "private, max-age=900",
    },
  });
}

/* ---------- the file ------------------------------------------------------- */

const pick = (it, f, ar) => (ar && it[f + "_ar"]) || it[f + "_en"] || "";
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/* RFC 5545 wants lines of 75 octets at most, and Arabic is two octets a letter. */
function fold(line) {
  const bytes = (c) => new TextEncoder().encode(c).length;
  let out = "";
  let n = 0;
  for (const c of line) {
    if (n + bytes(c) > 74) {
      out += "\r\n ";
      n = 1;
    }
    out += c;
    n += bytes(c);
  }
  return out;
}

/* A standing slot is a wall-clock time in Riyadh; a published one an instant. */
const startOf = (date, it) =>
  it.kind === "session" && it.starts_at ? Date.parse(it.starts_at) : Date.parse(date + "T" + it.at + ":00+03:00");

// ponytail: every session is an hour long; add a duration to the slot if athletes ask.
function eventLines(date, it, ar, now) {
  const start = startOf(date, it);
  if (!Number.isFinite(start)) return [];
  const title = pick(it, "title", ar);
  const desc = pick(it, "desc", ar);
  const note = pick(it, "note", ar);
  const lines = [
    "BEGIN:VEVENT",
    // The slot and date, not the session id: when a workout is published into
    // a slot the calendar should update that event, not add a second one.
    "UID:" + (it.schedule_id || it.id) + "-" + date + "@weruncoaching",
    "DTSTAMP:" + stamp(now),
    "DTSTART:" + stamp(start),
    "DTEND:" + stamp(start + HOUR_MS),
    "SUMMARY:" + esc(desc ? title + " — " + desc : title),
  ];
  const place = pick(it, "place", ar);
  if (place) lines.push("LOCATION:" + esc(place));
  const body = [note, it.coach, it.map_url].filter(Boolean).join("\n");
  if (body) lines.push("DESCRIPTION:" + esc(body));
  if (it.map_url) lines.push("URL:" + it.map_url);
  lines.push("END:VEVENT");
  return lines;
}

export function icsFor(days, ar) {
  const now = Date.now();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WE RUN Coaching//Week//EN", "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:WE RUN", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const d of days) {
    for (const it of d.items) if (!it.cancelled) lines.push(...eventLines(d.date, it, ar, now));
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
