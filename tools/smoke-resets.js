/**
 * A password reset handed over at the track, and only to the athlete's own phone.
 *
 *   node tools/dev.js              (in one terminal)
 *   node tools/smoke-resets.js     (in another)
 *
 * The forgot form takes any address, so a coach could ask for somebody else's
 * reset and then hand the QR to themselves. What is proved here is that the
 * coach's list only carries a reset asked for from a phone that athlete has
 * logged in on (the werun_d cookie), that a forged one does not count, and
 * that one ask is one hand-over.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

let failures = 0;

/** A browser: every cookie it is given, kept and sent back. */
function who() {
  const jar = {};
  const it = { jar };
  it.call = async (method, path, body) => {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const cookie = Object.entries(jar).map(([k, v]) => k + "=" + v).join("; ");
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const line of res.headers.getSetCookie()) {
      const [k, v] = line.split(";")[0].split("=");
      if (v) jar[k] = v;
      else delete jar[k];
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

const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

(async () => {
  const stamp = Date.now().toString(36);
  const pw = "correct-horse-" + stamp;
  const anon = who();
  const coach = who();
  const athlete = who();
  const stranger = who();
  const admin = (path, p) => anon.call("POST", path, Object.assign({ password: ADMIN }, p));

  let r = await anon.call("GET", "/api/health");
  if (!(r.data && r.data.db && r.data.qr)) {
    console.log("No DB or QR_SECRET at " + BASE + " — nothing to test here.");
    process.exit(1);
  }

  const email = "runner+" + stamp + "@example.invalid";
  r = await coach.call("POST", "/api/auth/signup", { name: "Coach", email: "coach+" + stamp + "@example.invalid", password: pw });
  const coachId = r.data && r.data.user && r.data.user.id;
  await admin("/api/admin/members", { action: "role", id: coachId, role: "coach" });
  r = await athlete.call("POST", "/api/auth/signup", { name: "Runner " + stamp, email, password: pw });
  const athleteId = r.data && r.data.user && r.data.user.id;
  check("signing up leaves this phone's device cookie", !!(athlete.jar.werun_d || "").startsWith(athleteId + "."), athlete.jar);
  await athlete.call("POST", "/api/auth/logout");
  check("…and logging out keeps it", !athlete.jar.werun_s && !!athlete.jar.werun_d, athlete.jar);

  /* Today's slot, so the coach is within a day of it. */
  const today = new Date();
  r = await admin("/api/admin/schedule", {
    action: "save",
    entry: {
      weekday: today.getDay(), at: "23:00", active: 1, points: 10,
      title_en: "Reset test " + stamp, title_ar: "تجربة",
      place_en: "Wadi Hanifa Park", place_ar: "حديقة وادي حنيفة",
    },
  });
  const slot = (r.data.schedule || []).find((e) => e.title_en === "Reset test " + stamp);
  const date = ymd(today);
  await coach.call("POST", "/api/coach/rota", { action: "join", schedule_id: slot.id, date });
  const listed = async () => {
    const l = await coach.call("POST", "/api/coach/resets", { action: "list", schedule_id: slot.id, date });
    return (l.data.waiting || []).some((w) => w.id === athleteId);
  };

  r = await stranger.call("POST", "/api/auth/reset/request", { email });
  check("anyone may ask for a reset by address", r.status === 200, r);
  check("…but the coach is not offered one asked from elsewhere", !(await listed()));
  r = await coach.call("POST", "/api/coach/resets", { action: "qr", schedule_id: slot.id, date, user_id: athleteId });
  check("…and cannot mint the QR for it", r.status === 404, r);

  stranger.jar.werun_d = athleteId + ".0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  await stranger.call("POST", "/api/auth/reset/request", { email });
  check("a forged device cookie does not count", !(await listed()));

  r = await athlete.call("POST", "/api/auth/reset/request", { email });
  check("asked from the athlete's own phone", r.status === 200, r);
  check("…the coach is offered it", await listed());
  r = await coach.call("POST", "/api/coach/resets", { action: "qr", schedule_id: slot.id, date, user_id: athleteId });
  check("…and can hand the QR over", r.status === 200 && /#\/reset\//.test(r.data.link || ""), r);
  r = await coach.call("POST", "/api/coach/resets", { action: "qr", schedule_id: slot.id, date, user_id: athleteId });
  check("one ask is one hand-over", r.status === 404, r);

  await admin("/api/admin/schedule", { action: "delete", id: slot.id });
  console.log(failures ? failures + " failed" : "all passed");
  process.exit(failures ? 1 : 0);
})();
