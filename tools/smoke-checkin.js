/**
 * The check-in chain, end to end, against a running site.
 *
 *   node tools/dev.js                     (in one terminal)
 *   node tools/smoke-checkin.js           (in another)
 *   node tools/smoke-checkin.js https://weruncoaching.pages.dev
 *
 * Publishes a session, asks for a code, scans it as a new athlete, and then
 * tries every way of cheating it: a made-up signature, one from a slot that
 * has gone by, a second scan, and a scan outside the window. Finishes by
 * voiding the check-in and confirming the points come back.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

let cookie = "";
let failures = 0;

async function call(method, path, body) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) {
    const m = /werun_s=([^;]*)/.exec(set);
    cookie = m && m[1] ? "werun_s=" + m[1] : "";
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  return { status: res.status, data };
}
const admin = (payload) => call("POST", "/api/admin/sessions", Object.assign({ password: ADMIN }, payload));

function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || !detail ? "" : "  -> " + JSON.stringify(detail)));
  if (!ok) failures++;
}

/* A payload the real encoder produced, for a two-step session. Stored and
   handed back untouched, so the app decodes it with js/model.js. */
const PAYLOAD =
  "1.gzjGNz8P0y0QE2AmI9tvaKqQm5mnBDMMpgQk5ejkDA1KBW2F4pKizJTUYrBCoHsNjZBcDHGsKcxIB1MFb3BYI5laDNIClc_KT9cvT8zJVoK73Bify2Ih0Q6PXqVaAA";

