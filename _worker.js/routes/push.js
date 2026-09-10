/* The reminder, an hour before the session.

   Three parties: the browser, which subscribes and stores an endpoint here;
   the sender, which the scheduled job outside pokes every quarter of an hour
   and which knocks on the endpoints of everybody down for a session that is
   about to start; and the service worker, which answers the knock by asking
   /api/push/next what to say. Nothing about the session travels over the
   push service at all — see lib/push.js.

   Who gets one: whoever put their name down. A signup is the athlete saying
   they mean to be there, which is exactly the list worth interrupting; the
   whole club at 03:55 is a notification people turn off for good.

   The tables arrive after the code that reads them, as everything does here,
   so every read is wrapped and answers "off" rather than 500. */

import { json, readBody } from "../lib/http.js";
import { withMember, nowISO, uid } from "../lib/auth.js";
import { safeEqual } from "../lib/crypto.js";
import { pushReady, pushTo } from "../lib/push.js";

const CLUB_OFFSET = "+03:00";
const MAX_ENDPOINT = 600;
const LIST = 500;

/* How far ahead a reminder goes out. The scheduled job runs every quarter of
   an hour and is not punctual, so the mouth of the window is wider than the
   gap between runs; push_sent is what keeps a session to one buzz however
   many times the job sees it. */
const SOON_FROM = 40 * 60000;
const SOON_TO = 80 * 60000;

/* The club's own day, whatever the server thinks the date is. */
const clubDate = (shiftDays) =>
  new Date(Date.now() + 3 * 3600000 + (shiftDays || 0) * 86400000).toISOString().slice(0, 10);

const startsAt = (date, at) => new Date(date + "T" + at + ":00" + CLUB_OFFSET).getTime();

/**
 * Everybody down for a session on these dates, with the time it starts —
 * the pattern's, or the one a change moved this occurrence to, and never a
 * session that was called off.
 */
async function signupsOn(env, dates) {
  const rows = await env.DB.prepare(
    "SELECT g.user_id, g.schedule_id, g.date, s.title_en, s.title_ar, s.place_en, s.place_ar," +
      " COALESCE(c.at, s.at) AS at, COALESCE(c.cancelled, 0) AS called_off" +
      " FROM session_signups g JOIN schedule s ON s.id = g.schedule_id" +
      " LEFT JOIN schedule_changes c ON c.schedule_id = g.schedule_id AND c.date = g.date" +
      " WHERE g.date IN (" + dates.map(() => "?").join(", ") + ") LIMIT ?"
  )
    .bind(...dates, LIST)
    .all();
  return (rows.results || []).filter((r) => !r.called_off);
}

/* ---------- POST /api/push ------------------------------------------------ */

export async function push(request, env) {
  const body = await readBody(request);
  const action = String(body.action || "key");

  // The sender is not an athlete and carries no cookie: it is the scheduled
  // job outside, and the shared secret is the whole of what it is.
  if (action === "run") return run(env, body);

  if (!env.DB) return json({ error: "push-off" }, 503);
  if (!pushReady(env)) return json({ error: "push-off" }, 503);

  return withMember(async (req, e, user) => {
    if (action === "key") return json({ key: e.VAPID_PUBLIC });

    const endpoint = String(body.endpoint || "");
    if (!goodEndpoint(endpoint)) return json({ error: "bad-endpoint" }, 400);
    const change = SUB_ACTIONS.get(action);
    if (!change) return json({ error: "bad-request" }, 400);

    try {
      return await change(e, user, endpoint);
    } catch (err) {
      console.error("push: no push_subs yet (" + (err && err.message) + ")");
      return json({ error: "push-off" }, 503);
    }
  })(request, env);
}

const goodEndpoint = (s) => /^https:\/\//.test(s) && s.length <= MAX_ENDPOINT;

/* One row per browser: the endpoint is unique, so a phone that comes back
   after a reinstall replaces its own row rather than collecting. */
async function subscribe(env, user, endpoint) {
  await env.DB.prepare(
    "INSERT INTO push_subs (id, user_id, endpoint, at) VALUES (?, ?, ?, ?)" +
      " ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, at = excluded.at"
  )
    .bind(uid(), user.id, endpoint, nowISO())
    .run();
  return json({ on: true });
}

/* Their own row only: an endpoint is a browser, and taking somebody else's
   off would be silencing them. */
async function unsubscribe(env, user, endpoint) {
  await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?")
    .bind(endpoint, user.id)
    .run();
  return json({ on: false });
}

const SUB_ACTIONS = new Map([["subscribe", subscribe], ["unsubscribe", unsubscribe]]);

/* ---------- GET /api/push/next -------------------------------------------- */

