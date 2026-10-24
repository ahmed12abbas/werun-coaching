/**
 * Comments under the news, against a running site.
 *
 *   node tools/dev.js                  (in one terminal)
 *   node tools/smoke-comments.js       (in another)
 *
 * A member comments, the feed counts it, another member cannot take it down,
 * an admin can, and nobody logged out sees a thread at all.
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
    const m = /werun_s=([^;]*)/.exec(res.headers.get("set-cookie") || "");
    if (m) it.cookie = m[1] ? "werun_s=" + m[1] : "";
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    return { status: res.status, data };
  };
  return it;
}

function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || !detail ? "" : "  -> " + JSON.stringify(detail)));
  if (!ok) failures++;
}

(async () => {
  const stamp = Date.now().toString(36);
  const pw = "correct-horse-" + stamp;
  const a = who();
  const b = who();
  const boss = who();
  const anon = who();

  await a.call("POST", "/api/auth/signup", { name: "Writer", email: "cm-a+" + stamp + "@example.invalid", password: pw });
  await b.call("POST", "/api/auth/signup", { name: "Other", email: "cm-b+" + stamp + "@example.invalid", password: pw });
  let r = await boss.call("POST", "/api/auth/signup", { name: "Boss", email: "cm-c+" + stamp + "@example.invalid", password: pw });
  await anon.call("POST", "/api/admin/members", { password: ADMIN, action: "admin", id: r.data.user.id, admin: true });

  // A post to hang the thread on.
  r = await anon.call("POST", "/api/admin/posts", { password: ADMIN, action: "save", post: { title_en: "Thread " + stamp, body_en: "Hi", publish: true } });
  const post = r.data && (r.data.posts || []).find((p) => p.title_en === "Thread " + stamp);
  check("a post goes up", !!post, r);
  const target = "post:" + post.id;

  r = await anon.call("POST", "/api/comments", { action: "list", target });
  check("logged out sees no thread", r.status === 401, r.status);

  r = await a.call("POST", "/api/comments", { action: "add", target, text: "  See you Sunday  " });
  check("a member comments", r.status === 200 && r.data.comments.length === 1 && r.data.comments[0].body === "See you Sunday", r);
  const id = r.data.comments[0].id;
  check("it is theirs to delete", r.data.comments[0].can_delete === true);

  r = await a.call("POST", "/api/comments", { action: "add", target, text: "   " });
  check("an empty comment is refused", r.status === 400, r.status);
  r = await a.call("POST", "/api/comments", { action: "add", target: "nope:1", text: "x" });
  check("an unknown target is refused", r.status === 400, r.status);
  r = await a.call("POST", "/api/comments", { action: "add", target: "post:made-up-" + Date.now(), text: "x" });
  check("a post that does not exist cannot grow a thread", r.status === 404, r.status);
  r = await a.call("POST", "/api/reactions", { target: "tip:made-up", emoji: "🔥" });
  check("…nor take a reaction", r.status === 404, r.status);

  r = await b.call("GET", "/api/feed");
  check("the feed counts it", r.data && r.data.comments && r.data.comments[target] === 1, r.data && r.data.comments);

  r = await b.call("POST", "/api/comments", { action: "list", target });
  check("another member reads it, cannot delete it", r.status === 200 && r.data.comments[0].can_delete === false, r);
  r = await b.call("POST", "/api/comments", { action: "delete", id });
  check("…and is refused if they try", r.status === 403, r.status);

  r = await boss.call("POST", "/api/comments", { action: "delete", id });
  check("an admin takes it down", r.status === 200 && r.data.comments.length === 0, r);

  console.log(failures ? failures + " failed" : "all passed");
  process.exit(failures ? 1 : 0);
})();
