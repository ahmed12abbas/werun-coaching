/* The shop, from the athlete's side. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { withMember, uid, nowISO } from "../lib/auth.js";
import { getSetting } from "../lib/settings.js";
import { storeOn, createCheckout } from "../lib/stripe.js";

const MAX_QTY = 5;

const publicProduct = (p) => ({
  id: p.id,
  name_en: p.name_en,
  name_ar: p.name_ar,
  desc_en: p.desc_en,
  desc_ar: p.desc_ar,
  price: p.price,
  options: p.options ? p.options.split(",").map((s) => s.trim()).filter(Boolean) : [],
  // The number itself is the coach's business; an athlete needs to know
  // whether they can have one, and how close it is to going.
  sold_out: p.stock !== null && p.stock <= 0,
  low: p.stock !== null && p.stock > 0 && p.stock <= 3 ? p.stock : null,
});

/* ---------- GET /api/store ------------------------------------------------ */

export const store = withMember(async (request, env, user) => {
  const rows = await env.DB.prepare(
    "SELECT * FROM products WHERE active = 1 ORDER BY sort ASC, created_at ASC"
  ).all();
  const orders = await env.DB.prepare(
    "SELECT id, name, variant, qty, amount, currency, status, created_at, handed_at" +
      " FROM orders WHERE user_id = ? AND status <> 'pending' ORDER BY created_at DESC LIMIT 20"
  )
    .bind(user.id)
    .all();

  return json({
    open: storeOn(env) && (await getSetting(env, "store_open")),
    currency: await getSetting(env, "currency"),
    products: (rows.results || []).map(publicProduct),
    orders: orders.results || [],
  });
});

/* ---------- POST /api/store/checkout -------------------------------------- */

/*
 * Makes the order row first, then asks Stripe for a page to pay on. The row
 * is 'pending' until a signed webhook says otherwise — nothing the browser
 * comes back with is taken as proof of payment, because the browser is the
 * one place an athlete could change what it says.
 *
 * The price is read from the database here rather than taken from the
 * request, for the same reason.
 */
export const checkout = withMember(async (request, env, user) => {
  if (!storeOn(env)) return json({ error: "store-off" }, 503);
  if (!(await getSetting(env, "store_open"))) return json({ error: "store-shut" }, 403);
  if (env.STATS && (await tooOften(env.STATS, "co", user.id, 6, 3600))) return json({ error: "too-often" }, 429);

  const body = await readBody(request);
  const qty = Math.max(1, Math.min(MAX_QTY, Math.round(Number(body.qty) || 1)));
  const product = await env.DB.prepare("SELECT * FROM products WHERE id = ? AND active = 1")
    .bind(String(body.product || ""))
    .first();
  if (!product) return json({ error: "no-product" }, 404);
  if (product.stock !== null && product.stock < qty) return json({ error: "sold-out" }, 409);

  const choices = product.options ? product.options.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const variant = String(body.variant || "");
  if (choices.length && !choices.includes(variant)) return json({ error: "pick-a-size" }, 400);
  if (!choices.length && variant) return json({ error: "pick-a-size" }, 400);

  const currency = await getSetting(env, "currency");
  const name = product.name_en || product.name_ar;
  const id = uid();
  await env.DB.prepare(
    "INSERT INTO orders (id, user_id, product_id, name, variant, qty, amount, currency, status, created_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)"
  )
    .bind(id, user.id, product.id, name, variant, qty, product.price * qty, currency, nowISO())
    .run();

  const origin = new URL(request.url).origin;
  const out = await createCheckout(env, {
    orderId: id,
    email: user.email,
    qty: qty,
    currency: currency,
    unitAmount: product.price,
    name: name + (variant ? " (" + variant + ")" : ""),
    description: product.desc_en || product.desc_ar || "",
    successUrl: origin + "/app#/order/" + id,
    cancelUrl: origin + "/app#/store",
  });
  if (!out.ok) {
    // A page that never opened is not an order. Clearing it keeps the coach's
    // list free of rows that were never going anywhere.
    await env.DB.prepare("DELETE FROM orders WHERE id = ? AND status = 'pending'").bind(id).run();
    return json({ error: out.error }, 503);
  }
  await env.DB.prepare("UPDATE orders SET session_id = ? WHERE id = ?").bind(out.sessionId, id).run();
  return json({ url: out.url, order: id });
});

/* ---------- GET /api/store/order?id= -------------------------------------- */

/*
 * The screen an athlete lands on coming back from Stripe. It may well arrive
 * before the webhook does, so "pending" is an ordinary answer here and the
 * page says "we are waiting for the bank" rather than "it failed".
 */
export const order = withMember(async (request, env, user) => {
  const id = new URL(request.url).searchParams.get("id") || "";
  const row = await env.DB.prepare(
    "SELECT id, name, variant, qty, amount, currency, status, created_at, paid_at, handed_at" +
      " FROM orders WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first();
  if (!row) return json({ error: "no-order" }, 404);
  return json({ order: row });
});
