/**
 * The standing week: the pattern, and one occurrence of it moved or called off.
 *
 *   node tools/dev.js              (in one terminal)
 *   node tools/smoke-plan.js       (in another)
 *
 * The thing worth proving is that the two stay separate — moving next Tuesday
 * must not move every Tuesday, and putting it back must leave the pattern
 * exactly as it was.
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

/** The next date a given weekday falls on, and the one a week later. */
function nextDates(weekday) {
  const d = new Date();
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  const iso = (x) => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  const after = new Date(d);
  after.setDate(after.getDate() + 7);
  return { first: iso(d), second: iso(after) };
}

(async () => {
  const stamp = Date.now().toString(36);
  const athlete = who();
  const anon = who();
  const plan = (p) => anon.call("POST", "/api/admin/schedule", Object.assign({ password: ADMIN }, p));
  const change = (p) => anon.call("POST", "/api/admin/schedule-change", Object.assign({ password: ADMIN }, p));

  let r = await anon.call("GET", "/api/health");
  if (!(r.data && r.data.db)) {
    console.log("No DB bound at " + BASE + " — nothing to test here.");
    process.exit(1);
  }

  await athlete.call("POST", "/api/auth/signup", {
    name: "Plan Reader", email: "plan+" + stamp + "@example.invalid", password: "correct-horse-" + stamp,
  });

  /* ---- the pattern ---- */
  r = await anon.call("POST", "/api/admin/schedule", { action: "list" });
  check("the standing week needs the coach", r.status === 401, r.status);

  r = await plan({ action: "save", entry: { weekday: 5, at: "06:00", title_en: "" } });
  check("an entry with no name is refused", r.status === 400 && r.data.error === "bad-title", r);
  r = await plan({ action: "save", entry: { weekday: 9, at: "06:00", title_en: "Nope" } });
  check("a day that is not a day is refused", r.status === 400 && r.data.error === "bad-day", r);
  r = await plan({ action: "save", entry: { weekday: 5, at: "25:99", title_en: "Nope" } });
  check("a time that is not a time is refused", r.status === 400 && r.data.error === "bad-time", r);
  r = await plan({ action: "save", entry: { weekday: 5, at: "06:00", title_en: "Nope", map_url: "http://insecure.example" } });
  check("a map link that is not https is refused", r.status === 400 && r.data.error === "bad-url", r);

  /* Friday is the club's rest day, so a test entry there disturbs nothing. */
  r = await plan({
    action: "save",
    entry: {
      weekday: 5, at: "06:00", active: 1, points: 10,
      title_en: "Test recovery " + stamp, title_ar: "استشفاء تجريبي",
      place_en: "Wadi Hanifa Park", place_ar: "حديقة وادي حنيفة",
      map_url: "https://maps.app.goo.gl/example",
    },
  });
  const mine = (r.data.schedule || []).find((e) => e.title_en === "Test recovery " + stamp);
  check("an entry saves", r.status === 200 && !!mine, r.status);
  check("…with its map link kept", mine && mine.map_url === "https://maps.app.goo.gl/example", mine);

  const { first, second } = nextDates(5);

  r = await athlete.call("GET", "/api/week?start=" + first);
  let day = (r.data.days || []).find((d) => d.date === first);
  let item = day && (day.items || []).find((i) => i.id === mine.id);
  check("the club sees it on the day", !!item, day);
  check("…in their own language too", item && item.title_ar === "استشفاء تجريبي", item);
  check("…as a standing entry, not a published one", item && item.kind === "standing", item);

  /* ---- one occurrence, moved ---- */
  r = await change({ schedule_id: mine.id, date: first, at: "07:15", note_en: "Gate 2 is shut" });
  check("moving one date is recorded", r.status === 200 && (r.data.changes || []).length >= 1, r.status);

  r = await athlete.call("GET", "/api/week?start=" + first);
  item = ((r.data.days || []).find((d) => d.date === first).items || []).find((i) => i.id === mine.id);
  check("that date moves", item && item.at === "07:15" && item.moved === true, item);
  check("…and carries the note", item && item.note_en === "Gate 2 is shut", item);

  r = await athlete.call("GET", "/api/week?start=" + second);
  item = ((r.data.days || []).find((d) => d.date === second).items || []).find((i) => i.id === mine.id);
  check("the week after is untouched", item && item.at === "06:00" && item.moved === false, item);

  r = await plan({ action: "list" });
  const still = (r.data.schedule || []).find((e) => e.id === mine.id);
  check("and the pattern itself never moved", still && still.at === "06:00", still);

  /* ---- one occurrence, called off ---- */
  r = await change({ schedule_id: mine.id, date: first, cancelled: true, note_en: "Sandstorm" });
  r = await athlete.call("GET", "/api/week?start=" + first);
  item = ((r.data.days || []).find((d) => d.date === first).items || []).find((i) => i.id === mine.id);
  check("calling one off shows as called off", item && item.cancelled === true, item);
  check("…and it is still listed, not hidden", !!item, "vanished");

  r = await change({ action: "clear", schedule_id: mine.id, date: first });
  check("putting it back clears the change", r.status === 200, r.status);
  r = await athlete.call("GET", "/api/week?start=" + first);
  item = ((r.data.days || []).find((d) => d.date === first).items || []).find((i) => i.id === mine.id);
  check("…and the day is ordinary again", item && item.at === "06:00" && !item.cancelled && !item.moved, item);

  r = await change({ schedule_id: "no-such-entry", date: first, cancelled: true });
  check("a change against nothing is refused", r.status === 404, r.status);
  r = await change({ schedule_id: mine.id, date: "not-a-date", cancelled: true });
  check("a change on a non-date is refused", r.status === 400, r.status);

  /* ---- off the schedule ---- */
  await plan({ action: "save", entry: Object.assign({}, mine, { active: 0 }) });
  r = await athlete.call("GET", "/api/week?start=" + first);
  item = ((r.data.days || []).find((d) => d.date === first).items || []).find((i) => i.id === mine.id);
  check("taken off the schedule, the club stops seeing it", !item, item);

  /* A workout published against a slot replaces it — and keeps its place. */
  await plan({ action: "save", entry: Object.assign({}, mine, { active: 1 }) });
  const startsAt = new Date(first + "T06:00:00+03:00").toISOString();
  r = await anon.call("POST", "/api/admin/sessions", {
    password: ADMIN, action: "publish", schedule_id: mine.id,
    name: "Test workout " + stamp, payload: "1.test", date: first, starts_at: startsAt, points: 10,
  });
  check("a workout can be published against a slot", r.status === 200 && !!r.data.id, r.status);
  const published = r.data.id;

  r = await athlete.call("GET", "/api/week?start=" + first);
  const onDay = ((r.data.days || []).find((d) => d.date === first) || {}).items || [];
  check("it replaces the standing one, not doubles it", onDay.filter((i) => i.schedule_id === mine.id).length === 1, onDay);
  const swapped = onDay.find((i) => i.schedule_id === mine.id);
  check("…and shows as the workout", swapped && swapped.kind === "session", swapped);
  check("…keeping the place it is held at", swapped && swapped.place_en === "Wadi Hanifa Park", swapped);

  await anon.call("POST", "/api/admin/sessions", { password: ADMIN, action: "delete", id: published });

  r = await plan({ action: "delete", id: mine.id });
  check("and it can be removed", r.status === 200 && !(r.data.schedule || []).some((e) => e.id === mine.id), r.status);

  console.log(failures ? "\n" + failures + " failure(s)." : "\nAll passed.");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("smoke-plan: " + (e.stack || e));
  process.exit(1);
});
