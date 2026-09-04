/* The shop, from the coach's side: what is for sale, and who is owed one. */

import { json, readBody } from "../lib/http.js";
import { uid, nowISO, refuseUnlessCoach } from "../lib/auth.js";
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

export async function adminProducts(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  const action = String(body.action || "list");

  if (action === "save") {
    const p = body.product && typeof body.product === "object" ? body.product : {};
    const name_en = clean(p.name_en, MAX.name);
    const name_ar = clean(p.name_ar, MAX.name);
    if (!name_en && !name_ar) return json({ error: "bad-name" }, 400);

    const price = Math.round(Number(p.price));
    if (!Number.isFinite(price) || price < 1 || price > MAX.price) return json({ error: "bad-price" }, 400);

    // NULL means "as many as they want"; a number means count it down.
    let stock = null;
    if (p.stock !== null && p.stock !== undefined && String(p.stock) !== "") {
      stock = Math.round(Number(p.stock));
      if (!Number.isFinite(stock) || stock < 0 || stock > 100000) return json({ error: "bad-stock" }, 400);
    }

    const fields = [
      name_en,
      name_ar,
      clean(p.desc_en, MAX.desc),
      clean(p.desc_ar, MAX.desc),
      price,
      clean(p.options, MAX.options),
      stock,
      p.active ? 1 : 0,
      Math.round(Number(p.sort) || 0),
    ];
    const id = /^[A-Za-z0-9_-]{1,64}$/.test(String(p.id || "")) ? String(p.id) : null;
    const now = nowISO();

    if (id) {
      const before = await env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(id).first();
      if (!before) return json({ error: "no-product" }, 404);
      await env.DB.prepare(
        "UPDATE products SET name_en = ?, name_ar = ?, desc_en = ?, desc_ar = ?, price = ?," +
          " options = ?, stock = ?, active = ?, sort = ?, updated_at = ? WHERE id = ?"
      )
        .bind(...fields, now, id)
        .run();
    } else {
      await env.DB.prepare(
        "INSERT INTO products (id, name_en, name_ar, desc_en, desc_ar, price, options, stock, active, sort, created_at, updated_at)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(uid(), ...fields, now, now)
        .run();
    }
    return json({ products: await productList(env) });
  }

  if (action === "delete") {
    // A product somebody has bought stays, or their order would stop making
    // sense. Taking it off sale is what the coach actually wants anyway.
    const id = String(body.id || "");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE product_id = ?").bind(id).first();
    if (((n && n.n) || 0) > 0) return json({ error: "has-orders" }, 409);
    await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
    return json({ products: await productList(env) });
  }

  if (action !== "list") return json({ error: "bad-request" }, 400);
  return json({ products: await productList(env), stripe: storeOn(env) });
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

export async function adminOrders(request, env) {
  const body = await readBody(request);
  const no = await refuseUnlessCoach(request, env, body);
  if (no) return no;

  const action = String(body.action || "list");

  if (action === "hand") {
    // Handed over at the track. Only something already paid for can be.
    await env.DB.prepare("UPDATE orders SET status = 'handed', handed_at = ? WHERE id = ? AND status = 'paid'")
      .bind(nowISO(), String(body.id || ""))
      .run();
    return json({ orders: await orderList(env) });
  }

  if (action === "unhand") {
    await env.DB.prepare("UPDATE orders SET status = 'paid', handed_at = NULL WHERE id = ? AND status = 'handed'")
      .bind(String(body.id || ""))
      .run();
    return json({ orders: await orderList(env) });
  }

  if (action === "cancel") {
    // Marks the club's own record. The refund itself happens in Stripe, which
    // is where the money is — this site never moves any.
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

  if (action !== "list") return json({ error: "bad-request" }, 400);

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
