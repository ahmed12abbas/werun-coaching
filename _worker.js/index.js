/* =========================================================================
   WE RUN Coaching — the server side.

   Cloudflare Pages "advanced mode": `_worker.js/` at the root of the uploaded
   site handles every request, forwarding anything that is not an API route
   to the static files. The name is reserved, so unlike a functions/ directory
   none of this is ever served — the deploy would otherwise put the server
   source up as downloadable assets. Wrangler bundles the directory on deploy.

   The routes, the public ones first:
     POST /api/feedback         — one athlete's stars, name and comment
     GET  /api/tips             — the one article the coach has put live
     GET  /api/health           — which bindings are live; no data
     GET  /api/about            — the Who Are We page as an admin last saved it
     GET  /api/about/img?id=    — a photo uploaded for that page

     POST /api/auth/signup      — join the club          (rate-limited, has a switch)
     POST /api/auth/login       — log in                 (rate-limited)
     POST /api/auth/logout      — this device
     POST /api/auth/logout-all  — every device           (logged in)
     GET  /api/auth/me          — who am I; null when nobody
     POST /api/auth/profile     — name, language         (logged in)
     POST /api/auth/password    — change password        (logged in)
     POST /api/auth/verify/send — post me a confirmation link (logged in)
     POST /api/auth/verify      — spend that link
     POST /api/auth/reset/request — post me a new-password link
     POST /api/auth/reset       — spend that link
     GET  /api/week?start=      — seven days, Sunday first: the standing week,
                                  what has changed about it, and anything
                                  published                        (logged in)
     GET  /api/session?id=      — one session, payload and all (logged in)
     POST /api/checkin          — a scanned code, into points        (logged in)
     POST /api/signups          — put my name down for a session, or take it
                                  off again                         (logged in)
     GET  /api/points/me        — total, streak, history             (logged in)
     GET  /api/points/board     — the club leaderboard               (logged in)
     GET  /api/members/search   — a runner by name, as the board shows them (logged in)
     GET  /api/feed             — the club's posts and the live tip   (logged in)
     GET  /api/store            — what is for sale, and my orders     (logged in)
     GET  /api/store/order?id=  — one of my orders                    (logged in)
     POST /api/store/checkout   — start a payment on Stripe's page    (logged in)
     POST /api/stripe/webhook   — Stripe telling us it was paid (signature-checked,
                                  and the only public route that changes money)
     POST /api/points/board-visibility — on or off the board         (logged in)
     POST /api/strava           — connect/disconnect, and the Home card (logged in)
     GET  /api/strava/callback  — Strava sending the browser back (state-checked)
     POST /api/coros            — the same for COROS, through its self-service MCP (logged in)
     GET  /api/coros/callback   — COROS sending the browser back (state- and PKCE-checked)
     POST /api/intervals           — the same for Intervals.icu (logged in)
     GET  /api/intervals/callback  — Intervals.icu sending the browser back (state-checked)

   Two guards, both in lib/auth.js, both taking either a login or the club
   password in the body. refuseUnlessCoach() is the track — what a coach needs
   standing at the gate. refuseUnlessAdmin() is everything that changes the
   club. See migrations/0010_admin.sql for why they are two columns and not
   one ladder.

   The track:
     POST /api/stats            — the dashboard: who came, week by week, and feedback
     POST /api/admin/qr         — the code for the track
     POST /api/admin/sessions   — list, roster, open  (the rest is the club's)
     POST /api/admin/schedule   — list                (the rest is the club's)
     POST /api/coach/rota       — who is taking which session this week; the
                                  coaches' own rota, which no athlete sees
     POST /api/tips-admin       — the article editor; its own TIPS_PASSWORD as
                                  well, and its own audience. Writing the
                                  club's articles is not running the club.

   The club, admins only:
     POST /api/feedback-admin   — takes one note down
     POST /api/admin/members    — the members list, block/unblock/role/admin
     POST /api/admin/coaches    — who coaches, and who could
     POST /api/admin/settings   — the switches
     POST /api/admin/sessions   — publish, void, delete
     POST /api/admin/posts      — the feed editor
     POST /api/admin/export     — members, points or check-ins as CSV
     POST /api/admin/products   — what is for sale
     POST /api/admin/orders     — who is owed one, and handing it over
     POST /api/admin/schedule   — saving and deleting a standing slot
     POST /api/admin/schedule-change — one occurrence moved or called off
     POST /api/admin/about      — the Who Are We page editor, and its photos

   Bindings, all set on the Pages project (see the README):
     STATS           KV namespace holding the feedback and articles
     DB              D1 database for the platform (docs/PLATFORM-PLAN.md)
     ADMIN_PASSWORD  secret the dashboard checks against
     TIPS_PASSWORD   secret the article editor also accepts
     QR_SECRET       signs the check-in codes
     RESEND_API_KEY  sends the confirmation and password-reset mail (optional)
     EMAIL_FROM      who that mail comes from, e.g. "WE RUN <coach@…>"
     STRIPE_SECRET_KEY      switches the shop on (optional)
     STRIPE_WEBHOOK_SECRET  what the webhook's signature is checked against
     STRAVA_CLIENT_ID       switches the Home Strava card on (optional)
     STRAVA_CLIENT_SECRET   its pair, from strava.com/settings/api
     INTERVALS_CLIENT_ID     switches the Home Intervals.icu card on (optional)
     INTERVALS_CLIENT_SECRET its pair, from intervals.icu/settings/apps (client id 961)
     TELEGRAM_BOT_TOKEN     counts the Telegram group on /about (optional; bot added to the group)
     TELEGRAM_CHAT_ID       that group's id, if the Worker should not find it itself (optional)
   Without them the site still works: the dashboard stays locked rather than
   falling open, and the platform routes answer "no-db" instead of crashing.

   Layout
     lib/     things every route needs: responses, crypto, rate limits, KV docs, auth, settings
     routes/  one file per feature, each exporting its handlers
   ========================================================================= */

