/* Sending an email, and the two the club actually sends.

   Resend, because it is one HTTPS call with no SDK — which suits a Worker
   that ships no dependencies. Everything here degrades: with no
   RESEND_API_KEY the routes say email is switched off rather than pretending
   they sent something, exactly like the dashboard staying locked without a
   password.

   Both messages are plain text as well as HTML. A club's athletes read mail
   on phones, some of them in Arabic, and a text part is what makes that work
   everywhere. */

const ENDPOINT = "https://api.resend.com/emails";

export const emailOn = (env) => !!env.RESEND_API_KEY;

/**
 * Hands back { ok } or { ok: false, error } — never throws, because a Worker
 * that 500s on a mail provider's bad afternoon has turned their problem into
 * the club's.
 */
export async function send(env, to, subject, text, html) {
  if (!emailOn(env)) return { ok: false, error: "email-off" };
  const from = env.EMAIL_FROM || "WE RUN <onboarding@resend.dev>";
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.RESEND_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: from, to: [to], subject: subject, text: text, html: html }),
    });
    if (res.ok) return { ok: true };
    // The provider's own words go to the Worker log, never to the page: it
    // can name an address, and whoever asked is not always its owner.
    console.error("resend " + res.status + ": " + (await res.text()).slice(0, 300));
    return { ok: false, error: "email-failed" };
  } catch (e) {
    console.error("resend threw: " + (e && e.message));
    return { ok: false, error: "email-failed" };
  }
}

/* ---------- what the two letters say --------------------------------------

   Written in both languages in one message rather than picking one. The club
   runs in both, an address does not say which its owner reads, and a
   two-paragraph email is not too long. */

const shell = (club, lines) =>
  '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;' +
  'font-size:16px;line-height:1.6;color:#14121c;max-width:520px;margin:0 auto;padding:24px">' +
  '<div style="font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8851F4;' +
  'font-size:13px;margin-bottom:18px">' + escapeHtml(club) + "</div>" +
  lines.join("") +
  '<hr style="border:0;border-top:1px solid #e6e3ef;margin:26px 0 14px">' +
  '<div style="font-size:12.5px;color:#6a6580">' +
  "If you were not expecting this, ignore it and nothing changes.<br>" +
  '<span dir="rtl">إذا لم تكن تتوقع هذه الرسالة، تجاهلها ولن يتغير شيء.</span></div></div>';

const button = (url, label) =>
  '<p style="margin:22px 0"><a href="' + escapeHtml(url) + '" ' +
  'style="background:#8851F4;color:#fff;text-decoration:none;font-weight:700;' +
  'padding:13px 22px;border-radius:12px;display:inline-block">' + escapeHtml(label) + "</a></p>";

const para = (en, ar) =>
  '<p style="margin:0 0 12px">' + escapeHtml(en) + "</p>" +
  '<p dir="rtl" style="margin:0 0 12px;color:#3b3550">' + escapeHtml(ar) + "</p>";

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function verifyMail(club, url) {
  const text =
    "Confirm your email for " + club + ":\n" + url +
    "\n\nThe link works for seven days.\n\n" +
    "أكّد بريدك الإلكتروني لـ " + club + ":\n" + url + "\nالرابط صالح لسبعة أيام.\n";
  const html = shell(club, [
    para("Confirm your email so the coach can reach you.", "أكّد بريدك حتى يستطيع الكوتش التواصل معك."),
    button(url, "Confirm my email"),
    para("The link works for seven days.", "الرابط صالح لسبعة أيام."),
  ]);
  return { subject: club + " — confirm your email", text: text, html: html };
}

export function resetMail(club, url) {
  const text =
    "Set a new password for " + club + ":\n" + url +
    "\n\nThe link works for one hour, once.\n\n" +
    "عيّن كلمة مرور جديدة لـ " + club + ":\n" + url + "\nالرابط صالح لساعة واحدة، ولمرة واحدة.\n";
  const html = shell(club, [
    para("Someone asked to set a new password for your account.", "طلب أحدهم تعيين كلمة مرور جديدة لحسابك."),
    button(url, "Set a new password"),
    para("The link works for one hour, and once.", "الرابط صالح لساعة واحدة، ولمرة واحدة."),
  ]);
  return { subject: club + " — set a new password", text: text, html: html };
}
