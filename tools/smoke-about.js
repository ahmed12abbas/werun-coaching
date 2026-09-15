/**
 * The Who Are We page editor, against a running site.
 *
 *   node tools/dev.js                  (in one terminal)
 *   node tools/smoke-about.js          (in another)
 *
 * Nobody but an admin can write it; a save is cleaned of anything that is not
 * a plain value; a photo goes in and comes back out with its own type; and a
 * reset puts the shipped page back.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
 */
const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || !detail ? "" : "  -> " + JSON.stringify(detail)));
  if (!ok) failures++;
}
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.clone().json(); } catch (e) {}
  return { status: res.status, data, res };
}

// A 1x1 transparent PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

(async () => {
  let r = await call("POST", "/api/admin/about", { action: "save", doc: { sections: [] } });
  check("a stranger cannot save", r.status === 401, r);

  const doc = { sections: [
    { type: "text", show: true, title: { en: "Hello", ar: "مرحبا" }, body: { en: "x", ar: "y" }, image: "",
      __proto__x: 1, _evil: 2, Bad: 3 },
    { type: "script", show: true },
  ] };
  r = await call("POST", "/api/admin/about", { password: ADMIN, action: "save", doc });
  const s = r.data && r.data.doc && r.data.doc.sections;
  check("an admin can save", r.status === 200 && s && s.length === 1, r.data);
  check("unknown section types are dropped", s && s.every((x) => x.type !== "script"), s);
  check("odd keys are dropped", s && !("_evil" in s[0]) && !("Bad" in s[0]), s && s[0]);

  r = await call("GET", "/api/about");
  check("the page reads the saved copy", r.data && r.data.doc && r.data.doc.sections[0].title.en === "Hello", r.data);

  r = await call("POST", "/api/admin/about", { password: ADMIN, action: "upload", data: "data:image/svg+xml;base64,PHN2Zz4=" });
  check("an SVG is refused", r.status === 400 && r.data.error === "bad-image", r.data);

  r = await call("POST", "/api/admin/about", { password: ADMIN, action: "upload", data: PNG });
  const url = r.data && r.data.url;
  check("a photo uploads", r.status === 200 && /^\/api\/about\/img\?id=[a-f0-9]{32}$/.test(url || ""), r.data);
  if (url) {
    const img = await call("GET", url);
    check("and comes back as a PNG", img.status === 200 && img.res.headers.get("content-type") === "image/png",
      img.res.headers.get("content-type"));
  }
  r = await call("GET", "/api/about/img?id=nope");
  check("a made-up id is not found", r.status === 404);

  r = await call("POST", "/api/admin/about", { password: ADMIN, action: "reset" });
  r = await call("GET", "/api/about");
  check("reset brings back the shipped page", r.data && r.data.doc === null, r.data);

  console.log(failures ? failures + " failed" : "all passed");
  process.exit(failures ? 1 : 0);
})();
