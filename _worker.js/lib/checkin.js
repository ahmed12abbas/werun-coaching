/* The code on the coach's screen, and what makes it worth trusting.

   A check-in link carries three things: which session, which thirty-second
   slot it was minted for, and a signature over the pair. The signature is
   HMAC-SHA256 under QR_SECRET, which never leaves the Worker, so nobody can
   mint a link — and because the slot is inside the signed material, a code
   screenshotted and sent to the group chat is refused a minute later.

   Which leaves the honest failure mode: an athlete who really is at the
   track, scanning a code their phone read a moment ago. One slot of grace
   either side covers that without opening the door to the group chat. */

import { hex } from "./crypto.js";
import { getSetting } from "./settings.js";

export const SLOT_MS = 30000;
/** How many slots either side of the current one still count. */
const GRACE = 1;
const SIG_CHARS = 16; // 64 bits of a SHA-256 HMAC: far more than a guesser gets

export const slotNow = () => Math.floor(Date.now() / SLOT_MS);

/** Seconds until the current slot rolls over, for the screen's countdown. */
export const slotRemaining = () => Math.ceil((SLOT_MS - (Date.now() % SLOT_MS)) / 1000);

async function keyFor(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export async function signSlot(secret, sessionId, slot) {
  const key = await keyFor(secret);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sessionId + ":" + slot));
  return hex(mac).slice(0, SIG_CHARS);
}

/**
 * Is this signature right for this session and slot, and is the slot recent?
 * Compared byte by byte over the whole length, so a wrong signature takes the
 * same time however much of it was right.
 */
export async function slotValid(secret, sessionId, slot, sig) {
  if (!/^[0-9a-f]+$/.test(String(sig || "")) || String(sig).length !== SIG_CHARS) return false;
  if (!Number.isInteger(slot)) return false;
  if (Math.abs(slotNow() - slot) > GRACE) return false;

  const want = await signSlot(secret, sessionId, slot);
  let diff = 0;
  for (let i = 0; i < SIG_CHARS; i++) diff |= want.charCodeAt(i) ^ String(sig).charCodeAt(i);
  return diff === 0;
}

/** The link the QR carries. `/app`, not `/app.html`: shorter is denser. */
export const checkinUrl = (origin, sessionId, slot, sig) =>
  origin + "/app#/c/" + sessionId + "/" + slot + "/" + sig;

/* ---------- when check-in is open ----------------------------------------

   Worked out from the session's start every time it is asked, rather than
   read back from the two columns the row was written with. The window is a
   club-wide rule — "open a month out, shut two hours after the start" — and a
   rule the coach can move from the console has to move for the sessions that
   are already on the calendar too, not only the ones published after it.

   The columns are still written and still true; they are what the row said
   when it went out, and the fallback for the odd row whose start will not
   parse.
   ------------------------------------------------------------------------- */

export async function windowMinutes(env) {
  return {
    before: await getSetting(env, "window_before_min"),
    after: await getSetting(env, "window_after_min"),
  };
}

/** `{ open, close }` as ISO strings, for a session and the club's two numbers. */
export function windowFor(session, mins) {
  const at = Date.parse((session && session.starts_at) || "");
  // No rule to apply, or a start that will not parse: what the row says.
  if (!mins || !Number.isFinite(at)) {
    return { open: (session && session.window_open_at) || "", close: (session && session.window_close_at) || "" };
  }
  return {
    open: new Date(at - mins.before * 60000).toISOString(),
    close: new Date(at + mins.after * 60000).toISOString(),
  };
}