import { json } from "./lib/http.js";
import { stats } from "./routes/stats.js";
import { feedback, feedbackAdmin } from "./routes/feedback.js";
import { tips, tipsAdmin } from "./routes/tips.js";
import { health } from "./routes/health.js";
import { signup, login, logout, logoutAll, me, profile, password } from "./routes/auth.js";
import { week, session } from "./routes/sessions.js";
import { members, settings, coaches } from "./routes/admin.js";
import { adminSessions, adminQr } from "./routes/schedule.js";
import { checkin } from "./routes/checkin.js";
import { pointsMe, pointsBoard, boardVisibility, memberSearch } from "./routes/points.js";
import { feed, adminPosts } from "./routes/feed.js";
import { verifySend, verify, resetRequest, reset } from "./routes/email.js";
import { adminExport } from "./routes/export.js";
import { store, checkout, order } from "./routes/store.js";
import { stripeWebhook } from "./routes/stripe.js";
import { adminProducts, adminOrders } from "./routes/shop.js";
import { adminSchedule, adminScheduleChange } from "./routes/plan.js";
import { coachRota } from "./routes/rota.js";
import { signups } from "./routes/signups.js";
import { push, pushNext } from "./routes/push.js";
import { reactions } from "./routes/reactions.js";
import { strava, stravaCallback } from "./routes/strava.js";
import { coros, corosCallback } from "./routes/coros.js";
import { intervals, intervalsCallback } from "./routes/intervals.js";
import { about, aboutImg, adminAbout } from "./routes/about.js";

