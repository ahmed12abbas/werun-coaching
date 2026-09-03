/* =========================================================================
   WE RUN Coaching — the server side.

   Cloudflare Pages "advanced mode": `_worker.js/` at the root of the uploaded
   site handles every request, forwarding anything that is not an API route
   to the static files. The name is reserved, so unlike a functions/ directory
   none of this is ever served — the deploy would otherwise put the server
   source up as downloadable assets. Wrangler bundles the directory on deploy.

   The routes, the public ones first:
     POST /api/share          — beacon; counts one tap of "Share this session"
     POST /api/feedback       — one athlete's stars, name and comment
     GET  /api/tips           — the one article the coach has put live
     GET  /api/health         — which bindings are live; no data
     POST /api/stats         — the dashboard: counts and feedback, password-gated
     POST /api/feedback-admin — takes one note down, password-gated
     POST /api/tips-admin     — the article editor, password-gated

   Bindings, all set on the Pages project (see the README):
     STATS           KV namespace holding the counts, feedback and articles
     DB              D1 database for the platform (docs/PLATFORM-PLAN.md)
     ADMIN_PASSWORD  secret the dashboard checks against
     TIPS_PASSWORD   secret the article editor also accepts
     QR_SECRET       signs the check-in codes
   Without them the site still works: sharing just is not counted, and the
   dashboard stays locked rather than falling open.

   Layout
     lib/     things every route needs: responses, crypto, rate limits, KV docs
     routes/  one file per feature, each exporting its handlers
   ========================================================================= */

import { json } from "./lib/http.js";
import { share, stats } from "./routes/share.js";
import { feedback, feedbackAdmin } from "./routes/feedback.js";
import { tips, tipsAdmin } from "./routes/tips.js";
import { health } from "./routes/health.js";

const POST = {
  "/api/share": share,
  "/api/feedback": feedback,
  "/api/stats": stats,
  "/api/tips-admin": tipsAdmin,
  "/api/feedback-admin": feedbackAdmin,
};
const GET = { "/api/tips": tips, "/api/health": health };

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (GET[pathname]) return GET[pathname](request, env);
    const handler = POST[pathname];
    if (!handler) {
      // Pages leaves _worker.js/ out of the uploaded assets, but the local dev
      // server does not, and the source has no business on the wire either way.
      if (pathname.startsWith("/_worker.js")) return new Response("Not found", { status: 404 });
      return env.ASSETS.fetch(request); // every real page and file
    }
    if (request.method !== "POST") {
      return json({ error: "method-not-allowed" }, 405);
    }
    return handler(request, env);
  },
};
