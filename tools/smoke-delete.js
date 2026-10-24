/**
 * Deleting your own account, from Me.
 *
 *   node tools/dev.js              (in one terminal)
 *   node tools/smoke-delete.js     (in another)
 *
 * The password again or nothing; staff are refused; and once it is done the
 * account is gone — no login, no session, no signup left behind.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

let failures = 0;

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

(async () => {
  const stamp = Date.now().toString(36);
  const pw = "correct-horse-" + stamp;
  const anon = who();
  const me = who();
  const coach = who();
  const email = "leaving+" + stamp + "@example.invalid";

  let r = await me.call("POST", "/api/auth/signup", { name: "Leaving", email, password: pw });
  check("an athlete to delete", r.status === 200, r);

  r = await anon.call("POST", "/api/auth/delete", { password: pw });
  check("nobody logged in cannot delete anything", r.status === 401, r);

  r = await me.call("POST", "/api/auth/delete", { password: "not-it" });
  check("the wrong password is refused", r.status === 401 && r.data.error === "wrong-password", r);

  r = await coach.call("POST", "/api/auth/signup", { name: "Coach", email: "staying+" + stamp + "@example.invalid", password: pw });
  await anon.call("POST", "/api/admin/members", { password: ADMIN, action: "role", id: r.data.user.id, role: "coach" });
  r = await coach.call("POST", "/api/auth/delete", { password: pw });
  check("a coach is refused", r.status === 409 && r.data.error === "staff-account", r);

  r = await me.call("POST", "/api/auth/delete", { password: pw });
  check("the right password deletes it", r.status === 200 && r.data.ok === true, r);
  check("…and the login cookie goes", !me.jar.werun_s, me.jar);

  r = await me.call("GET", "/api/auth/me");
  check("nobody is logged in afterwards", r.data && r.data.user === null, r);
  r = await anon.call("POST", "/api/auth/login", { email, password: pw });
  check("and the account cannot log in", r.status === 401, r);
  r = await anon.call("POST", "/api/auth/signup", { name: "Back again", email, password: pw });
  check("the address is free to join again", r.status === 200, r);

  console.log(failures ? failures + " failed" : "all passed");
  process.exit(failures ? 1 : 0);
})();
