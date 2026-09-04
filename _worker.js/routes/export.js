/* The club's own data, back out again.

   A coach should never be locked into this site: two buttons hand over the
   members and the whole points ledger as CSV, which opens in Excel, Numbers
   and Sheets alike. */

import { json, readBody } from "../lib/http.js";
import { refuseUnlessCoach } from "../lib/auth.js";

const CAP = 5000;

/**
 * One CSV cell.
 *
 * Quoted whenever it holds a comma, a quote or a newline, with quotes
 * doubled — and a leading ' when the text opens with =, +, - or @, because
 * a spreadsheet reads those as the start of a formula. A member called
 * "=cmd" is unlikely; a club that hands its data to a spreadsheet without
 * thinking about it is not.
 */
function cell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const csv = (header, rows) =>
  [header.map(cell).join(",")].concat(rows.map((r) => r.map(cell).join(","))).join("\r\n") + "\r\n";

/* A BOM so Excel on Windows opens Arabic names as Arabic rather than mojibake,
   and no-store because this is every member's address in one file. */
const asFile = (name, body) =>
  new Response("﻿" + body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="' + name + '"',
      "cache-control": "no-store",
    },
  });

/* ---------- POST /api/admin/export ---------------------------------------- */

export async function adminExport(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  const what = String(body.what || "members");
  const day = new Date().toISOString().slice(0, 10);

  if (what === "members") {
    const rows = await env.DB.prepare(
      "SELECT u.name, u.email, u.role, u.status, u.lang, u.gender, u.birth_year, u.created_at, u.last_seen_at, u.email_verified_at," +
        " COALESCE((SELECT SUM(delta) FROM points_ledger p WHERE p.user_id = u.id), 0) AS points," +
        " (SELECT COUNT(*) FROM checkins c WHERE c.user_id = u.id AND c.voided_at IS NULL) AS checkins" +
        " FROM users u ORDER BY u.created_at ASC LIMIT ?"
    )
      .bind(CAP)
      .all();
    return asFile(
      "werun-members-" + day + ".csv",
      csv(
        ["name", "email", "role", "status", "language", "gender", "birth year", "age", "joined", "last seen", "email confirmed", "points", "check-ins"],
        (rows.results || []).map((m) => [
          m.name, m.email, m.role, m.status, m.lang, m.gender || "", m.birth_year || "",
          m.birth_year ? new Date().getUTCFullYear() - m.birth_year : "",
          m.created_at, m.last_seen_at || "",
          m.email_verified_at || "", m.points, m.checkins,
        ])
      )
    );
  }

  if (what === "points") {
    // The ledger with a name against each row, so the file explains itself
    // without a second export to join it to.
    const rows = await env.DB.prepare(
      "SELECT p.at, u.name, u.email, p.delta, p.reason, p.note FROM points_ledger p" +
        " JOIN users u ON u.id = p.user_id ORDER BY p.at ASC LIMIT ?"
    )
      .bind(CAP)
      .all();
    return asFile(
      "werun-points-" + day + ".csv",
      csv(
        ["when", "name", "email", "points", "reason", "note"],
        (rows.results || []).map((p) => [p.at, p.name, p.email, p.delta, p.reason, p.note || ""])
      )
    );
  }

  if (what === "checkins") {
    const rows = await env.DB.prepare(
      "SELECT c.at, s.date, s.name AS session, u.name, u.email, c.method, c.voided_at" +
        " FROM checkins c JOIN users u ON u.id = c.user_id JOIN club_sessions s ON s.id = c.session_id" +
        " ORDER BY c.at ASC LIMIT ?"
    )
      .bind(CAP)
      .all();
    return asFile(
      "werun-checkins-" + day + ".csv",
      csv(
        ["when", "session date", "session", "name", "email", "how", "voided"],
        (rows.results || []).map((c) => [c.at, c.date, c.session, c.name, c.email, c.method, c.voided_at || ""])
      )
    );
  }

  return json({ error: "bad-request" }, 400);
}
