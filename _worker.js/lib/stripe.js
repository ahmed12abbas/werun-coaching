/* Stripe, over plain HTTPS.

   No SDK: the two things this site needs are one form-encoded POST and one
   signature check, and a Worker that ships no dependencies should not grow
   one for that.

   The card never comes near us. The athlete is sent to a page Stripe hosts,
   pays there, and this site finds out from a webhook it has verified. That
   is the whole reason for Checkout rather than a payment form of our own. */

import { safeEqual } from "./crypto.js";

export const storeOn = (env) => !!env.STRIPE_SECRET_KEY;

/* Overridable so tools/smoke-store.js can point the whole flow at a stub and
   exercise it for real. Getting this wrong in production breaks checkout
   loudly on the first attempt; it cannot quietly weaken anything. */
const apiBase = (env) => (env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "");

/** Stripe's API takes form encoding, including for its bracketed nesting. */
function form(fields) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== "") body.append(k, String(v));
  }
  return body;
}

/**
 * A hosted payment page for one order.
 *
 * Hands back { ok, url } or { ok: false, error }. `orderId` travels as the
 * client reference so the webhook can find the row again without trusting
 * anything the browser says on the way back.
 */
export async function createCheckout(env, opts) {
  if (!storeOn(env)) return { ok: false, error: "store-off" };
  const body = form({
    mode: "payment",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    client_reference_id: opts.orderId,
    "metadata[order_id]": opts.orderId,
    customer_email: opts.email,
    "line_items[0][quantity]": opts.qty,
    "line_items[0][price_data][currency]": opts.currency,
    "line_items[0][price_data][unit_amount]": opts.unitAmount,
    "line_items[0][price_data][product_data][name]": opts.name,
    "line_items[0][price_data][product_data][description]": opts.description,
    // Collected by Stripe on its own page so the coach knows who to hand it
    // to; the club never stores a phone number or an address of its own.
    "phone_number_collection[enabled]": "true",
  });

  try {
    const res = await fetch(apiBase(env) + "/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.STRIPE_SECRET_KEY,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      // Stripe's own words go to the Worker log; the athlete gets a code.
      console.error("stripe " + res.status + ": " + JSON.stringify(data).slice(0, 300));
      return { ok: false, error: "store-failed" };
    }
    return { ok: true, url: data.url, sessionId: data.id };
  } catch (e) {
    console.error("stripe threw: " + (e && e.message));
    return { ok: false, error: "store-failed" };
  }
}

/* ---------- the webhook ---------------------------------------------------
   This is the part that has to be right. Without it, anyone who knows the
   URL could announce that an order was paid — so the body is checked against
   Stripe's signature before a single field of it is read, and the timestamp
   is checked too, or yesterday's genuine message could be replayed forever.
   ------------------------------------------------------------------------- */

const TOLERANCE = 5 * 60; // seconds; Stripe's own recommendation

function hexOf(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a `Stripe-Signature` header against the raw body.
 *
 * The signed material is `timestamp.body`, so the body must be the exact
 * bytes Stripe sent — re-serialising parsed JSON would change it and every
 * signature would fail. Callers pass the raw text.
 *
 * Hands back { ok: true, event } or { ok: false, error }.
 */
export async function verifyWebhook(env, rawBody, header) {
  if (!env.STRIPE_WEBHOOK_SECRET) return { ok: false, error: "webhook-off" };

  const parts = String(header || "")
    .split(",")
    .map((p) => p.split("="))
    .filter((p) => p.length === 2);
  const t = (parts.find((p) => p[0].trim() === "t") || [])[1];
  const sent = parts.filter((p) => p[0].trim() === "v1").map((p) => p[1].trim());
  if (!t || !sent.length) return { ok: false, error: "bad-signature" };

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(age) || age > TOLERANCE) return { ok: false, error: "stale-signature" };

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = hexOf(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + rawBody)));

  // Stripe may send several v1 signatures during a secret rotation, and every
  // one is compared so the timing says nothing about which matched.
  let matched = false;
  for (const candidate of sent) if (await safeEqual(mac, candidate)) matched = true;
  if (!matched) return { ok: false, error: "bad-signature" };

  try {
    return { ok: true, event: JSON.parse(rawBody) };
  } catch (e) {
    return { ok: false, error: "bad-body" };
  }
}
