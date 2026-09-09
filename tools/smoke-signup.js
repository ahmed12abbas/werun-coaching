/**
 * Putting your name down for a session, and the goal the home screen counts
 * against.
 *
 *   node tools/dev.js              (in one terminal)
 *   node tools/smoke-signup.js     (in another)
 *
 * What is worth proving is not the SQL but the shape: a signup is the
 * athlete's own, it reaches their week and nobody else's, tapping twice is
 * the same as tapping once, and the goal is a number the Worker checks rather
 * than whatever the form sent.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

let failures = 0;

/** Each identity keeps its own cookie, so two athletes can coexist. */
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

const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

/* A payload the real encoder produced, so publish has something to accept —
   the same one tools/smoke-checkin.js uses. Nothing here decodes it. */
const PAYLOAD =
  "1.gzjGNz8P0y0QE2AmI9tvaKqQm5mnBDMMpgQk5ejkDA1KBW2F4pKizJTUYrBCoHsNjZBcDHGsKcxIB1MFb3BYI5laDNIClc_KT9cvT8zJVoK73Bify2Ih0Q6PXqVaAA";

/** Friday is the club's rest day, so a test slot there disturbs nothing. */
function nextDate(weekday) {
  const d = new Date();
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return iso(d);
}

/** The Sunday the club's week starts on, for the date given. */
function weekStart(date) {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() - d.getDay());
  return iso(d);
}

/** That slot on that date, as the athlete's own week hands it over. */
async function itemOn(athlete, slotId, date) {
  const r = await athlete.call("GET", "/api/week?start=" + weekStart(date));
  const day = ((r.data && r.data.days) || []).find((d) => d.date === date);
  return day && (day.items || []).find((i) => i.schedule_id === slotId);
}

