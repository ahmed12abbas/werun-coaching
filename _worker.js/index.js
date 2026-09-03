/* =========================================================================
   WE RUN Coaching — the server side.

   Cloudflare Pages "advanced mode": `_worker.js/` at the root of the uploaded
   site handles every request, forwarding anything that is not an API route
   to the static files. The name is reserved, so unlike a functions/ directory
   none of this is ever served — the deploy would otherwise put the server
   source up as downloadable assets. Wrangler bundles the directory on deploy.

   The routes, the public ones first:
     POST /api/share            — beacon; counts one tap of "Share this session"
     POST /api/feedback         — one athlete's stars, name and comment
     GET  /api/tips             — the one article the coach has put live
     GET  /api/health           — which bindings are live; no data

     POST /api/auth/signup      — join the club          (rate-limited, has a switch)
     POST /api/auth/login       — log in                 (rate-limited)
     POST /api/auth/logout      — this device
     POST /api/auth/logout-all  — every device           (logged in)
     GET  /api/auth/me          — who am I; null when nobody
     POST /api/auth/profile     — name, language         (logged in)
     POST /api/auth/password    — change password        (logged in)
     GET  /api/week?start=      — seven days of sessions (logged in)
     GET  /api/session?id=      — one session, payload and all (logged in)
     POST /api/checkin          — a scanned code, into points        (logged in)
     GET  /api/points/me        — total, streak, history             (logged in)
     GET  /api/points/board     — the club leaderboard               (logged in)
     POST /api/points/board-visibility — on or off the board         (logged in)

     POST /api/stats            — the dashboard: counts and feedback, password-gated
     POST /api/feedback-admin   — takes one note down, password-gated
     POST /api/tips-admin       — the article editor, password-gated
     POST /api/admin/members    — the members list, block/unblock/role, password-gated
     POST /api/admin/settings   — the switches, password-gated
     POST /api/admin/sessions   — publish, roster, void, delete, password-gated
     POST /api/admin/qr         — the code for the track, password-gated

   Bindings, all set on the Pages project (see the README):
     STATS           KV namespace holding the counts, feedback, articles and rate limits
     DB              D1 database for the platform (docs/PLATFORM-PLAN.md)
     ADMIN_PASSWORD  secret the dashboard checks against
     TIPS_PASSWORD   secret the article editor also accepts
     QR_SECRET       signs the check-in codes
   Without them the site still works: sharing just is not counted, the
   dashboard stays locked rather than falling open, and the platform routes
   answer "no-db" instead of crashing.

   Layout
     lib/     things every route needs: responses, crypto, rate limits, KV docs, auth, settings
     routes/  one file per feature, each exporting its handlers
   ========================================================================= */

import { json } from "./lib/http.js";
import { share, stats } from "./routes/share.js";
import { feedback, feedbackAdmin } from "./routes/feedback.js";
import { tips, tipsAdmin } from "./routes/tips.js";
import { health } from "./routes/health.js";
import { signup, login, logout, logoutAll, me, profile, password } from "./routes/auth.js";
import { week, session } from "./routes/sessions.js";
import { members, settings } from "./routes/admin.js";
import { adminSessions, adminQr } from "./routes/schedule.js";
import { checkin } from "./routes/checkin.js";
import { pointsMe, pointsBoard, boardVisibility } from "./routes/points.js";

const POST = {
  "/api/share": share,
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
  "/api/checkin": checkin,
  "/api/points/board-visibility": boardVisibility,
  "/api/admin/members": members,
  "/api/admin/settings": settings,
  "/api/admin/sessions": adminSessions,
  "/api/admin/qr": adminQr,
};
const GET = {
  "/api/tips": tips,
  "/api/health": health,
  "/api/auth/me": me,
  "/api/week": week,
  "/api/session": session,
  "/api/points/me": pointsMe,
  "/api/points/board": pointsBoard,
};

export default {
  async fetch(request, env) {
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
  },
};
