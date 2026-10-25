/* The Pink Run/Walk, 26 Oct 2026: a head count for a free event open to
   anyone, so no account. In D1 rather than KV: the page shows how many places
   are left on every view, and the cap has to hold when the Instagram post
   sends a burst — one INSERT that checks the total and writes in the same
   statement does that; a KV list and a put cannot.

   Shut until an admin opens it (pink_open), so the page can be looked over
   live first: a logged-in admin sees the real form with a preview banner,
   everyone else a "opens soon". One row per phone, so registering twice
   updates the entry rather than taking two places. The cap counts people,
   friends included, since that is who turns up. */

import { json, readBody } from "../lib/http.js";
import { refuseUnlessAdmin, currentUser, isAdmin } from "../lib/auth.js";
import { tooOften, ipOf } from "../lib/limit.js";
import { getSetting } from "../lib/settings.js";
import { oneLine } from "./feedback.js";

const AGES = ["u18", "18-29", "30-39", "40-49", "50+"];
// The warm-up is 5:20; nobody is registering for it after it has finished.
const CLOSES = Date.parse("2026-10-26T09:00:00+03:00");

/* migrations/0037_pink.sql, run here too: migrations go in by hand and this
   has to work the night it deploys. Once per isolate. */
let ready = null;
const table = (db) =>
  (ready = ready || db.prepare(
    "CREATE TABLE IF NOT EXISTS pink_signups (phone TEXT PRIMARY KEY, name TEXT NOT NULL," +
      " email TEXT NOT NULL DEFAULT '', age TEXT NOT NULL, people INTEGER NOT NULL," +
      " first_time INTEGER NOT NULL DEFAULT 0," +
      " created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run().catch((e) => { ready = null; throw e; }));

/* Saudi numbers come as 05…, 5…, 9665… or +966 5…; all of them become
   9665…, so one person is one row however they typed it. */
export function normPhone(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = "966" + d.slice(1);
  else if (/^5\d{8}$/.test(d)) d = "966" + d;
  return /^\d{8,15}$/.test(d) ? d : "";
}

async function taken(db) {
  const row = await db.prepare("SELECT COALESCE(SUM(people), 0) AS n FROM pink_signups").first();
  return row ? row.n : 0;
}

/* Open to the public, or open to this visitor because they run the club. */
async function state(request, env) {
  const [open, cap] = await Promise.all([getSetting(env, "pink_open"), getSetting(env, "pink_cap")]);
  const preview = !open && isAdmin(await currentUser(request, env));
  return { open: !!open, cap: cap, preview: preview, closed: Date.now() > CLOSES };
}

/* ---------- GET /api/pink/status -------------------------------------------------- */

export async function pinkStatus(request, env) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  await table(env.DB);
  const s = await state(request, env);
  return json(Object.assign(s, { taken: await taken(env.DB) }));
}

/* ---------- POST /api/pink ------------------------------------------------- */

export async function pinkRegister(request, env) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  await table(env.DB);
  const s = await state(request, env);
  if (s.closed) return json({ error: "closed" }, 410);
  if (!s.open && !s.preview) return json({ error: "not-open" }, 403);

  const body = (await readBody(request)) || {};
  const name = oneLine(body.name, 60);
  const phone = normPhone(body.phone);
  const email = oneLine(body.email, 100);
  const age = AGES.includes(body.age) ? body.age : "";
  const people = Math.round(Number(body.people));
  // First time running with the club: yes or no, and nothing else.
  const first = body.first === "yes" ? 1 : body.first === "no" ? 0 : -1;
  if (!name) return json({ error: "bad-name" }, 400);
  if (!phone) return json({ error: "bad-phone" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "bad-email" }, 400);
  if (!age) return json({ error: "bad-age" }, 400);
  if (!(people >= 1 && people <= 10)) return json({ error: "bad-people" }, 400);
  if (first < 0) return json({ error: "bad-first" }, 400);

  if (await tooOften(env.DB, "pink", ipOf(request), 6, 60)) return json({ error: "too-often" }, 429);

  // Their own earlier entry does not count against them: changing 3 to 2
  // must work on the last places.
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    "INSERT INTO pink_signups (phone, name, email, age, people, first_time, created_at, updated_at)" +
      " SELECT ?1, ?2, ?3, ?4, ?5, ?8, ?6, ?6" +
      " WHERE (SELECT COALESCE(SUM(people), 0) FROM pink_signups WHERE phone <> ?1) + ?5 <= ?7" +
      " ON CONFLICT(phone) DO UPDATE SET name = excluded.name, email = excluded.email, age = excluded.age," +
      " people = excluded.people, first_time = excluded.first_time, updated_at = excluded.updated_at"
  ).bind(phone, name, email, age, people, now, s.cap, first).run();

  const n = await taken(env.DB);
  if (!res.meta.changes) return json({ error: "full", taken: n, cap: s.cap }, 409);
  return json({ ok: true, taken: n, cap: s.cap });
}

/* ---------- POST /api/admin/pink ------------------------------------------ */

/* Who is coming, and taking one entry off. The switch and the cap are
   settings, saved through /api/admin/settings like every other. */
export async function adminPink(request, env) {
  const body = (await readBody(request)) || {};
  const no = await refuseUnlessAdmin(request, env, body);
  if (no) return no;
  await table(env.DB);

  const gone = normPhone(body.remove);
  if (gone) await env.DB.prepare("DELETE FROM pink_signups WHERE phone = ?").bind(gone).run();

  const rows = await env.DB.prepare(
    "SELECT phone AS p, name AS n, email AS e, age AS a, people AS c, first_time AS f, created_at AS at" +
      " FROM pink_signups ORDER BY created_at DESC LIMIT 1000"
  ).all();
  const [open, cap] = await Promise.all([getSetting(env, "pink_open"), getSetting(env, "pink_cap")]);
  return json({ items: rows.results || [], open: !!open, cap: cap });
}
