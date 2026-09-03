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
  };
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        // Ours only: not wrangler's migration ledger, not sqlite's own bookkeeping.
        "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'" +
          " AND name NOT LIKE 'd1\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'"
      ).first();
      out.tables = (row && row.n) || 0;
    } catch (e) {
      out.ok = false;
      out.error = "db-unreachable";
    }
  }
  return json(out, out.ok ? 200 : 503);
}
