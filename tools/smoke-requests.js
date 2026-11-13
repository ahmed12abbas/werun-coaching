/**
 * Missed check-ins, and the app's theme.
 *
 *   node tools/dev.js              (in one terminal)
 *   node tools/smoke-requests.js   (in another)
 *
 * A coach asks for an athlete who could not scan; only an admin decides, and
 * a yes is a real check-in with the session's points. Then the theme: a
 * colour and an uploaded logo go into the app's markup, and nothing but a
 * colour or our own upload is accepted.
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";
const PAYLOAD =
  "1.gzjGNz8P0y0QE2AmI9tvaKqQm5mnBDMMpgQk5ejkDA1KBW2F4pKizJTUYrBCoHsNjZBcDHGsKcxIB1MFb3BYI5laDNIClc_KT9cvT8zJVoK73Bify2Ih0Q6PXqVaAA";
// A 1x1 transparent PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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
      // A response that sets only the device cookie leaves the login alone.
      if (m) it.cookie = m[1] ? "werun_s=" + m[1] : "";
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
  const admin = (path, p) => anon.call("POST", path, Object.assign({ password: ADMIN }, p));

  let r = await anon.call("GET", "/api/health");
  if (!(r.data.table_names || []).includes("point_requests")) {
    console.log("No point_requests table at " + BASE + " — migration 0033 is not applied.");
    process.exit(1);
  }

  const make = async (it, name) => {
    const s = await it.call("POST", "/api/auth/signup", { name, email: name.replace(/ /g, "") + "+" + stamp + "@example.invalid", password: pw });
    return s.data && s.data.user && s.data.user.id;
  };
  const coachId = await make(coach, "Coach " + stamp);
  const runnerId = await make(runner, "Runner " + stamp);
  await admin("/api/admin/members", { action: "role", id: coachId, role: "leader" });

  const started = new Date(Date.now() - 3600000);
  r = await admin("/api/admin/sessions", {
    action: "publish", name: "Missed | WeRUN", payload: PAYLOAD,
    date: started.toISOString().slice(0, 10), starts_at: started.toISOString(), points: 10,
  });
  const session = r.data.id;
  check("a session that has started", r.status === 200 && !!session, r);

  /* ---- asking ---- */
  r = await coach.call("POST", "/api/coach/point-requests", { action: "find", q: "Runner " + stamp });
  check("a leader finds the athlete by name", (r.data.results || []).some((u) => u.id === runnerId), r);

  r = await runner.call("POST", "/api/coach/point-requests", { action: "ask", session, user: runnerId, reason: "x" });
  check("an athlete cannot ask for themselves", r.status === 401, r);

  r = await admin("/api/coach/point-requests", { action: "ask", session, user: runnerId, reason: "x" });
  check("the club password cannot ask (it is nobody)", r.status === 403 && r.data.error === "coach-login", r);

  r = await coach.call("POST", "/api/coach/point-requests", { action: "ask", session, user: runnerId, reason: "" });
  check("a reason is required", r.status === 400, r);

  r = await coach.call("POST", "/api/coach/point-requests", { action: "ask", session, user: runnerId, reason: "Phone died" });
  check("a leader asks", r.status === 200 && r.data.requests.length === 1 && r.data.requests[0].status === "pending", r);
  const reqId = r.data.requests[0].id;

  r = await coach.call("POST", "/api/coach/point-requests", { action: "ask", session, user: runnerId, reason: "again" });
  check("…once per athlete per session", r.status === 409 && r.data.error === "asked", r);

  /* ---- deciding ---- */
  r = await coach.call("POST", "/api/admin/point-requests", { action: "approve", id: reqId });
  check("a coach cannot approve", r.status === 403, r);

  r = await runner.call("GET", "/api/points/me");
  const before = r.data.total;

  r = await admin("/api/admin/point-requests", {});
  check("the admin sees it waiting", (r.data.pending || []).some((p) => p.id === reqId), r);

  r = await admin("/api/admin/point-requests", { action: "approve", id: reqId });
  check("the admin approves", r.status === 200 && !(r.data.pending || []).some((p) => p.id === reqId), r);

  r = await admin("/api/admin/point-requests", { action: "approve", id: reqId });
  check("…and twice counts once", r.status === 409 && r.data.error === "decided", r);

  r = await runner.call("GET", "/api/points/me");
  check("the athlete has the session's points", r.data.total === before + 10, { before, after: r.data.total });

  r = await admin("/api/admin/sessions", { action: "roster", id: session });
  check("…and is on the roster", (r.data.roster || []).some((x) => x.user_id === runnerId), r);

  /* ---- the theme ---- */
  r = await admin("/api/admin/settings", { set: { theme_color: "red;}body{x" } });
  check("only a colour is a colour", r.status === 400 && r.data.error === "bad-color", r);
  r = await admin("/api/admin/settings", { set: { logo_url: "https://evil.example/x.png" } });
  check("only our own uploads are a logo", r.status === 400, r);

  r = await admin("/api/admin/settings", { action: "upload", data: PNG });
  check("a logo uploads", r.status === 200 && /^\/api\/brand\/img\?id=/.test(r.data.url), r);
  const logo = r.data.url;
  r = await admin("/api/admin/settings", { set: { theme_color: "#0f8a4b", logo_url: logo, intro_url: logo } });
  check("the theme saves", r.status === 200 && r.data.settings.theme_color === "#0f8a4b", r);

  // settings are cached a minute per isolate, but the save writes the cache.
  const page = await (await fetch(BASE + "/app", { headers: { accept: "text/html" } })).text();
  check("the app's page carries the colour", page.includes("--brand:#0f8a4b"), page.slice(0, 200));
  check("…the logo", page.includes('data-logo="' + logo + '"'));
  check("…and the intro", /class="splash-default" src="\/api\/brand\/img/.test(page));
  const staff = await (await fetch(BASE + "/admin", { headers: { accept: "text/html" } })).text();
  check("the console is left alone", !staff.includes("--brand:#0f8a4b"));
  check("the image is served", (await fetch(BASE + logo)).headers.get("content-type") === "image/png");

  /* ---- the Next Up video: capped, only ours, and served in pieces for iPhone ---- */
  const mp4 = (n) => "data:video/mp4;base64," + Buffer.alloc(n, 7).toString("base64");
  r = await admin("/api/admin/settings", { action: "upload-video", data: mp4(2 * 1024 * 1024 + 1) });
  check("a video over 2 MB is refused", r.status === 400 && r.data.error === "too-big", r);
  r = await admin("/api/admin/settings", { action: "upload-video", data: PNG });
  check("…and a photo is not a video", r.status === 400 && r.data.error === "bad-video", r);
  r = await admin("/api/admin/settings", { action: "upload", data: mp4(100) });
  check("…nor a video a photo", r.status === 400 && r.data.error === "bad-image", r);
  r = await coach.call("POST", "/api/admin/settings", { action: "upload-video", data: mp4(100) });
  check("a leader cannot upload one", r.status === 401 || r.status === 403, r);
  r = await admin("/api/admin/settings", { action: "upload-video", data: mp4(1000) });
  check("a small video uploads", r.status === 200 && /^\/api\/brand\/img\?id=/.test(r.data.url), r);
  const clip = r.data.url;
  r = await admin("/api/admin/settings", { set: { nextup_video: "https://example.com/x.mp4" } });
  check("only our own upload is the video", r.status === 400, r);
  r = await admin("/api/admin/settings", { set: { nextup_video: clip } });
  check("the video saves", r.status === 200 && r.data.settings.nextup_video === clip, r);
  r = await runner.call("GET", "/api/auth/me");
  check("…and reaches the app", r.data.club && r.data.club.nextup_video === clip, r.data && r.data.club);
  let res = await fetch(BASE + clip, { headers: { range: "bytes=0-1" } });
  check("a range is answered as one", res.status === 206 && res.headers.get("content-range") === "bytes 0-1/1000" &&
    (await res.arrayBuffer()).byteLength === 2, res.status);
  res = await fetch(BASE + clip, { headers: { range: "bytes=990-" } });
  check("…to the end", res.status === 206 && res.headers.get("content-range") === "bytes 990-999/1000", res.status);
  res = await fetch(BASE + clip, { headers: { range: "bytes=5000-" } });
  check("…and past it refused", res.status === 416, res.status);
  res = await fetch(BASE + clip);
  check("the whole video, typed", res.status === 200 && res.headers.get("content-type") === "video/mp4", res.status);

  await admin("/api/admin/settings", { set: { theme_color: "", logo_url: "", intro_url: "", nextup_video: "" } });
  const back = await (await fetch(BASE + "/app", { headers: { accept: "text/html" } })).text();
  check("cleared, the club's own again", !back.includes("data-logo") && !back.includes("--brand:#0f8a4b"));

  console.log(failures ? "\n" + failures + " failed" : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
