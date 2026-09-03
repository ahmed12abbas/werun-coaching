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
