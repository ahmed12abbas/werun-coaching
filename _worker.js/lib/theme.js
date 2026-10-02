/* The club's look, as an admin set it in /admin: one brand colour and two
   uploaded images, the app logo and the intro (the splash on open).

   Written into the page on its way out rather than fetched by the page, so
   the first paint is already in the club's colour and the splash already
   shows the right logo — a script that asked afterwards would flash purple
   first. All three are checked when saved (routes/admin.js): a #rrggbb and
   our own /api/brand/img addresses, nothing else ever reaches the markup.

   The consoles (/admin, /coach, /tips) keep their own copy of the tokens and
   are left alone: they are staff screens, not the app. */

import { getSetting } from "./settings.js";

const STAFF = /^\/(admin|coach|tips)(\.html)?$/;

/* One colour, and the rest worked out from it the way the shipped palette
   was: a darker one for text on soft fills, a pale wash, and a lighter
   version for the dark theme. The national-day theme in app.css is a more
   specific selector, so it still wins for its week. */
const css = (c) =>
  ":root{--brand:" + c + ";--work:" + c + ";--repeat:" + c +
  ";--brand-deep:color-mix(in srgb," + c + " 70%,#000);--brand-soft:color-mix(in srgb," + c + " 10%,#fff)}" +
  ':root[data-theme="dark"]{--brand:color-mix(in srgb,' + c + " 75%,#fff);--work:var(--brand);--repeat:var(--brand)" +
  ";--brand-deep:color-mix(in srgb," + c + " 50%,#fff);--brand-soft:color-mix(in srgb," + c + " 20%,#101019)}";

async function themeOf(env) {
  if (!env.DB) return null;
  const [color, logo, intro, swoosh] = await Promise.all([
    getSetting(env, "theme_color"),
    getSetting(env, "logo_url"),
    getSetting(env, "intro_url"),
    getSetting(env, "intro_swoosh"),
  ]);
  return color || logo || intro || swoosh === false ? { color, logo, intro, swoosh } : null;
}

/** The static file for `request`, with the club's theme written into it if it is a page. */
export async function themedAsset(request, env) {
  const { pathname } = new URL(request.url);
  const theme = STAFF.test(pathname) ? null : await themeOf(env);
  const page = theme && (request.headers.get("accept") || "").includes("text/html");
  if (!page) return env.ASSETS.fetch(request);

  // No validators either way: the file has not changed when the theme has,
  // so a 304 for its ETag would keep the old colour in the browser's cache.
  const headers = new Headers(request.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  const res = await env.ASSETS.fetch(new Request(request, { headers }));
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;

  let rw = new HTMLRewriter();
  if (theme.color) {
    rw = rw
      .on("head", { element: (e) => e.append("<style>" + css(theme.color) + "</style>", { html: true }) })
      .on('meta[name="theme-color"]', { element: (e) => e.setAttribute("content", theme.color) });
  }
  // js/brand.js reads data-logo for every logo it draws.
  if (theme.logo) rw = rw.on("html", { element: (e) => e.setAttribute("data-logo", theme.logo) });
  // app.css hides the swoosh on this attribute.
  if (theme.swoosh === false) rw = rw.on("html", { element: (e) => e.setAttribute("data-swoosh", "off") });
  if (theme.intro) rw = rw.on("img.splash-default", { element: (e) => e.setAttribute("src", theme.intro) });

  const out = rw.transform(res);
  const fresh = new Response(out.body, out);
  fresh.headers.delete("etag");
  fresh.headers.delete("last-modified");
  fresh.headers.set("cache-control", "no-cache");
  return fresh;
}
