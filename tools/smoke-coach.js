/**
 * Who is taking the session: the coaches list, and a coach put on one.
 *
 *   node tools/dev.js              (in one terminal)
 *   node tools/smoke-coach.js      (in another)
 *
 * Two things are worth proving. That /api/admin/coaches is the same `role`
 * column the members table toggles, read the other way round — promote
 * somebody in one and the other agrees. And that a name reaches the athlete
 * by all three routes it can travel: set on the standing slot, inherited by a
 * session opened for its code, and overridden by the publish form.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

let failures = 0;

/** Each identity keeps its own cookie, so a coach and an athlete can coexist. */
function who() {
  const it = { cookie: "" };
  it.call = async (method, path, body) => {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (it.cookie) headers.cookie = it.cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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

/** The next date a given weekday falls on. */
function nextDate(weekday) {
  const d = new Date();
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

(async () => {
  const stamp = Date.now().toString(36);
  const pw = "correct-horse-" + stamp;
  const anon = who();
  const coach = who();
  const athlete = who();

  const admin = (path, p) => anon.call("POST", path, Object.assign({ password: ADMIN }, p));

  let r = await anon.call("GET", "/api/health");
  if (!(r.data && r.data.db)) {
    console.log("No DB bound at " + BASE + " — nothing to test here.");
    process.exit(1);
  }

  /* ---- the coaches list ---- */
  r = await anon.call("POST", "/api/admin/coaches", { action: "list" });
  check("the coaches list needs the coach", r.status === 401, r.status);

  const coachEmail = "coach+" + stamp + "@example.invalid";
  r = await coach.call("POST", "/api/auth/signup", { name: "Coach " + stamp, email: coachEmail, password: pw });
  const coachId = r.data && r.data.user && r.data.user.id;
  check("a member signs up", !!coachId, r);

  await athlete.call("POST", "/api/auth/signup", {
    name: "Athlete " + stamp, email: "run+" + stamp + "@example.invalid", password: pw,
  });

  r = await admin("/api/admin/coaches", { action: "list" });
  check("a member is not yet a coach", r.status === 200 && !(r.data.coaches || []).some((c) => c.id === coachId), r.status);
  check("…but is offered as one who could be", (r.data.candidates || []).some((c) => c.id === coachId), r.status);

  r = await admin("/api/admin/coaches", { action: "add", id: coachId });
  check("adding makes them a coach", r.status === 200 && (r.data.coaches || []).some((c) => c.id === coachId), r);
  check("…and drops them from the candidates", !(r.data.candidates || []).some((c) => c.id === coachId), r.status);

  // The same column, read the other way round: the two screens must agree.
  r = await admin("/api/admin/members", {});
  check("the members table agrees", (r.data.members || []).find((m) => m.id === coachId).role === "coach", r.status);

  r = await admin("/api/admin/coaches", { action: "add", id: "nobody-" + stamp });
  check("promoting a stranger is refused", r.status === 404 && r.data.error === "no-member", r);
  r = await admin("/api/admin/coaches", { action: "sack", id: coachId });
  check("a verb that is not a verb is refused", r.status === 400, r);

  // A coach signing themselves out of the console by mis-tap: the club
  // password is the way back, but the screen they are standing on is not.
  r = await coach.call("POST", "/api/auth/login", { email: coachEmail, password: pw });
  check("the coach's own login works", r.status === 200, r.status);
  r = await coach.call("POST", "/api/admin/coaches", { action: "remove", id: coachId });
  check("a coach cannot take themselves off", r.status === 409 && r.data.error === "not-yourself", r);

  /* ---- on a standing slot ---- */

  /* Friday is the club's rest day, so a test entry there disturbs nothing. */
  const day = 5;
  const date = nextDate(day);
  const plan = (p) => admin("/api/admin/schedule", p);

  r = await plan({
    action: "save",
    entry: {
      weekday: day, at: "06:00", active: 1, points: 10,
      title_en: "Coach test " + stamp, title_ar: "تجربة المدرب",
      place_en: "Wadi Hanifa Park", place_ar: "حديقة وادي حنيفة",
      coach_id: coachId,
    },
  });
  const slot = (r.data.schedule || []).find((e) => e.title_en === "Coach test " + stamp);
  check("a slot saves with a coach on it", r.status === 200 && !!slot, r.status);
  check("…and the console gets the names to draw the picker", (r.data.coaches || []).some((c) => c.id === coachId), r.status);
  check("…and the slot keeps the id", slot && slot.coach_id === coachId, slot);

  r = await athlete.call("GET", "/api/week?start=" + date);
  const dayOf = (data) => (data.days || []).find((d) => d.date === date);
  let item = (dayOf(r.data).items || []).find((i) => i.id === slot.id);
  check("the club sees who is taking it", item && item.coach === "Coach " + stamp, item);

  r = await plan({ action: "save", entry: Object.assign({}, slot, { coach_id: "" }) });
  r = await athlete.call("GET", "/api/week?start=" + date);
  item = (dayOf(r.data).items || []).find((i) => i.id === slot.id);
  check("clearing it says nothing rather than the old name", item && !item.coach, item);

  r = await plan({ action: "save", entry: Object.assign({}, slot, { coach_id: coachId }) });

  /* ---- a session opened for its code inherits the slot's coach ---- */
  r = await admin("/api/admin/sessions", { action: "open", schedule_id: slot.id, date: date });
  const opened = r.data && r.data.session;
  check("a session opens for the code", r.status === 200 && !!opened, r);
  check("…carrying the slot's coach", opened && opened.coach_id === coachId, opened);

  r = await athlete.call("GET", "/api/session?id=" + opened.id);
  check("the athlete sees the name on it", r.data.session && r.data.session.coach === "Coach " + stamp, r.data.session);

  r = await admin("/api/admin/sessions", { action: "delete", id: opened.id });
  check("the opened session clears away", r.status === 200, r.status);

  /* ---- publishing says who took it, and wins over the slot ---- */
  const other = who();
  r = await other.call("POST", "/api/auth/signup", {
    name: "Stand-in " + stamp, email: "standin+" + stamp + "@example.invalid", password: pw,
  });
  const otherId = r.data.user.id;
  await admin("/api/admin/coaches", { action: "add", id: otherId });

  r = await admin("/api/admin/sessions", {
    action: "publish",
    name: "Coach test workout " + stamp,
    payload: "1.Coach test|1|300|0|0",
    date: date,
    starts_at: new Date(date + "T06:00:00+03:00").toISOString(),
    schedule_id: slot.id,
    coach_id: otherId,
  });
  const published = (r.data.sessions || []).find((x) => x.name === "Coach test workout " + stamp);
  check("a workout publishes against the slot", r.status === 200 && !!published, r.status);

  r = await athlete.call("GET", "/api/week?start=" + date);
  item = (dayOf(r.data).items || []).find((i) => i.id === published.id);
  check("the published session shows as the workout", item && item.kind === "session", item);
  check("…under whoever actually took it", item && item.coach === "Stand-in " + stamp, item);

  r = await athlete.call("GET", "/api/session?id=" + published.id);
  check("and the session itself says the same", r.data.session && r.data.session.coach === "Stand-in " + stamp, r.data.session);

  // Left blank, a published session falls back to whoever has the slot.
  r = await admin("/api/admin/sessions", {
    action: "publish",
    name: "Coach test fallback " + stamp,
    payload: "1.Coach test|1|300|0|0",
    date: date,
    starts_at: new Date(date + "T06:30:00+03:00").toISOString(),
    schedule_id: slot.id,
  });
  const fallback = (r.data.sessions || []).find((x) => x.name === "Coach test fallback " + stamp);
  r = await athlete.call("GET", "/api/session?id=" + fallback.id);
  check("a blank coach falls back to the slot's", r.data.session && r.data.session.coach === "Coach " + stamp, r.data.session);

  // A coach who stops coaching leaves an id matching nobody, which reads as
  // "not said" rather than as a name the club can no longer explain.
  await admin("/api/admin/coaches", { action: "remove", id: otherId });
  r = await athlete.call("GET", "/api/session?id=" + published.id);
  check("a coach taken off the list stops being named", r.data.session && !r.data.session.coach, r.data.session);

  /* ---- clearing up ---- */
  await admin("/api/admin/sessions", { action: "delete", id: published.id });
  await admin("/api/admin/sessions", { action: "delete", id: fallback.id });
  r = await plan({ action: "delete", id: slot.id });
  check("the slot can be removed", r.status === 200, r.status);
  r = await admin("/api/admin/coaches", { action: "remove", id: coachId });
  check("and a coach can be taken off by somebody else", r.status === 200 && !(r.data.coaches || []).some((c) => c.id === coachId), r.status);

  console.log(failures ? "\n" + failures + " failure(s)." : "\nAll passed.");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("smoke-coach: " + (e.stack || e));
  process.exit(1);
});
