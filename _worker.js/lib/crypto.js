/* WebCrypto, wrapped for the two or three shapes the routes need. */

import { json } from "./http.js";
import { tooOften, ipOf } from "./limit.js";

const enc = new TextEncoder();

export const hex = (bytes) =>
  Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export const sha256 = (s) => crypto.subtle.digest("SHA-256", enc.encode(s));

/**
 * Compare without leaking, through timing, how much of a guess was right.
 * Digesting both sides first makes the comparison fixed-length whatever the
 * inputs are, so neither the password nor its length shows up in the clock.
 */
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* Ten guesses a minute from one address at any of the password-gated routes.
   A coach types one password, wrongly, perhaps twice; a script trying the
   club password is after the members list — names, emails, and the power to
   promote a coach — so it does not get to try at machine speed.

   Returns a 429 Response when they have had enough, else null. */
export async function guessingTooOften(request, env) {
  if (!env.STATS) return null; // nowhere to count: the password check still stands
  if (await tooOften(env.STATS, "pwd", ipOf(request), 10, 60)) return json({ error: "too-often" }, 429);
  return null;
}
