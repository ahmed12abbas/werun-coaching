/**
 * Confirming an address, getting back in without one, and the CSV exports.
 *
 *   node tools/dev.js                  (in one terminal)
 *   node tools/smoke-email.js          (in another)
 *
 * Needs EMAIL_ECHO=1 in .dev.vars, which is how a run with no mail provider
 * gets to follow the link it just minted. It is a development-only switch —
 * /api/health calls it out if it is ever set on the live site — so this suite
 * only runs against a local server.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
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
    const type = res.headers.get("content-type") || "";
    let data = null;
    if (type.includes("json")) {
      try {
        data = await res.json();
      } catch (e) {}
    } else data = await res.text();
    return { status: res.status, data, type };
  };
  return it;
}

function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || !detail ? "" : "  -> " + JSON.stringify(detail).slice(0, 300)));
  if (!ok) failures++;
}

/** The token out of an echoed link. */
const tokenOf = (url) => String(url || "").split("/").pop();

(async () => {
  const stamp = Date.now().toString(36);
  const email = "mail+" + stamp + "@example.invalid";
  const pw = "correct-horse-" + stamp;
  const athlete = who();
  const anon = who();

  let r = await anon.call("GET", "/api/health");
  if (!(r.data && r.data.db)) {
    console.log("No DB bound at " + BASE + " — nothing to test here.");
    process.exit(1);
  }
  if (!(r.data.warnings || []).includes("email-echo-on")) {
    console.log("EMAIL_ECHO is not on, so the links cannot be followed. Set it in .dev.vars.");
    process.exit(1);
  }
  check("health admits the echo is on", (r.data.warnings || []).includes("email-echo-on"), r.data);

  r = await athlete.call("POST", "/api/auth/signup", { name: "Mail Test", email, password: pw });
  check("a member joins", r.status === 200, r);
  check("and starts unconfirmed", r.data.user && !r.data.user.email_verified_at, r.data.user);

  /* ---- confirming the address ---- */
  r = await anon.call("POST", "/api/auth/verify/send", {});
  check("asking for a link needs a login", r.status === 401, r);

  r = await athlete.call("POST", "/api/auth/verify/send", {});
  check("the link is minted", r.status === 200 && /#\/verify\//.test(r.data.echo || ""), r);
  const firstLink = r.data.echo;

  r = await anon.call("POST", "/api/auth/verify", { token: "not-a-token" });
  check("a made-up token is refused", r.status === 400 && r.data.error === "bad-token", r);
  r = await anon.call("POST", "/api/auth/verify", { token: "0".repeat(64) });
  check("a well-formed but unknown one too", r.status === 400 && r.data.error === "bad-token", r);

  /* Asking again kills the first link, so there is only ever one way in. */
  r = await athlete.call("POST", "/api/auth/verify/send", {});
  const secondLink = r.data.echo;
  check("asking again mints a different link", secondLink && secondLink !== firstLink, { firstLink, secondLink });
  r = await anon.call("POST", "/api/auth/verify", { token: tokenOf(firstLink) });
  check("…and the first one is dead", r.status === 400, r);

  r = await anon.call("POST", "/api/auth/verify", { token: tokenOf(secondLink) });
  check("the newest link confirms the address", r.status === 200 && r.data.ok, r);
  r = await anon.call("POST", "/api/auth/verify", { token: tokenOf(secondLink) });
  check("and cannot be spent twice", r.status === 400, r);

  r = await athlete.call("GET", "/api/auth/me");
  check("the account now says confirmed", !!(r.data.user && r.data.user.email_verified_at), r.data.user);
  r = await athlete.call("POST", "/api/auth/verify/send", {});
  check("asking once confirmed is a no-op", r.status === 200 && r.data.already === true, r);

  /* ---- the way back in ---- */
  r = await anon.call("POST", "/api/auth/reset/request", { email: "nobody+" + stamp + "@example.invalid" });
  check("an unknown address answers the same 200", r.status === 200 && !r.data.echo, r);

  r = await anon.call("POST", "/api/auth/reset/request", { email: email.toUpperCase() });
  check("a real one mints a link", r.status === 200 && /#\/reset\//.test(r.data.echo || ""), r);
  const resetLink = r.data.echo;

  r = await anon.call("POST", "/api/auth/reset", { token: tokenOf(resetLink), password: "short" });
  check("a short new password is refused", r.status === 400 && r.data.error === "bad-password", r);
  r = await anon.call("POST", "/api/auth/reset", { token: "0".repeat(64), password: pw + "-new" });
  check("an unknown token is refused", r.status === 400 && r.data.error === "bad-token", r);
  /* And the real token survived both, because neither got as far as spending it. */
  r = await anon.call("POST", "/api/auth/reset", { token: tokenOf(resetLink), password: pw + "-new" });
  check("the real link sets the new password", r.status === 200 && r.data.ok, r);
  r = await anon.call("POST", "/api/auth/reset", { token: tokenOf(resetLink), password: pw + "-again" });
  check("and cannot be spent twice", r.status === 400, r);

  const back = who();
  r = await back.call("POST", "/api/auth/login", { email, password: pw });
  check("the old password no longer works", r.status === 401, r);
  r = await back.call("POST", "/api/auth/login", { email, password: pw + "-new" });
  check("the new one does", r.status === 200, r);

  r = await athlete.call("GET", "/api/auth/me");
  check("a reset logs the other devices out", r.data.user === null, r.data);

  /* A verify token must not open a reset, or the other way round. */
  r = await back.call("POST", "/api/auth/verify/send", {});
  const verifyToken = tokenOf(r.data.echo || "");
  r = await anon.call("POST", "/api/auth/reset", { token: verifyToken, password: pw + "-nope" });
  check("a confirmation link cannot change a password", r.status === 400, r);

  /* ---- the exports ---- */
  r = await anon.call("POST", "/api/admin/export", { what: "members" });
  check("export needs the coach", r.status === 401, r.status);

  r = await anon.call("POST", "/api/admin/export", { password: ADMIN, what: "members" });
  check("members come back as csv", r.status === 200 && /csv/.test(r.type), r.type);
  check("…with a header row", typeof r.data === "string" && r.data.split("\r\n")[0].includes("name,email,role"), String(r.data).slice(0, 80));
  check("…and this member in it", String(r.data).includes(email), "not found");

  r = await anon.call("POST", "/api/admin/export", { password: ADMIN, what: "points" });
  check("points come back as csv", r.status === 200 && /csv/.test(r.type) && String(r.data).includes("when,name,email,points"), String(r.data).slice(0, 80));
  r = await anon.call("POST", "/api/admin/export", { password: ADMIN, what: "checkins" });
  check("check-ins come back as csv", r.status === 200 && String(r.data).includes("session date"), String(r.data).slice(0, 80));
  r = await anon.call("POST", "/api/admin/export", { password: ADMIN, what: "nonsense" });
  check("anything else is refused", r.status === 400, r.status);

  /* A name that a spreadsheet would treat as a formula comes back defused. */
  const risky = who();
  await risky.call("POST", "/api/auth/signup", { name: "=1+2", email: "calc+" + stamp + "@example.invalid", password: pw });
  r = await anon.call("POST", "/api/admin/export", { password: ADMIN, what: "members" });
  check("a formula-looking name is quoted out", String(r.data).includes("'=1+2"), "not defused");

  console.log(failures ? "\n" + failures + " failure(s)." : "\nAll passed.");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("smoke-email: " + (e.stack || e));
  process.exit(1);
});