/*
 * What the notification should say, asked for by the service worker at the
 * moment it shows it. Their own next session and nobody else's, in their own
 * language, and nothing at all if there isn't one — a knock that arrives
 * after the session was called off says so by having nothing to say.
 */
export const pushNext = withMember(async (request, env, user) => {
  let rows = [];
  try {
    rows = await signupsOn(env, [clubDate(0), clubDate(1)]);
  } catch (e) {
    return json({ session: null });
  }
  const next = nextFor(rows, user.id, Date.now());
  if (!next) return json({ session: null });
  return json({ session: reminderText(next, user.lang === "ar") });
});

/* Their own soonest session still to come, or started within the last
   quarter hour: a reminder that arrives a little late is still the one they
   asked for. */
function nextFor(rows, userId, now) {
  return rows
    .filter((r) => r.user_id === userId)
    .map((r) => Object.assign({}, r, { when: startsAt(r.date, r.at) }))
    .filter((r) => r.when > now - 15 * 60000 && r.when < now + 3 * 3600000)
    .sort((a, b) => a.when - b.when)[0];
}

/* The reader's language when the slot has it, English when it does not. */
const inLang = (row, key, ar) => (ar ? row[key + "_ar"] : row[key + "_en"]) || row[key + "_en"];

/* What the notification says, written at the moment it is shown. */
function reminderText(next, ar) {
  const at = new Date(next.when).toLocaleTimeString(ar ? "ar" : "en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
  });
  const place = inLang(next, "place", ar) || "";
  return {
    title: inLang(next, "title", ar) || "WE RUN",
    body: (ar ? "الساعة " + at : at) + (place ? " · " + place : ""),
    url: "/app#/home",
  };
}

/* ---------- the sender ---------------------------------------------------- */

/*
 * Poked from outside on a schedule (see .github/workflows/remind.yml), with
 * the shared secret in the body — never in the URL, like every other password
 * here. It answers what it did, so a failing run is visible in the job log
 * rather than only in the absence of buzzing phones.
 */
async function senderRefusal(env, body) {
  if (!env.PUSH_SECRET) return json({ error: "push-off" }, 503);
  if (!(await safeEqual(String(body.secret || ""), env.PUSH_SECRET))) {
    return json({ error: "bad-password" }, 401);
  }
  if (!pushReady(env) || !env.DB) return json({ error: "push-off" }, 503);
  return null;
}

const dueSoon = (rows, now) =>
  rows.filter((r) => {
    const when = startsAt(r.date, r.at);
    return when > now + SOON_FROM && when < now + SOON_TO;
  });

/* The primary key is the guard: an insert that changes nothing means this
   athlete has already been told about this session. True if this is the
   first time. */
async function markSent(env, row) {
  const mark = await env.DB.prepare(
    "INSERT OR IGNORE INTO push_sent (ref, kind, user_id, at) VALUES (?, 'soon', ?, ?)"
  )
    .bind(row.schedule_id + "|" + row.date, row.user_id, nowISO())
    .run();
  return !!(mark.meta && mark.meta.changes);
}

/* One browser: "sent", "dropped", or null for a knock that went nowhere. */
async function knock(env, sub) {
  let status;
  try {
    status = await pushTo(env, sub.endpoint);
  } catch (e) {
    console.error("push: send failed (" + (e && e.message) + ")");
    return null;
  }
  // Gone means gone: the browser was wiped or has revoked us, and a row kept
  // after that is a knock into the dark on every run from now on.
  if (status === 404 || status === 410) {
    await env.DB.prepare("DELETE FROM push_subs WHERE id = ?").bind(sub.id).run();
    return "dropped";
  }
  return status >= 200 && status < 300 ? "sent" : null;
}

async function knockAll(env, userId, tally) {
  const subs = await env.DB.prepare("SELECT id, endpoint FROM push_subs WHERE user_id = ?")
    .bind(userId)
    .all();
  for (const sub of subs.results || []) {
    const outcome = await knock(env, sub);
    if (outcome) tally[outcome]++;
  }
}

async function run(env, body) {
  const no = await senderRefusal(env, body);
  if (no) return no;

  let rows;
  try {
    rows = await signupsOn(env, [clubDate(0), clubDate(1)]);
  } catch (e) {
    console.error("push: could not read signups (" + (e && e.message) + ")");
    return json({ error: "no-table" }, 503);
  }

  const due = dueSoon(rows, Date.now());
  const tally = { due: due.length, sent: 0, dropped: 0 };
  for (const row of due) {
    let first;
    try {
      first = await markSent(env, row);
    } catch (e) {
      console.error("push: could not write push_sent (" + (e && e.message) + ")");
      return json({ error: "no-table" }, 503);
    }
    if (first) await knockAll(env, row.user_id, tally);
  }
  return json(tally);
}
