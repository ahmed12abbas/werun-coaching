/* The shop, from the athlete's side. */

import { json, readBody } from "../lib/http.js";
import { tooOften } from "../lib/limit.js";
import { withMember, uid, nowISO } from "../lib/auth.js";
import { getSetting } from "../lib/settings.js";
import { storeOn, createCheckout } from "../lib/stripe.js";

const MAX_QTY = 5;

/* "S, M, L" as the coach typed it, as a list. */
const optionsOf = (options) => (options ? options.split(",").map((s) => s.trim()).filter(Boolean) : []);

const publicProduct = (p) => ({
  id: p.id,
  name_en: p.name_en,
  name_ar: p.name_ar,
  desc_en: p.desc_en,
  desc_ar: p.desc_ar,
  price: p.price,
  options: optionsOf(p.options),
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
async function shopRefusal(env, user) {
  if (!storeOn(env)) return json({ error: "store-off" }, 503);
  if (!(await getSetting(env, "store_open"))) return json({ error: "store-shut" }, 403);
  if (env.STATS && (await tooOften(env.STATS, "co", user.id, 6, 3600))) return json({ error: "too-often" }, 429);
  return null;
}

const quantityFrom = (body) => Math.max(1, Math.min(MAX_QTY, Math.round(Number(body.qty) || 1)));

/* Enough on the shelf, and a size from the list when there is one — none
   when there is not. */
function orderProblem(product, qty, variant) {
  if (product.stock !== null && product.stock < qty) return json({ error: "sold-out" }, 409);
  const choices = optionsOf(product.options);
  const fits = choices.length ? choices.includes(variant) : !variant;
  return fits ? null : json({ error: "pick-a-size" }, 400);
}

async function insertOrder(env, user, product, o) {
  await env.DB.prepare(
    "INSERT INTO orders (id, user_id, product_id, name, variant, qty, amount, currency, status, created_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)"
  )
    .bind(o.id, user.id, product.id, o.name, o.variant, o.qty, product.price * o.qty, o.currency, nowISO())
    .run();
}

/* What Stripe's page shows, and where it sends the athlete afterwards. */
function paymentPage(request, user, product, o) {
  const origin = new URL(request.url).origin;
  return {
    orderId: o.id,
    email: user.email,
    qty: o.qty,
    currency: o.currency,
    unitAmount: product.price,
    name: o.name + (o.variant ? " (" + o.variant + ")" : ""),
    description: product.desc_en || product.desc_ar || "",
    successUrl: origin + "/app#/order/" + o.id,
    cancelUrl: origin + "/app#/store",
  };
}

export const checkout = withMember(async (request, env, user) => {
  const shut = await shopRefusal(env, user);
  if (shut) return shut;

  const body = await readBody(request);
  const qty = quantityFrom(body);
  const product = await env.DB.prepare("SELECT * FROM products WHERE id = ? AND active = 1")
    .bind(String(body.product || ""))
    .first();
  if (!product) return json({ error: "no-product" }, 404);
  const variant = String(body.variant || "");
  const wrong = orderProblem(product, qty, variant);
  if (wrong) return wrong;

  const o = {
    id: uid(),
    name: product.name_en || product.name_ar,
    variant: variant,
    qty: qty,
    currency: await getSetting(env, "currency"),
  };
  const id = o.id;
  await insertOrder(env, user, product, o);

  const out = await createCheckout(env, paymentPage(request, user, product, o));
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
