/* What Stripe tells us afterwards.

   The only route on the site that is public, unauthenticated and allowed to
   change money — so the signature is checked before anything in the body is
   looked at, and every path that is not a verified `checkout.session.completed`
   does nothing at all. */

import { json } from "../lib/http.js";
import { nowISO } from "../lib/auth.js";
import { verifyWebhook } from "../lib/stripe.js";

/* ---------- POST /api/stripe/webhook -------------------------------------- */

export async function stripeWebhook(request, env) {
  if (!env.DB) return json({ error: "no-db" }, 503);

  // The exact bytes, because that is what was signed.
  const raw = await request.text();
  const out = await verifyWebhook(env, raw, request.headers.get("stripe-signature"));
  if (!out.ok) {
    // 400, not 401: Stripe retries on 5xx and gives up on 4xx, and a message
    // we cannot verify is never going to become one we can.
    console.error("stripe webhook refused: " + out.error);
    return json({ error: out.error }, 400);
  }

  const event = out.event || {};
  if (event.type !== "checkout.session.completed") {
    // Everything else is acknowledged and ignored, so Stripe stops resending
    // events this club has no use for.
    return json({ ok: true, ignored: event.type || null });
  }

  const session = (event.data && event.data.object) || {};
  const orderId = session.client_reference_id || (session.metadata && session.metadata.order_id);
  if (!orderId) return json({ ok: true, ignored: "no-order-ref" });

  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(String(orderId)).first();
  if (!order) return json({ ok: true, ignored: "unknown-order" });
  // Webhooks retry, and a retry must not take a second shirt off the shelf.
  if (order.status !== "pending") return json({ ok: true, already: order.status });

  await env.DB.prepare(
    "UPDATE orders SET status = 'paid', paid_at = ?, payment_id = ? WHERE id = ? AND status = 'pending'"
  )
    .bind(nowISO(), session.payment_intent || null, order.id)
    .run();

  // Stock comes down only now, when the money is real. Guarded so a race
  // cannot push it below zero.
  await env.DB.prepare(
    "UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL AND stock >= ?"
  )
    .bind(order.qty, order.product_id, order.qty)
    .run();

  return json({ ok: true });
}
