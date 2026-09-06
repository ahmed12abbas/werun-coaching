/**
 * The coaches' own rota: who is taking which session this week.
 *
 *   node tools/dev.js            (in one terminal)
 *   node tools/smoke-rota.js     (in another)
 *
 * What is worth proving is the shape of the permission, not the SQL. A coach
 * may put themselves down and nobody else; every other coach sees the ticks;
 * a coach may take their own off and only an admin may take somebody else's;
 * and an athlete never sees any of it, on this route or on their week.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

let failures = 0;

/** Each identity keeps its own cookie, so four people can coexist. */
function who() {
  const it = { cookie: "" };
  it.call = async (method, path, body) => {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (it.cookie) headers.cookie = it.cookie;
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = /werun_s=([^;]*)/.exec(set);
      it.cookie = m && m[1] ? "werun_s=" + m[1] : "";
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    return { status: res.status, data };
  };
  return it;
}

function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || !detail ? "" : "  -> " + JSON.stringify(detail).slice(0, 240)));
  if (!ok) failures++;
}

const shift = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Friday is the club's rest day, so a test slot there disturbs nothing. */
function nextDate(weekday) {
  const d = new Date();
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const on = (rows, slot, date) =>
  (rows || []).filter((r) => r.schedule_id === slot && r.date === date).map((r) => r.user_id);

(async () => {
  const stamp = Date.now().toString(36);
  const pw = "correct-horse-" + stamp;
  const anon = who();
  const sara = who();
  const khalid = who();
  const athlete = who();

  const admin = (path, p) => anon.call("POST", path, Object.assign({ password: ADMIN }, p));

  let r = await anon.call("GET", "/api/health");
  if (!(r.data && r.data.db)) {
    console.log("No DB bound at " + BASE + " — nothing to test here.");
    process.exit(1);
  }
  if (!(r.data.table_names || []).includes("coach_rota")) {
    console.log("No coach_rota table at " + BASE + " — migration 0011 is not applied.");
    process.exit(1);
  }

  /* Two coaches and an athlete. */
  const make = async (it, name, email) => {
    const s = await it.call("POST", "/api/auth/signup", { name, email, password: pw });
    return s.data && s.data.user && s.data.user.id;
  };
  const saraId = await make(sara, "Sara", "sara+" + stamp + "@example.invalid");
  const khalidId = await make(khalid, "Khalid", "khalid+" + stamp + "@example.invalid");
  await make(athlete, "An Athlete", "athlete+" + stamp + "@example.invalid");
  await admin("/api/admin/members", { action: "role", id: saraId, role: "coach" });
  await admin("/api/admin/members", { action: "role", id: khalidId, role: "coach" });
  check("two coaches to put on a session", !!saraId && !!khalidId, { saraId, khalidId });

  /* A standing slot on the rest day, so nothing real is touched. */
  const day = 5;
  const date = nextDate(day);
  r = await admin("/api/admin/schedule", {
    action: "save",
    entry: {
      weekday: day, at: "06:00", active: 1, points: 10,
      title_en: "Rota test " + stamp, title_ar: "تجربة الجدول",
      place_en: "Wadi Hanifa Park", place_ar: "حديقة وادي حنيفة",
    },
  });
  const slot = (r.data.schedule || []).find((e) => e.title_en === "Rota test " + stamp);
  check("a slot to sign up for", r.status === 200 && !!slot, r.status);

  /* ---- the tick ---- */

  r = await athlete.call("POST", "/api/coach/rota", { action: "list" });
  check("an athlete cannot even read the rota", r.status === 401, r.status);

  r = await sara.call("POST", "/api/coach/rota", { action: "list" });
  check("a coach can", r.status === 200 && Array.isArray(r.data.rota), r.status);
  check("…and is told they may put themselves down", r.data.can_join === true, r.data);
  check("…but not take anybody else off", r.data.can_remove === false, r.data);
  check("…and which ticks would be theirs", r.data.me === saraId, r.data);

  r = await sara.call("POST", "/api/coach/rota", { action: "join", schedule_id: slot.id, date: date });
  check("a coach puts themselves down", r.status === 200 && on(r.data.rota, slot.id, date).includes(saraId), r.data);

  /* The primary key, not a check in the page: a cold morning is exactly when
     somebody taps twice. */
  r = await sara.call("POST", "/api/coach/rota", { action: "join", schedule_id: slot.id, date: date });
  check("…twice is the same as once", r.status === 200 && on(r.data.rota, slot.id, date).length === 1, r.data);

  r = await khalid.call("POST", "/api/coach/rota", { action: "join", schedule_id: slot.id, date: date });
  const both = on(r.data.rota, slot.id, date);
  check("a second coach joins the same session", r.status === 200 && both.length === 2, r.data);

  /* The whole point: everybody else can see who is on it. */
  r = await sara.call("POST", "/api/coach/rota", { action: "list" });
  check("…and the first one sees them", on(r.data.rota, slot.id, date).includes(khalidId), r.data);

  /* ---- what a tick is not ---- */

  r = await khalid.call("POST", "/api/coach/rota", {
    action: "leave", schedule_id: slot.id, date: date, user_id: saraId,
  });
  check("a coach cannot take another coach off", r.status === 403 && r.data.error === "not-admin", r);

  r = await sara.call("POST", "/api/coach/rota", { action: "join", schedule_id: slot.id, date: "2087-01-01" });
  check("nobody signs up for 2087", r.status === 400 && r.data.error === "bad-date", r);

  r = await sara.call("POST", "/api/coach/rota", { action: "join", schedule_id: "nothing-" + stamp, date: date });
  check("nor for a slot that is not there", r.status === 404 && r.data.error === "no-entry", r);

  r = await athlete.call("POST", "/api/coach/rota", { action: "join", schedule_id: slot.id, date: date });
  check("an athlete cannot put themselves down", r.status === 401, r.status);

  /* An admin who does not coach runs the club; they do not take sessions. */
  r = await anon.call("POST", "/api/coach/rota", { action: "join", password: ADMIN, schedule_id: slot.id, date: date });
  check("the club password cannot say who it is", r.status === 403 && r.data.error === "not-coach", r);
  r = await anon.call("POST", "/api/coach/rota", { action: "list", password: ADMIN });
  check("…but it can read the rota", r.status === 200, r.status);
  check("…and is nobody in particular", r.data.me === null && r.data.can_join === false, r.data);

  /* ---- taking a name off ---- */

  r = await khalid.call("POST", "/api/coach/rota", { action: "leave", schedule_id: slot.id, date: date });
  check("a coach takes their own tick off", r.status === 200 && !on(r.data.rota, slot.id, date).includes(khalidId), r.data);
  check("…and leaves the other one alone", on(r.data.rota, slot.id, date).includes(saraId), r.data);

  r = await anon.call("POST", "/api/coach/rota", {
    action: "leave", password: ADMIN, schedule_id: slot.id, date: date, user_id: saraId,
  });
  check("an admin takes somebody else off", r.status === 200 && !on(r.data.rota, slot.id, date).length, r.data);

  /* ---- and no athlete ever sees it ---- */

  await sara.call("POST", "/api/coach/rota", { action: "join", schedule_id: slot.id, date: date });
  r = await athlete.call("GET", "/api/week?start=" + shift(-7));
  const leaked = JSON.stringify(r.data || {}).includes(saraId);
  check("the rota does not reach an athlete's week", r.status === 200 && !leaked, r.status);

  /* Clean up: the slot, and the ticks that hang off it. */
  await anon.call("POST", "/api/coach/rota", {
    action: "leave", password: ADMIN, schedule_id: slot.id, date: date, user_id: saraId,
  });
  r = await admin("/api/admin/schedule", { action: "delete", id: slot.id });
  check("the slot can be removed", r.status === 200, r.status);

  console.log(failures ? "\n" + failures + " failure(s)." : "\nAll passed.");
  process.exit(failures ? 1 : 0);
})();
