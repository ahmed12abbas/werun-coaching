/* Is everything plugged in? For the deploy check and for a coach wondering. */

import { json } from "../lib/http.js";

/* ---------- GET /api/health ---------------------------------------------- */

/*
 * Says which bindings the Worker can see and whether the database has its
 * tables, and nothing else — no counts, no names, no secrets' values. The
 * bindings workflow polls this after a redeploy; a person can open it too.
 */
function bindingsSeen(env) {
  return {
    ok: true,
    store: !!env.STATS,
    db: !!env.DB,
    tables: 0,
    admin: !!env.ADMIN_PASSWORD,
    tips: !!(env.TIPS_PASSWORD || env.ADMIN_PASSWORD),
    qr: !!env.QR_SECRET,
    email: !!env.RESEND_API_KEY,
    // `store` is the KV namespace, above — the shop's own key gets its own
    // name. They were both called `store` for a while, and since an object
    // literal keeps the last of two identical keys, the KV answer was the
    // one being thrown away: the bindings workflow polls `.store` to see the
    // namespace and waited five minutes for a key it was never being shown.
    stripe: !!env.STRIPE_SECRET_KEY,
    webhook: !!env.STRIPE_WEBHOOK_SECRET,
    push: !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE),
  };
}

/* A list, not one field: the site can be wrong in more than one way at a
   time, and a check that reports only the last of them is a check that hides
   the others. Everything here is either a development-only switch that has
   escaped, or a half-configured feature that will fail quietly. */
const WARNINGS = [
  // Hands the confirmation and password-reset links back in the response
  // instead of mailing them. Never set on the live site.
  ["email-echo-on", (env) => env.EMAIL_ECHO === "1"],
  // Sends checkout somewhere that is not Stripe. Never set on the live site.
  ["stripe-api-base-overridden", (env) => env.STRIPE_API_BASE],
  // A shop that can take money but cannot hear that it was paid leaves every
  // order stuck at pending for ever.
  ["stripe-webhook-missing", (env) => env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET],
  // Half a push setup: athletes can turn reminders on and nothing will ever
  // knock, or the sender is pokeable by nobody. Both fail in silence.
  ["vapid-half-set", (env) => !!env.VAPID_PUBLIC !== !!env.VAPID_PRIVATE],
  ["push-secret-missing", (env) => env.VAPID_PUBLIC && env.VAPID_PRIVATE && !env.PUSH_SECRET],
];

// Ours only: not wrangler's migration ledger, not sqlite's own bookkeeping.
const OUR_TABLES =
  "FROM sqlite_master WHERE type = 'table'" +
  " AND name NOT LIKE 'd1\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'";

async function countTables(env, out) {
  try {
    const row = await env.DB.prepare("SELECT count(*) AS n " + OUR_TABLES).first();
    out.tables = (row && row.n) || 0;
    // The names, not just the count: when a migration has not landed, the
    // difference between what is there and what should be is the whole
    // diagnosis, and counting to ten by hand is nobody's idea of a check.
    const all = await env.DB.prepare("SELECT name " + OUR_TABLES + " ORDER BY name").all();
    out.table_names = (all.results || []).map((r) => r.name);
  } catch (e) {
    out.ok = false;
    out.error = "db-unreachable";
  }
}

export async function health(request, env) {
  const out = bindingsSeen(env);
  out.warnings = WARNINGS.filter(([, on]) => on(env)).map(([name]) => name);
  if (env.DB) await countTables(env, out);
  return json(out, out.ok ? 200 : 503);
}