const POST = {
  "/api/feedback": feedback,
  "/api/stats": stats,
  "/api/tips-admin": tipsAdmin,
  "/api/feedback-admin": feedbackAdmin,
  "/api/auth/signup": signup,
  "/api/auth/login": login,
  "/api/auth/logout": logout,
  "/api/auth/logout-all": logoutAll,
  "/api/auth/profile": profile,
  "/api/auth/password": password,
  "/api/auth/verify/send": verifySend,
  "/api/auth/verify": verify,
  "/api/auth/reset/request": resetRequest,
  "/api/auth/reset": reset,
  "/api/checkin": checkin,
  "/api/points/board-visibility": boardVisibility,
  "/api/admin/members": members,
  "/api/admin/coaches": coaches,
  "/api/admin/settings": settings,
  "/api/admin/sessions": adminSessions,
  "/api/admin/qr": adminQr,
  "/api/admin/posts": adminPosts,
  "/api/admin/export": adminExport,
  "/api/store/checkout": checkout,
  "/api/stripe/webhook": stripeWebhook,
  "/api/admin/products": adminProducts,
  "/api/admin/orders": adminOrders,
  "/api/admin/schedule": adminSchedule,
  "/api/admin/schedule-change": adminScheduleChange,
  "/api/coach/rota": coachRota,
  "/api/signups": signups,
  "/api/push": push,
  "/api/reactions": reactions,
  "/api/strava": strava,
  "/api/coros": coros,
  "/api/intervals": intervals,
  "/api/admin/about": adminAbout,
};
const GET = {
  "/api/tips": tips,
  "/api/health": health,
  "/api/auth/me": me,
  "/api/week": week,
  "/api/session": session,
  "/api/points/me": pointsMe,
  "/api/points/board": pointsBoard,
  "/api/members/search": memberSearch,
  "/api/feed": feed,
  "/api/store": store,
  "/api/store/order": order,
  "/api/push/next": pushNext,
  "/api/strava/callback": stravaCallback,
  "/api/coros/callback": corosCallback,
  "/api/intervals/callback": intervalsCallback,
  "/api/about": about,
  "/api/about/img": aboutImg,
};

/* What every answer carries, static file and API alike.

   Not a `_headers` file: in Pages advanced mode this Worker answers first and
   `_headers` is never applied to what it returns, so the one place certain to
   be on every response is here.

   The policy allows inline script because admin.html and tips.html are
   written that way and there is no build step to hash them. What it still
   stops is the half that matters: a script, a fetch or a form reaching an
   origin that is not this one, so an injected string has nowhere to send a
   cookie or a roster. The camera is the check-in scanner (js/scan.js);
   nothing else on the page is wanted. */
const SECURITY = {
  "content-security-policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; connect-src 'self'; media-src 'self'; " +
    "frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(self), microphone=(), geolocation=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
};

/* Every deploy also answers at its own <hash>.weruncoaching.pages.dev, on the
   live database and the live QR key, running that day's code forever. A coach
   who opened the app there hands out codes pointing there — where no athlete
   is logged in. So every such address goes to the one the club uses. */
const HOME = "weruncoaching.pages.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.endsWith("." + HOME)) {
      url.hostname = HOME;
      return Response.redirect(url.toString(), 308);
    }
    const res = await route(request, env);
    // Asset responses arrive with immutable headers, so harden a copy.
    const out = new Response(res.body, res);
    for (const k in SECURITY) out.headers.set(k, SECURITY[k]);
    // A ?v= stamp is the file's own hash (tools/version-assets.js), so a
    // changed file is a changed URL. Pages sends max-age=0, which cost every
    // visit a round trip per script just to hear "not modified".
    if (res.ok && new URL(request.url).searchParams.has("v")) {
      out.headers.set("cache-control", "public, max-age=31536000, immutable");
    }
    return out;
  },
};

async function route(request, env) {
  const { pathname } = new URL(request.url);
  try {
    if (GET[pathname]) {
      if (request.method !== "GET") return json({ error: "method-not-allowed" }, 405);
      return await GET[pathname](request, env);
    }
    const handler = POST[pathname];
    if (handler) {
      if (request.method !== "POST") return json({ error: "method-not-allowed" }, 405);
      return await handler(request, env);
    }
  } catch (e) {
    // The message goes to the Worker log, never to the page: an athlete
    // gets a plain "try again", a coach reads the details in the dashboard.
    console.error("api " + pathname + ": " + (e && e.stack ? e.stack : e));
    return json({ error: "server" }, 500);
  }
  // Pages leaves _worker.js/ out of the uploaded assets, but the local dev
  // server does not, and the source has no business on the wire either way.
  if (pathname.startsWith("/_worker.js")) return new Response("Not found", { status: 404 });
  return env.ASSETS.fetch(request); // every real page and file
}
