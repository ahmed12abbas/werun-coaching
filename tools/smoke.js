/**
 * Smoke test for the API, against a running site — the local one by default.
 *
 *   node tools/dev.js                 (in one terminal)
 *   node tools/smoke.js               (in another; or pass a base URL)
 *   node tools/smoke.js https://weruncoaching.pages.dev
 *
 * Signs up a throwaway athlete, logs in and out, changes the name and the
 * password, reads a week, then checks the admin routes with the password in
 * SMOKE_ADMIN_PASSWORD (default: the one in .dev.vars). Every step prints
 * PASS or FAIL; the exit code says whether all of them passed.
 *
 * It leaves the throwaway account behind on purpose — the admin page should
 * have something to show — named smoke+<time>@example.invalid so it is
 * obvious what it is.
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

let cookie = "";
let failures = 0;

async function call(method, path, body, opts) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set && !(opts && opts.keepCookie)) {
    const m = /werun_s=([^;]*)/.exec(set);
    cookie = m && m[1] ? "werun_s=" + m[1] : "";
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  return { status: res.status, data };
}

function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || !detail ? "" : "  -> " + JSON.stringify(detail)));
  if (!ok) failures++;
}

(async () => {
  const stamp = Date.now().toString(36);
  const email = "smoke+" + stamp + "@example.invalid";
  const pw = "correct-horse-" + stamp;

  let r = await call("GET", "/api/health");
  check("health answers", r.status === 200 && r.data && r.data.ok, r);
  if (!(r.data && r.data.db)) {
    console.log("No DB bound at " + BASE + " — the platform routes cannot be tested here.");
    process.exit(1);
  }

  r = await call("GET", "/api/auth/me");
  check("me: nobody yet", r.status === 200 && r.data.user === null, r);

  r = await call("POST", "/api/auth/signup", { name: "Smoke Test", email: "not-an-email", password: pw });
  check("signup: bad email refused", r.status === 400 && r.data.error === "bad-email", r);
  r = await call("POST", "/api/auth/signup", { name: "Smoke Test", email, password: "short" });
  check("signup: short password refused", r.status === 400 && r.data.error === "bad-password", r);
  r = await call("POST", "/api/auth/signup", { name: "  Smoke   Test ", email: email.toUpperCase(), password: pw, lang: "ar" });
  check("signup: works, name tidied, email lowercased", r.status === 200 && r.data.user && r.data.user.name === "Smoke Test" && r.data.user.email === email && r.data.user.lang === "ar", r);
  check("signup: set a cookie", !!cookie);
  r = await call("POST", "/api/auth/signup", { name: "Again", email, password: pw }, { keepCookie: true });
  check("signup: same email refused", r.status === 409 && r.data.error === "email-taken", r);

  r = await call("GET", "/api/auth/me");
  check("me: logged in after signup", r.status === 200 && r.data.user && r.data.user.email === email, r);

  r = await call("POST", "/api/auth/logout");
  check("logout: clears the cookie", r.status === 200 && cookie === "", r);
  r = await call("GET", "/api/auth/me");
  check("me: nobody after logout", r.data.user === null, r);

  r = await call("POST", "/api/auth/login", { email, password: "wrong-" + pw });
  check("login: wrong password refused", r.status === 401 && r.data.error === "bad-login", r);
  r = await call("POST", "/api/auth/login", { email: "nobody+" + stamp + "@example.invalid", password: pw });
  check("login: unknown email gets the same answer", r.status === 401 && r.data.error === "bad-login", r);
  r = await call("POST", "/api/auth/login", { email, password: pw });
  check("login: works", r.status === 200 && r.data.user && r.data.user.email === email && !!cookie, r);
  const userId = r.data.user && r.data.user.id;
  check("login: never returns the hash", !("pass_hash" in (r.data.user || {})) && !("pass_salt" in (r.data.user || {})));

  r = await call("POST", "/api/auth/profile", { name: "Smoke Renamed", lang: "en" });
  check("profile: rename", r.status === 200 && r.data.user.name === "Smoke Renamed" && r.data.user.lang === "en", r);

  r = await call("GET", "/api/week?start=2026-09-09");
  check("week: seven days from the Monday", r.status === 200 && r.data.start === "2026-09-07" && r.data.days.length === 7 && r.data.days[6].date === "2026-09-13", r);
  r = await call("GET", "/api/week");
  check("week: no start means this week", r.status === 200 && r.data.days.length === 7, r);

  r = await call("POST", "/api/auth/password", { current: "wrong", next: pw + "-2" });
  check("password: wrong current refused", r.status === 401 && r.data.error === "wrong-password", r);
  r = await call("POST", "/api/auth/password", { current: pw, next: pw + "-2" });
  check("password: changed", r.status === 200 && r.data.ok, r);
  r = await call("GET", "/api/auth/me");
  check("password: this device stays logged in", r.data.user && r.data.user.id === userId, r);

  const keep = cookie;
  cookie = "";
  r = await call("POST", "/api/auth/login", { email, password: pw });
  check("login: old password no longer works", r.status === 401, r);
  r = await call("POST", "/api/auth/login", { email, password: pw + "-2" });
  check("login: new password works", r.status === 200, r);
  cookie = keep;

  r = await call("POST", "/api/auth/logout-all");
  check("logout-all: ok", r.status === 200 && cookie === "", r);
  cookie = keep;
  r = await call("GET", "/api/auth/me");
  check("logout-all: the kept cookie is dead", r.data.user === null, r);
  cookie = "";

  r = await call("GET", "/api/week");
  check("week: needs a login", r.status === 401 && r.data.error === "not-logged-in", r);

  /* the coach's side */
  r = await call("POST", "/api/admin/members", { password: "nope" });
  check("admin: wrong password refused", r.status === 401, r);
  r = await call("POST", "/api/admin/members", { password: ADMIN });
  const found = r.status === 200 && (r.data.members || []).find((m) => m.email === email);
  check("admin: lists the new member", !!found, r.status !== 200 ? r : "not in list");
  check("admin: never returns the hash", found && !("pass_hash" in found));

  if (found) {
    r = await call("POST", "/api/admin/members", { password: ADMIN, action: "block", id: found.id });
    check("admin: block", r.status === 200 && r.data.members.find((m) => m.id === found.id).status === "blocked", r);
    r = await call("POST", "/api/auth/login", { email, password: pw + "-2" });
    check("login: blocked account refused", r.status === 403 && r.data.error === "blocked", r);
    r = await call("POST", "/api/admin/members", { password: ADMIN, action: "unblock", id: found.id });
    check("admin: unblock", r.status === 200 && r.data.members.find((m) => m.id === found.id).status === "active", r);
  }

  r = await call("POST", "/api/admin/settings", { password: ADMIN, set: { signups_open: false, nonsense: 1 } });
  check("admin: settings close signups", r.status === 200 && r.data.settings.signups_open === false && !("nonsense" in r.data.settings), r);
  r = await call("POST", "/api/auth/signup", { name: "Late", email: "late+" + stamp + "@example.invalid", password: pw });
  check("signup: refused while closed", r.status === 403 && r.data.error === "signups-closed", r);
  r = await call("POST", "/api/admin/settings", { password: ADMIN, set: { signups_open: true } });
  check("admin: settings reopen signups", r.status === 200 && r.data.settings.signups_open === true, r);

  console.log(failures ? "\n" + failures + " failure(s)." : "\nAll passed.");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("smoke: " + (e.stack || e));
  process.exit(1);
});