(async () => {
  const stamp = Date.now().toString(36);
  const pw = "correct-horse-" + stamp;
  const anon = who();
  const amal = who();
  const omar = who();

  const admin = (path, p) => anon.call("POST", path, Object.assign({ password: ADMIN }, p));

  let r = await anon.call("GET", "/api/health");
  if (!(r.data && r.data.db)) {
    console.log("No DB bound at " + BASE + " — nothing to test here.");
    process.exit(1);
  }
  if (!(r.data.table_names || []).includes("session_signups")) {
    console.log("No session_signups table at " + BASE + " — migration 0012 is not applied.");
    process.exit(1);
  }

  /* Two athletes, and a standing slot on the rest day. */
  const make = async (it, name, email) => {
    const s = await it.call("POST", "/api/auth/signup", { name, email, password: pw });
    return s.data && s.data.user;
  };
  const amalUser = await make(amal, "Amal", "amal+" + stamp + "@example.invalid");
  await make(omar, "Omar", "omar+" + stamp + "@example.invalid");
  check("two athletes", !!amalUser, amalUser);
  check("…and a goal to start from", amalUser && amalUser.week_goal === 3, amalUser);

  const day = 5;
  const date = nextDate(day);
  r = await admin("/api/admin/schedule", {
    action: "save",
    entry: {
      weekday: day, at: "06:00", active: 1, points: 10,
      title_en: "Signup test " + stamp, title_ar: "تجربة التسجيل",
      place_en: "Wadi Hanifa Park", place_ar: "حديقة وادي حنيفة",
    },
  });
  const slot = (r.data.schedule || []).find((e) => e.title_en === "Signup test " + stamp);
  check("a slot to sign up for", r.status === 200 && !!slot, r.status);

  /* ---- putting a name down ---- */

  let item = await itemOn(amal, slot.id, date);
  check("the week starts with nobody down", !!item && item.registered === false, item);

  r = await amal.call("POST", "/api/signups", { action: "join", schedule_id: slot.id, date: date });
  check("an athlete puts their name down", r.status === 200 && r.data.registered === true, r);

  item = await itemOn(amal, slot.id, date);
  check("…and their own week says so", !!item && item.registered === true, item);

  r = await amal.call("POST", "/api/signups", { action: "join", schedule_id: slot.id, date: date });
  item = await itemOn(amal, slot.id, date);
  check("…twice is the same as once", r.status === 200 && item.registered === true, r);

  /* The whole point of it being their own: nobody else is put down by it. */
  item = await itemOn(omar, slot.id, date);
  check("nobody else is signed up by it", !!item && item.registered === false, item);

  /* ---- what a signup is not ---- */

  r = await amal.call("POST", "/api/signups", { action: "join", schedule_id: slot.id, date: "2087-01-01" });
  check("nobody signs up for 2087", r.status === 400 && r.data.error === "bad-date", r);

  r = await amal.call("POST", "/api/signups", { action: "join", schedule_id: "nothing-" + stamp, date: date });
  check("nor for a slot that is not there", r.status === 404 && r.data.error === "no-entry", r);

  r = await anon.call("POST", "/api/signups", { action: "join", schedule_id: slot.id, date: date });
  check("nor without logging in", r.status === 401, r.status);

  /* ---- taking it off again ---- */

  r = await amal.call("POST", "/api/signups", { action: "leave", schedule_id: slot.id, date: date });
  item = await itemOn(amal, slot.id, date);
  check("a name comes off again", r.status === 200 && item.registered === false, r);

  /* ---- the goal ---- */

  r = await amal.call("POST", "/api/auth/profile", { name: "Amal", week_goal: 5 });
  check("the goal saves", r.status === 200 && r.data.user.week_goal === 5, r.data);

  r = await amal.call("GET", "/api/auth/me");
  check("…and comes back", r.data.user.week_goal === 5, r.data.user);

  r = await amal.call("POST", "/api/auth/profile", { name: "Amal", week_goal: 99 });
  check("a goal of 99 is refused", r.status === 400 && r.data.error === "bad-goal", r);

  r = await amal.call("POST", "/api/auth/profile", { name: "Amal" });
  check("…and a save that never mentions it leaves it alone", r.data.user.week_goal === 5, r.data.user);

  /* ---- the bio ---- */

  r = await amal.call("POST", "/api/auth/profile", { name: "Amal", bio: "  Marathon in\n  March.  " });
  check("a bio saves, squeezed onto one line", r.data.user.bio === "Marathon in March.", r.data.user);

  r = await amal.call("POST", "/api/auth/profile", { name: "Amal", bio: "x".repeat(400) });
  check("…and a long one is cut, not refused", r.status === 200 && r.data.user.bio.length === 160, r.data.user.bio.length);

  r = await amal.call("POST", "/api/auth/profile", { name: "Amal" });
  check("…and is left alone by a save that never mentions it", r.data.user.bio.length === 160, r.data.user.bio.length);

  /* ---- on the board, but the line stays yours ----

     Worth the trouble of a real check-in: the whole point of the switch is
     that a hidden line does not reach another member, and only the board as
     an actual second athlete sees it can say whether it does. */

  const mine = "Marathon in March " + stamp;
  await amal.call("POST", "/api/auth/profile", { name: "Amal", bio: mine, bio_hidden: false });

  /* An hour and a half ago: still inside the check-in window, which opens an
     hour before the start and shuts two hours after. Cleaned up at the end of
     the test — a session left lying about with a start in the recent past
     sits at the top of every other athlete's streak and breaks it. */
  const startsAt = new Date(Date.now() - 90 * 60000);
  const today = iso(startsAt);
  r = await admin("/api/admin/sessions", {
    action: "publish", name: "Bio test " + stamp, payload: PAYLOAD,
    date: today, starts_at: startsAt.toISOString(), points: 10,
  });
  const sessionId = r.data && r.data.id;
  check("a session to check in to", r.status === 200 && !!sessionId, r.status);

  r = await anon.call("POST", "/api/admin/qr", { password: ADMIN, id: sessionId });
  const [, slotN, sig] = String((r.data && r.data.url) || "").split("#/c/")[1].split("/");
  r = await amal.call("POST", "/api/checkin", { session: sessionId, slot: Number(slotN), sig: sig });
  check("…and points, so she is on the board", r.status === 200 && r.data.earned === 10, r);

  /* Omar's board, not Amal's: what one member is allowed to read of another. */
  const bioOnBoard = async () => {
    const b = await omar.call("GET", "/api/points/board");
    const row = ((b.data && b.data.board) || []).find((x) => x.name === "Amal");
    return row ? row.bio : null;
  };
  check("another member reads her line", (await bioOnBoard()) === mine);

  r = await amal.call("POST", "/api/auth/profile", { name: "Amal", bio_hidden: true });
  check("she takes it off the board", r.status === 200 && r.data.user.bio_hidden === true, r.data.user);
  check("…and it is gone from what he can read", (await bioOnBoard()) === "");
  r = await omar.call("GET", "/api/points/board");
  check("…while she is still on the board", ((r.data.board || []).some((x) => x.name === "Amal")), r.data.board);

  r = await amal.call("GET", "/api/auth/me");
  check("…and she still has her own line", r.data.user.bio === mine, r.data.user);

  /* The documented way to remove a session somebody was counted at: void the
     check-ins, which hands the points back as a reversing row, and then it
     will go. A live check-in still holds it, which is the point of the
     guard — nobody's points vanish quietly. */
  r = await admin("/api/admin/sessions", { action: "delete", id: sessionId });
  check("a session with a live check-in will not delete", r.status === 409 && r.data.error === "has-checkins", r);

  r = await admin("/api/admin/sessions", { action: "roster", id: sessionId });
  for (const entry of r.data.roster || []) {
    await admin("/api/admin/sessions", { action: "void", id: entry.id });
  }
  r = await amal.call("GET", "/api/points/me");
  check("voiding hands the points back", r.status === 200 && r.data.total === 0, r.data);

  r = await admin("/api/admin/sessions", { action: "delete", id: sessionId });
  check("…and then the session can go", r.status === 200, r);

  /* Clean up: the slot the signups hang off. */
  r = await admin("/api/admin/schedule", { action: "delete", id: slot.id });
  check("the slot can be removed", r.status === 200, r.status);

  console.log(failures ? "\n" + failures + " failure(s)." : "\nAll passed.");
  process.exit(failures ? 1 : 0);
})();