(async () => {
  const stamp = Date.now().toString(36);
  const email = "checkin+" + stamp + "@example.invalid";
  const pw = "correct-horse-" + stamp;

  let r = await call("GET", "/api/health");
  if (!(r.data && r.data.db)) {
    console.log("No DB bound at " + BASE + " — nothing to test here.");
    process.exit(1);
  }
  check("QR signing is configured", !!(r.data && r.data.qr), r.data);

  /* A session that is open for check-in right now: starting a minute ago. */
  const startsAt = new Date(Date.now() - 60000);
  const date = startsAt.getFullYear() + "-" + String(startsAt.getMonth() + 1).padStart(2, "0") + "-" + String(startsAt.getDate()).padStart(2, "0");
  r = await admin({ action: "publish", name: "Smoke | WeRUN", payload: PAYLOAD, date, starts_at: startsAt.toISOString(), points: 10 });
  check("publish: a session lands", r.status === 200 && !!r.data.id, r);
  const sessionId = r.data && r.data.id;
  if (!sessionId) process.exit(1);

  r = await admin({ action: "publish", name: "No payload", date, starts_at: startsAt.toISOString() });
  check("publish: refuses an empty payload", r.status === 400 && r.data.error === "bad-payload", r);

  r = await call("POST", "/api/admin/qr", { password: ADMIN, id: sessionId });
  check("qr: a signed url comes back", r.status === 200 && /#\/c\//.test(r.data.url || ""), r);
  check("qr: the window is open", r.data && r.data.open === true, r.data);
  const parts = String(r.data.url).split("#/c/")[1].split("/");
  const [id, slot, sig] = parts;
  check("qr: the url names this session", id === sessionId, parts);
  r = await call("POST", "/api/admin/qr", { password: "nope", id: sessionId });
  check("qr: needs the club password", r.status === 401, r);

  /* An athlete, who has to be logged in before any of this counts. */
  r = await call("POST", "/api/checkin", { session: sessionId, slot: Number(slot), sig });
  check("checkin: refused when logged out", r.status === 401 && r.data.error === "not-logged-in", r);

  r = await call("POST", "/api/auth/signup", { name: "Check In", email, password: pw });
  check("a new athlete joins", r.status === 200, r);

  r = await call("POST", "/api/checkin", { session: sessionId, slot: Number(slot), sig: "0".repeat(16) });
  check("checkin: a made-up signature is refused", r.status === 403 && r.data.error === "stale-code", r);
  r = await call("POST", "/api/checkin", { session: sessionId, slot: Number(slot) - 10, sig });
  check("checkin: an old slot is refused", r.status === 403 && r.data.error === "stale-code", r);
  r = await call("POST", "/api/checkin", { session: sessionId, slot: Number(slot) + 10, sig });
  check("checkin: a future slot is refused", r.status === 403 && r.data.error === "stale-code", r);
  r = await call("POST", "/api/checkin", { session: "no-such-session", slot: Number(slot), sig });
  check("checkin: an unknown session is refused", r.status === 404, r);

  r = await call("POST", "/api/checkin", { session: sessionId, slot: Number(slot), sig });
  check("checkin: the real code works", r.status === 200 && r.data.ok && r.data.earned === 10, r);
  check("checkin: the streak counts this session", r.data && r.data.streak >= 1, r.data);
  check("checkin: the total went up", r.data && r.data.total >= 10, r.data);

  r = await call("POST", "/api/checkin", { session: sessionId, slot: Number(slot), sig });
  check("checkin: a second scan is refused", r.status === 409 && r.data.error === "already", r);

  r = await call("GET", "/api/points/me");
  check("points: the ledger explains the total", r.status === 200 && r.data.total >= 10 && r.data.history.length >= 1, r);
  check("points: one session attended", r.data && r.data.sessions === 1, r.data);

  r = await call("GET", "/api/points/board");
  const onBoard = r.status === 200 && (r.data.board || []).some((row) => row.me);
  check("board: the athlete is on it", onBoard, r);
  r = await call("POST", "/api/points/board-visibility", { hidden: true });
  check("board: they can step off it", r.status === 200 && r.data.hidden === true, r);
  r = await call("GET", "/api/points/board");
  check("board: and are gone once they have", !(r.data.board || []).some((row) => row.me), r.data);
  await call("POST", "/api/points/board-visibility", { hidden: false });

  r = await call("GET", "/api/week?start=" + date);
  const day = (r.data.days || []).find((d) => d.date === date);
  const mine = day && (day.items || []).find((i) => i.id === sessionId);
  check("week: the session shows as checked in", !!(mine && mine.checked_in), mine || "not in the week");

  r = await call("GET", "/api/session?id=" + sessionId);
  check("session: the payload comes back for the app to draw", r.status === 200 && r.data.session.payload === PAYLOAD, r.status);

  /* A session whose window has closed: published for last week. */
  const old = new Date(Date.now() - 8 * 86400 * 1000);
  const oldDate = old.getFullYear() + "-" + String(old.getMonth() + 1).padStart(2, "0") + "-" + String(old.getDate()).padStart(2, "0");
  r = await admin({ action: "publish", name: "Old | WeRUN", payload: PAYLOAD, date: oldDate, starts_at: old.toISOString(), points: 10 });
  const oldId = r.data && r.data.id;
  r = await call("POST", "/api/admin/qr", { password: ADMIN, id: oldId });
  check("qr: a finished session says the window is shut", r.data && r.data.open === false, r.data);
  const oldParts = String(r.data.url).split("#/c/")[1].split("/");
  r = await call("POST", "/api/checkin", { session: oldId, slot: Number(oldParts[1]), sig: oldParts[2] });
  check("checkin: refused after the window closes", r.status === 403 && r.data.error === "too-late", r);

  /* And the coach taking one back. */
  r = await admin({ action: "roster", id: sessionId });
  const entry = (r.data.roster || [])[0];
  check("roster: the coach sees who came", !!entry && entry.email === email, r.data);

  r = await admin({ action: "delete", id: sessionId });
  check("delete: refused while someone has checked in", r.status === 409 && r.data.error === "has-checkins", r);

  r = await admin({ action: "void", id: entry.id });
  check("void: the check-in is struck through", r.status === 200 && !!(r.data.roster || [])[0].voided_at, r);
  r = await call("GET", "/api/points/me");
  check("void: the points went back", r.status === 200 && r.data.total === 0, r.data);
  check("void: and the history says so", (r.data.history || []).some((h) => h.reason === "void"), r.data.history);
  r = await call("POST", "/api/checkin", { session: sessionId, slot: Number(slot), sig });
  check("void: scanning again does not undo the coach", r.status === 403 && r.data.error === "voided", r);

  await admin({ action: "delete", id: oldId });
  console.log(failures ? "\n" + failures + " failure(s)." : "\nAll passed.");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("smoke-checkin: " + (e.stack || e));
  process.exit(1);
});
