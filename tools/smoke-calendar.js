/**
 * The watch calendar feed: an athlete's own signed link, and nobody else's.
 *
 *   node tools/dev.js               (in one terminal)
 *   node tools/smoke-calendar.js    (in another)
 *
 * The feed is read by a calendar app with no cookie, so what matters is that
 * the link only works as signed, and that what comes back is a calendar with
 * the club's standing week in it.
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");

let failures = 0;
let cookie = "";

async function call(method, path, body) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  const m = set && /werun_s=([^;]*)/.exec(set);
  if (m && m[1]) cookie = "werun_s=" + m[1];
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  return { status: res.status, data };
}

function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || !detail ? "" : "  -> " + JSON.stringify(detail).slice(0, 240)));
  if (!ok) failures++;
}

(async () => {
  let r = await call("POST", "/api/calendar");
  check("link: needs a login", r.status === 401, r);

  const email = "cal-" + Date.now() + "@example.com";
  r = await call("POST", "/api/auth/signup", { name: "Calendar Smoke", email, password: "smoke-pass-12345" });
  check("signup works", r.status === 200, r);

  r = await call("POST", "/api/calendar");
  check("link: handed out", r.status === 200 && /\/api\/calendar\.ics\?u=.+&s=[0-9a-f]{64}$/.test(r.data.url), r);
  const url = new URL(r.data.url);

  const feed = await fetch(BASE + url.pathname + url.search);
  const ics = await feed.text();
  check("feed: is a calendar", feed.status === 200 && /^text\/calendar/.test(feed.headers.get("content-type")), feed.status);
  check("feed: well formed", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"), ics.slice(0, 80));
  check("feed: has the standing week", (ics.match(/BEGIN:VEVENT/g) || []).length > 0, "no events — run tools/seed-schedule.js?");
  check("feed: no line over 75 octets", ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));

  const ar = await (await fetch(BASE + url.pathname + url.search + "&lang=ar")).text();
  check("feed: arabic answers too", ar.startsWith("BEGIN:VCALENDAR"));

  const forged = new URLSearchParams(url.search);
  forged.set("s", "0".repeat(16));
  r = await fetch(BASE + "/api/calendar.ics?" + forged.toString());
  check("feed: a wrong signature is refused", r.status === 404, r.status);
  forged.set("s", "0".repeat(64));
  r = await fetch(BASE + "/api/calendar.ics?" + forged.toString());
  check("feed: …a wrong full-length one too", r.status === 404, r.status);

  /* A link handed out before the calendar had its own key: phones are still
     subscribed to those, so the old signature must keep working. */
  const qr = (require("fs").readFileSync(require("path").join(__dirname, "..", ".dev.vars"), "utf8").match(/^QR_SECRET=(.*)$/m) || [])[1];
  if (qr) {
    const { signSlot } = await import("../_worker.js/lib/checkin.js");
    const old = new URLSearchParams(url.search);
    old.set("s", await signSlot(qr.trim(), "cal", old.get("u")));
    r = await fetch(BASE + "/api/calendar.ics?" + old.toString());
    check("feed: a link from before still works", r.status === 200, r.status);
  }

  r = await call("POST", "/api/intervals", { action: "sync", events: [] });
  check("intervals sync: answers without crashing", r.status === 503 || r.status === 409 || r.status === 200, r);

  console.log(failures ? failures + " failed" : "all passed");
  process.exit(failures ? 1 : 0);
})();
