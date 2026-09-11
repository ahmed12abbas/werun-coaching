/* The shop, from the coach's side: what is for sale, and who is owed one. */

import { json, readBody, objectIn, savedId } from "../lib/http.js";
import { uid, nowISO, refuseUnlessAdmin } from "../lib/auth.js";
import { storeOn } from "../lib/stripe.js";

const MAX = { name: 80, desc: 600, options: 120, price: 100000000 };
const LIST = 100;

const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

async function productList(env) {
  const rows = await env.DB.prepare("SELECT * FROM products ORDER BY sort ASC, created_at ASC LIMIT ?")
    .bind(LIST)
    .all();
  return rows.results || [];
}

/* ---------- POST /api/admin/products -------------------------------------- */

const validPrice = (n) => Number.isFinite(n) && n >= 1 && n <= MAX.price;

/* NULL means "as many as they want"; a number means count it down; undefined
   means refuse. */
function stockFrom(v) {
  if (v === null || v === undefined || String(v) === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : undefined;
}

/* The columns a save writes, in the order the UPDATE and INSERT name them —
   or why the form cannot be saved. */
function readProduct(p) {
  const name_en = clean(p.name_en, MAX.name);
  const name_ar = clean(p.name_ar, MAX.name);
  if (!name_en && !name_ar) return { error: "bad-name" };
  const price = Math.round(Number(p.price));
  if (!validPrice(price)) return { error: "bad-price" };
  const stock = stockFrom(p.stock);
  if (stock === undefined) return { error: "bad-stock" };
  return {
    fields: [
      name_en,
      name_ar,
      clean(p.desc_en, MAX.desc),
      clean(p.desc_ar, MAX.desc),
      price,
      clean(p.options, MAX.options),
      stock,
      p.active ? 1 : 0,
      Math.round(Number(p.sort) || 0),
    ],
  };
}

async function updateProduct(env, id, fields) {
  const before = await env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(id).first();
  if (!before) return json({ error: "no-product" }, 404);
  await env.DB.prepare(
    "UPDATE products SET name_en = ?, name_ar = ?, desc_en = ?, desc_ar = ?, price = ?," +
      " options = ?, stock = ?, active = ?, sort = ?, updated_at = ? WHERE id = ?"
  )
    .bind(...fields, nowISO(), id)
    .run();
  return null;
}

async function insertProduct(env, fields) {
  const now = nowISO();
  await env.DB.prepare(
    "INSERT INTO products (id, name_en, name_ar, desc_en, desc_ar, price, options, stock, active, sort, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(uid(), ...fields, now, now)
    .run();
}

async function saveProduct(body, env) {
  const p = objectIn(body.product);
  const product = readProduct(p);
  if (product.error) return json({ error: product.error }, 400);
  const id = savedId(p);
  const failed = id ? await updateProduct(env, id, product.fields) : await insertProduct(env, product.fields);
  return failed || json({ products: await productList(env) });
}

/* A product somebody has bought stays, or their order would stop making
   sense. Taking it off sale is what the coach actually wants anyway. */
async function deleteProduct(body, env) {
  const id = String(body.id || "");
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE product_id = ?").bind(id).first();
  if (((n && n.n) || 0) > 0) return json({ error: "has-orders" }, 409);
  await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  return json({ products: await productList(env) });
}

async function listProducts(body, env) {
  return json({ products: await productList(env), stripe: storeOn(env) });
}

const PRODUCT_ACTIONS = new Map([["save", saveProduct], ["delete", deleteProduct], ["list", listProducts]]);

export async function adminProducts(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessAdmin(request, env, body);
  if (no) return no;

  const run = PRODUCT_ACTIONS.get(String(body.action || "list"));
  return run ? run(body, env) : json({ error: "bad-request" }, 400);
}

/* ---------- POST /api/admin/orders ---------------------------------------- */

async function orderList(env) {
  // Pending rows are people who opened a payment page and did not finish, so
  // they are not the coach's business and would only clutter the list.
  const rows = await env.DB.prepare(
    "SELECT o.*, u.name AS who, u.email FROM orders o JOIN users u ON u.id = o.user_id" +
      " WHERE o.status <> 'pending' ORDER BY o.created_at DESC LIMIT ?"
  )
    .bind(LIST)
    .all();
  return rows.results || [];
}

/* Handed over at the track. Only something already paid for can be. */
async function handOrder(body, env) {
  await env.DB.prepare("UPDATE orders SET status = 'handed', handed_at = ? WHERE id = ? AND status = 'paid'")
    .bind(nowISO(), String(body.id || ""))
    .run();
  return json({ orders: await orderList(env) });
}

async function unhandOrder(body, env) {
  await env.DB.prepare("UPDATE orders SET status = 'paid', handed_at = NULL WHERE id = ? AND status = 'handed'")
    .bind(String(body.id || ""))
    .run();
  return json({ orders: await orderList(env) });
}

/* Marks the club's own record. The refund itself happens in Stripe, which is
   where the money is — this site never moves any. */
async function cancelOrder(body, env) {
  const row = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(String(body.id || "")).first();
  if (!row) return json({ error: "no-order" }, 404);
  if (row.status === "cancelled") return json({ orders: await orderList(env) });
  await env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(row.id).run();
  // What was taken off the shelf goes back on it.
  if (row.status === "paid" || row.status === "handed") {
    await env.DB.prepare("UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL")
      .bind(row.qty, row.product_id)
      .run();
  }
  return json({ orders: await orderList(env) });
}

async function listOrders(body, env) {
  const owed = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'").first();
  const taken = await env.DB.prepare(
    "SELECT currency, SUM(amount) AS total FROM orders WHERE status IN ('paid', 'handed') GROUP BY currency"
  ).all();
  return json({
    orders: await orderList(env),
    to_hand_over: (owed && owed.n) || 0,
    taken: taken.results || [],
    stripe: storeOn(env),
    webhook: !!env.STRIPE_WEBHOOK_SECRET,
  });
}

const ORDER_ACTIONS = new Map([
  ["hand", handOrder],
  ["unhand", unhandOrder],
  ["cancel", cancelOrder],
  ["list", listOrders],
]);

export async function adminOrders(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessAdmin(request, env, body);
  if (no) return no;

  const run = ORDER_ACTIONS.get(String(body.action || "list"));
  return run ? run(body, env) : json({ error: "bad-request" }, 400);
}
