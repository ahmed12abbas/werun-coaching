/* Is everything plugged in? For the deploy check and for a coach wondering. */

import { json } from "../lib/http.js";

/* ---------- GET /api/health ---------------------------------------------- */

/*
 * Says which bindings the Worker can see and whether the database has its
 * tables, and nothing else — no counts, no names, no secrets' values. The
 * bindings workflow polls this after a redeploy; a person can open it too.
 */
export async function health(request, env) {
  const out = {
    ok: true,
    store: !!env.STATS,
    db: !!env.DB,
    tables: 0,
    admin: !!env.ADMIN_PASSWORD,
    tips: !!(env.TIPS_PASSWORD || env.ADMIN_PASSWORD),
    qr: !!env.QR_SECRET,
    email: !!env.RESEND_API_KEY,
    store: !!env.STRIPE_SECRET_KEY,
    webhook: !!env.STRIPE_WEBHOOK_SECRET,
  };
  /* A list, not one field: the site can be wrong in more than one way at a
     time, and a check that reports only the last of them is a check that
     hides the others. Everything here is either a development-only switch
     that has escaped, or a half-configured feature that will fail quietly. */
  out.warnings = [];
  // Hands the confirmation and password-reset links back in the response
  // instead of mailing them. Never set on the live site.
  if (env.EMAIL_ECHO === "1") out.warnings.push("email-echo-on");
  // Sends checkout somewhere that is not Stripe. Never set on the live site.
  if (env.STRIPE_API_BASE) out.warnings.push("stripe-api-base-overridden");
  // A shop that can take money but cannot hear that it was paid leaves every
  // order stuck at pending for ever.
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) out.warnings.push("stripe-webhook-missing");
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        // Ours only: not wrangler's migration ledger, not sqlite's own bookkeeping.
        "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'" +
          " AND name NOT LIKE 'd1\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'"
      ).first();
      out.tables = (row && row.n) || 0;
      // The names, not just the count: when a migration has not landed, the
      // difference between what is there and what should be is the whole
      // diagnosis, and counting to ten by hand is nobody's idea of a check.
      const all = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'" +
          " AND name NOT LIKE 'd1\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'" +
          " ORDER BY name"
      ).all();
      out.table_names = (all.results || []).map((r) => r.name);
    } catch (e) {
      out.ok = false;
      out.error = "db-unreachable";
    }
  }
  return json(out, out.ok ? 200 : 503);
}
