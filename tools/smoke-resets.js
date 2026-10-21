/**
 * Password reset requests answered by a coach (routes/resets.js).
 *
 *   node tools/dev.js                  (in one terminal, mail off: no EMAIL_ECHO)
 *   node tools/smoke-resets.js         (in another)
 *
 * An athlete asks, a coach sees it on /coach and sends the one-time link, the
 * athlete spends it. And the fences: only athletes, only a coach's own login,
 * only once.
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";
let failures = 0;

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

(async () => {
  const stamp = Date.now().toString(36);
  const pw = "correct-horse-" + stamp;
  const anon = who();
  const coach = who();
  const runner = who();
  const other = who();
  const admin = (path, p) => anon.call("POST", path, Object.assign({ password: ADMIN }, p));

  let r = await anon.call("GET", "/api/health");
  if (!(r.data.table_names || []).includes("reset_requests")) {
    console.log("No reset_requests table at " + BASE + " — migration 0035 is not applied.");
    process.exit(1);
  }

  const emails = {};
  const make = async (it, name) => {
    emails[name] = name.replace(/ /g, "") + "+" + stamp + "@example.invalid";
    const s = await it.call("POST", "/api/auth/signup", { name, email: emails[name], password: pw });
    return s.data && s.data.user && s.data.user.id;
  };
  const coachId = await make(coach, "Coach " + stamp);
  await make(runner, "Runner " + stamp);
  await make(other, "Other " + stamp);
  await admin("/api/admin/members", { action: "role", id: coachId, role: "coach" });

  /* ---- asking ---- */
  r = await anon.call("POST", "/api/auth/reset/request", { email: emails["Runner " + stamp] });
  check("an athlete asks, and is told the coach will send it", r.status === 200 && r.data.via === "coach", r);
  r = await anon.call("POST", "/api/auth/reset/request", { email: "nobody+" + stamp + "@example.invalid" });
  check("…the same answer for an address nobody has", r.status === 200 && r.data.via === "coach", r);
  // Four asks and three accounts: the form allows five an hour from one
  // address and signup three, so run this against a fresh .wrangler/state.
  await anon.call("POST", "/api/auth/reset/request", { email: emails["Coach " + stamp] });
  await anon.call("POST", "/api/auth/reset/request", { email: emails["Other " + stamp] });

  /* ---- the coach's list ---- */
  r = await runner.call("POST", "/api/coach/resets", { action: "list" });
  check("an athlete cannot see the list", r.status === 401, r);

  r = await coach.call("POST", "/api/coach/resets", { action: "list" });
  const mine = (r.data.open || []).filter((x) => x.name.endsWith(stamp));
  check("a coach sees the athletes' requests", mine.length === 2 && mine.some((x) => x.name === "Runner " + stamp), r);
  check("…and not a coach's own", !mine.some((x) => x.name === "Coach " + stamp), r);
  const runnerReq = mine.find((x) => x.name === "Runner " + stamp).id;
  const otherReq = mine.find((x) => x.name === "Other " + stamp).id;

  r = await admin("/api/coach/resets", { action: "link", id: runnerReq });
  check("the club password cannot send a link (it is nobody)", r.status === 403 && r.data.error === "coach-login", r);

  /* ---- sending ---- */
  r = await coach.call("POST", "/api/coach/resets", { action: "link", id: runnerReq });
  check("a coach sends the link", r.status === 200 && /\/app#\/reset\/[0-9a-f]{64}$/.test(r.data.link || ""), r);
  const token = String(r.data.link || "").split("/").pop();
  check("…and it moves to handled, with their name on it",
    (r.data.done || []).some((x) => x.id === runnerReq && x.outcome === "sent" && x.handled_by_name === "Coach " + stamp), r);

  r = await coach.call("POST", "/api/coach/resets", { action: "link", id: runnerReq });
  check("a second tap is told it is done, not handed a second link", r.status === 409 && r.data.error === "handled", r);

  r = await anon.call("POST", "/api/auth/reset", { token, password: "brand-new-" + stamp });
  check("the athlete spends the link", r.status === 200, r);
  r = await anon.call("POST", "/api/auth/login", { email: emails["Runner " + stamp], password: "brand-new-" + stamp });
  check("…and logs in with the password they chose", r.status === 200, r);

  r = await coach.call("POST", "/api/coach/resets", { action: "dismiss", id: otherReq });
  check("a coach turns one down", r.status === 200 && !(r.data.open || []).some((x) => x.id === otherReq), r);

  console.log(failures ? failures + " failed" : "All passed");
  process.exit(failures ? 1 : 0);
})();
