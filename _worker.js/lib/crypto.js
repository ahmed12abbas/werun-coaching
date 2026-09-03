/* WebCrypto, wrapped for the two or three shapes the routes need. */

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
