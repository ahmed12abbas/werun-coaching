/**
 * The feed, the coach login and the switches, against a running site.
 *
 *   node tools/dev.js                  (in one terminal)
 *   node tools/smoke-feed.js           (in another)
 *
 * Makes a coach out of a member, checks the console opens on that login with
 * no password anywhere, writes a post and watches it appear in the feed only
 * once it is published, then turns maintenance on and makes sure athletes are
 * held out while the coach carries on — and that logging in never stops.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

let failures = 0;

/** Each identity keeps its own cookie, so a coach and an athlete can coexist. */
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

/** Poll until it is true, or give up after about fifteen seconds. */
async function waitFor(fn, tries) {
  for (let i = 0; i < (tries || 30); i++) {
    if (await fn()) return true;
    await new Promise((f) => setTimeout(f, 500));
  }
  return false;
}

function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || !detail ? "" : "  -> " + JSON.stringify(detail)));
  if (!ok) failures++;
}

(async () => {
  const stamp = Date.now().toString(36);
  const pw = "correct-horse-" + stamp;
  const coach = who();
  const athlete = who();
  const anon = who();

  let r = await anon.call("GET", "/api/health");
  if (!(r.data && r.data.db)) {
    console.log("No DB bound at " + BASE + " — nothing to test here.");
    process.exit(1);
  }

  /* Two members. */
  const coachEmail = "coach+" + stamp + "@example.invalid";
  const athleteEmail = "athlete+" + stamp + "@example.invalid";
  r = await coach.call("POST", "/api/auth/signup", { name: "The Coach", email: coachEmail, password: pw });
  check("a member joins", r.status === 200, r);
  const coachId = r.data && r.data.user && r.data.user.id;
  check("me carries the club settings", !!(r.data && r.data.user), r.status);
  await athlete.call("POST", "/api/auth/signup", { name: "An Athlete", email: athleteEmail, password: pw });

  /* Still an athlete: the console is shut to them. */
  r = await coach.call("POST", "/api/admin/members", {});
  check("a member cannot open the console", r.status === 401, r);

  /* The club password promotes the first coach — which is the whole reason
     it does not retire when accounts arrive. */
  r = await anon.call("POST", "/api/admin/members", { password: ADMIN, action: "role", id: coachId, role: "coach" });
  check("the club password makes a coach", r.status === 200 && r.data.members.find((m) => m.id === coachId).role === "coach", r);

  /* Coaching is not running the club. What a coach gets is the track: the
     head count, the week to read, the code and the roster. What they do not
     get is anything that changes the club — and the refusal says which of
     the two they are, rather than asking for a password they have no
     reason to hold. */
  r = await coach.call("POST", "/api/admin/members", {});
  check("a coach alone cannot open members", r.status === 403 && r.data.error === "not-admin", r);
  r = await coach.call("POST", "/api/admin/settings", {});
  check("…nor the switches", r.status === 403, r.status);
  r = await coach.call("POST", "/api/stats", {});
  check("…but the dashboard is theirs", r.status === 200 && Array.isArray(r.data.weeks), r.status);
  r = await coach.call("POST", "/api/admin/sessions", { action: "list" });
  check("…and this week's sessions, to read", r.status === 200, r.status);
  r = await coach.call("POST", "/api/admin/sessions", { action: "delete", id: "nothing" });
  check("…but not to remove one", r.status === 403 && r.data.error === "not-admin", r);
  r = await coach.call("POST", "/api/admin/schedule", { action: "list" });
  check("…and the standing week, to read", r.status === 200, r.status);
  r = await coach.call("POST", "/api/admin/schedule", { action: "delete", id: "nothing" });
  check("…but not to edit it", r.status === 403, r.status);
  r = await coach.call("POST", "/api/tips-admin", {});
  check("…and the articles, which are not the club", r.status === 200, r.status);
  // The one action on the coach tier that writes a row is bounded, so the
  // calendar cannot be filled with sessions nobody asked for.
  r = await coach.call("POST", "/api/admin/sessions", { action: "open", schedule_id: "x", date: "2087-01-01" });
  check("…and a code cannot be opened for 2087", r.status === 400 && r.data.error === "bad-date", r);
  // A coach cookie must not be what stops the club password working: it is
  // the documented way back when an account is lost.
  r = await coach.call("POST", "/api/admin/settings", { password: ADMIN });
  check("…but the club password still gets through a coach cookie", r.status === 200, r.status);

  /* The club password is the only thing that can make the first admin, for
     the same reason it makes the first coach. */
  r = await anon.call("POST", "/api/admin/members", { password: ADMIN, action: "admin", id: "nobody-" + stamp, admin: true });
  check("promoting a stranger is refused", r.status === 404 && r.data.error === "no-member", r);
  r = await anon.call("POST", "/api/admin/members", { password: ADMIN, action: "admin", id: coachId, admin: true });
  check("the club password makes an admin", r.status === 200 && !!r.data.members.find((m) => m.id === coachId).is_admin, r);

  /* From here they need no password at all. */
  r = await coach.call("POST", "/api/admin/members", {});
  check("the coach's login opens members", r.status === 200 && Array.isArray(r.data.members), r.status);
  r = await coach.call("POST", "/api/admin/sessions", {});
  check("…and sessions", r.status === 200, r.status);
  r = await coach.call("POST", "/api/admin/settings", {});
  check("…and the settings", r.status === 200 && r.data.settings.club_name === "WE RUN", r.status);
  r = await coach.call("POST", "/api/stats", {});
  check("…and the attendance dashboard", r.status === 200 && Array.isArray(r.data.weeks), r.status);
  r = await coach.call("POST", "/api/tips-admin", {});
  check("…and the article editor", r.status === 200, r.status);
  r = await athlete.call("POST", "/api/admin/members", {});
  check("an ordinary member still cannot", r.status === 401, r.status);

  /* Taking your own admin off is the one that locks you out of the screen
     you are standing on, so somebody else has to do it. */
  r = await coach.call("POST", "/api/admin/members", { action: "admin", id: coachId, admin: false });
  check("an admin cannot demote themselves", r.status === 409 && r.data.error === "not-yourself", r);
  r = await anon.call("POST", "/api/admin/members", { password: ADMIN, action: "admin", id: coachId, admin: false });
  check("…but the club password can", r.status === 200 && !r.data.members.find((m) => m.id === coachId).is_admin, r.status);
  r = await coach.call("POST", "/api/admin/members", {});
  check("…and then the console is shut to them again", r.status === 403, r.status);
  await anon.call("POST", "/api/admin/members", { password: ADMIN, action: "admin", id: coachId, admin: true });

  /* Posts. */
  r = await coach.call("GET", "/api/feed");
  const before = (r.data.posts || []).length;
  check("the feed answers a member", r.status === 200 && Array.isArray(r.data.posts), r);

  r = await coach.call("POST", "/api/admin/posts", { action: "save", post: { title_en: "", title_ar: "" } });
  check("a post with no title is refused", r.status === 400 && r.data.error === "bad-title", r);

  r = await coach.call("POST", "/api/admin/posts", {
    action: "save",
    post: { title_en: "Draft notice", title_ar: "مسودة", body_en: "Not ready.", body_ar: "غير جاهز." },
  });
  check("a draft saves", r.status === 200 && r.data.posts.some((p) => p.title_en === "Draft notice"), r.status);
  const draft = r.data.posts.find((p) => p.title_en === "Draft notice");
  check("a draft has no publish date", draft && draft.published_at === null, draft);

  r = await athlete.call("GET", "/api/feed");
  check("a draft is not in the feed", !(r.data.posts || []).some((p) => p.id === draft.id), r.data.posts);

  r = await coach.call("POST", "/api/admin/posts", {
    action: "save",
    post: { id: draft.id, title_en: "Race entries close Friday", title_ar: "التسجيل يقفل الجمعة", body_en: "Tell the group.", body_ar: "بلّغ المجموعة.", publish: true },
  });
  check("publishing gives it a date", r.status === 200 && !!r.data.posts.find((p) => p.id === draft.id).published_at, r.status);

  r = await athlete.call("GET", "/api/feed");
  check("and now the club can read it", (r.data.posts || []).some((p) => p.id === draft.id), r.data.posts);
  check("both languages travel with it", (r.data.posts || []).some((p) => p.title_ar === "التسجيل يقفل الجمعة"), r.data.posts);

  /* A second post, pinned, to prove the order. */
  r = await coach.call("POST", "/api/admin/posts", {
    action: "save",
    post: { title_en: "Meet at the gate", title_ar: "نلتقي عند البوابة", pinned: true, publish: true },
  });
  const pinned = r.data.posts.find((p) => p.title_en === "Meet at the gate");
  r = await athlete.call("GET", "/api/feed");
  check("a pinned post comes first", (r.data.posts || [])[0] && r.data.posts[0].id === pinned.id, (r.data.posts || []).map((p) => p.title_en));

  /* Written on Friday for Sunday. */
  const later = new Date(Date.now() + 3 * 86400 * 1000).toISOString();
  r = await coach.call("POST", "/api/admin/posts", {
    action: "save",
    post: { title_en: "Sunday long run", title_ar: "جري طويل الأحد", publish_at: later },
  });
  const scheduled = r.data.posts.find((p) => p.title_en === "Sunday long run");
  r = await athlete.call("GET", "/api/feed");
  check("a post dated ahead is not out yet", !(r.data.posts || []).some((p) => p.id === scheduled.id), r.data.posts.map((p) => p.title_en));

  r = await coach.call("POST", "/api/admin/posts", { action: "save", post: { id: pinned.id, title_en: "Meet at the gate", publish: false } });
  r = await athlete.call("GET", "/api/feed");
  check("unpublishing takes it back down", !(r.data.posts || []).some((p) => p.id === pinned.id), r.data.posts.map((p) => p.title_en));

  r = await coach.call("POST", "/api/admin/posts", { action: "delete", id: scheduled.id });
  check("delete removes it", r.status === 200 && !r.data.posts.some((p) => p.id === scheduled.id), r.status);

  r = await anon.call("GET", "/api/feed");
  check("the feed is not public", r.status === 401, r);

  /* Settings the app reads. */
  r = await coach.call("POST", "/api/admin/settings", { set: { announcement_en: "Track closed Thursday", announcement_ar: "المضمار مغلق الخميس" } });
  check("an announcement saves", r.status === 200 && r.data.settings.announcement_en === "Track closed Thursday", r.status);
  r = await athlete.call("GET", "/api/auth/me");
  check("and reaches the app through /me", r.data.club && r.data.club.announcement_ar === "المضمار مغلق الخميس", r.data.club);
  await coach.call("POST", "/api/admin/settings", { set: { announcement_en: "", announcement_ar: "" } });

  /* Maintenance: athletes held, coach working, nobody locked out. */
  r = await coach.call("POST", "/api/admin/settings", { set: { maintenance: true } });
  check("maintenance goes on", r.status === 200 && r.data.settings.maintenance === true, r.status);
  // Settings are cached per isolate for a minute, so watch for the change to
  // take rather than sleeping a guess.
  check("…and takes effect", await waitFor(async () => (await athlete.call("GET", "/api/week")).status === 503), "the week stayed open");

  r = await athlete.call("GET", "/api/week");
  check("athletes are held out of the week", r.status === 503 && r.data.error === "maintenance", r);
  r = await athlete.call("GET", "/api/feed");
  check("…and out of the feed", r.status === 503 && r.data.error === "maintenance", r.status);
  r = await coach.call("GET", "/api/week");
  check("the coach still gets through", r.status === 200, r.status);

  const again = who();
  r = await again.call("POST", "/api/auth/login", { email: athleteEmail, password: pw });
  check("logging in still works in maintenance", r.status === 200, r);
  r = await again.call("GET", "/api/auth/me");
  check("…and /me answers", r.status === 200 && !!r.data.user, r.status);
  check("…and says the site is down", r.data.club && r.data.club.maintenance === true, r.data.club);
  r = await again.call("POST", "/api/auth/logout");
  check("…and so does logging out", r.status === 200, r.status);

  await coach.call("POST", "/api/admin/settings", { set: { maintenance: false } });
  check("and the week comes back", await waitFor(async () => (await athlete.call("GET", "/api/week")).status === 200), "the week stayed shut");

  /* Tidy up what this run added to the feed. */
  r = await coach.call("POST", "/api/admin/posts", { action: "list" });
  for (const p of r.data.posts || []) {
    if (["Race entries close Friday", "Meet at the gate"].includes(p.title_en)) {
      await coach.call("POST", "/api/admin/posts", { action: "delete", id: p.id });
    }
  }
  r = await athlete.call("GET", "/api/feed");
  check("the feed is back where it started", (r.data.posts || []).length === before, (r.data.posts || []).length);

  console.log(failures ? "\n" + failures + " failure(s)." : "\nAll passed.");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("smoke-feed: " + (e.stack || e));
  process.exit(1);
});
