/**
 * The shop, end to end, without a Stripe account.
 *
 *   node tools/dev.js               (in one terminal)
 *   node tools/smoke-store.js       (in another)
 *
 * Starts a stub on 127.0.0.1:4324 that answers like Stripe's checkout API —
 * .dev.vars points STRIPE_API_BASE at it — so a real order is created, a real
 * webhook is signed with the real HMAC and sent to the real route, and the
 * stock really comes down.
 *
 * The part that gets the hardest test is the webhook signature, because it is
 * the one public route on the site that can move an order to paid.
 *
 * SMOKE_ADMIN_PASSWORD is the club password (default: the .dev.vars one).
 */
const http = require("http");
const crypto = require("crypto");

const BASE = (process.argv[2] || "http://127.0.0.1:4323").replace(/\/+$/, "");
const ADMIN = process.env.SMOKE_ADMIN_PASSWORD || "letmein";
const WEBHOOK_SECRET = process.env.SMOKE_WEBHOOK_SECRET || "whsec_local_stub";
const STUB_PORT = 4324;

let failures = 0;
const seen = []; // what the stub was asked for
const sessions = []; // the ids it handed back

function who() {
  const it = { cookie: "" };
  it.call = async (method, path, body, headers) => {
    const h = Object.assign({ accept: "application/json" }, headers || {});
    if (body !== undefined && !h["content-type"]) h["content-type"] = "application/json";
    if (it.cookie) h.cookie = it.cookie;
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const res = await fetch(BASE + path, { method, headers: h, body: payload });
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = /werun_s=([^;]*)/.exec(set);
      it.cookie = m && m[1] ? "werun_s=" + m[1] : "";
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    return { status: res.status, data };
  };
  return it;
}

/** Poll until it is true, or give up after about fifteen seconds. */
async function waitFor(fn, tries) {
  for (let i = 0; i < (tries || 30); i++) {
    if (await fn()) return true;
    await new Promise((f) => setTimeout(f, 500));
  }
  return false;
}

function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || !detail ? "" : "  -> " + JSON.stringify(detail).slice(0, 260)));
  if (!ok) failures++;
}

/** Stripe's own scheme: HMAC-SHA256 over `timestamp.body`. */
function sign(body, secret, at) {
  const t = at === undefined ? Math.floor(Date.now() / 1000) : at;
  const mac = crypto.createHmac("sha256", secret).update(t + "." + body).digest("hex");
  return { header: "t=" + t + ",v1=" + mac, body: body };
}

const event = (orderId) =>
  JSON.stringify({
    id: "evt_" + Math.random().toString(36).slice(2),
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessions[sessions.length - 1] || "cs_test_unknown",
        client_reference_id: orderId,
        payment_intent: "pi_test_1",
      },
    },
  });

/* ---- the stub ---- */
function startStub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body: body });
        if (req.url === "/v1/checkout/sessions") {
          // A fresh id each time, like the real thing: orders.session_id is
          // UNIQUE so one payment can never be claimed by two orders, and a
          // stub that repeated itself would trip that on its second run.
          const id = "cs_test_" + crypto.randomBytes(8).toString("hex");
          sessions.push(id);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: id, url: "https://checkout.stripe.test/pay/" + id }));
        } else {
          res.writeHead(404).end("{}");
        }
      });
    });
    server.listen(STUB_PORT, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const stub = await startStub();
  const stamp = Date.now().toString(36);
  const pw = "correct-horse-" + stamp;
  const athlete = who();
  const anon = who();
  const admin = (payload) => anon.call("POST", "/api/admin/products", Object.assign({ password: ADMIN }, payload));
  const orders = (payload) => anon.call("POST", "/api/admin/orders", Object.assign({ password: ADMIN }, payload));

  try {
    let r = await anon.call("GET", "/api/health");
    if (!(r.data && r.data.db)) {
      console.log("No DB bound at " + BASE + " — nothing to test here.");
      process.exit(1);
    }
    if (!r.data.store) {
      console.log("STRIPE_SECRET_KEY is not set, so the shop is off. Add the stub lines to .dev.vars.");
      process.exit(1);
    }
    check("health says the shop is wired", r.data.store === true && r.data.webhook === true, r.data);
    check("…and admits the api base is overridden",
      (r.data.warnings || []).includes("stripe-api-base-overridden"), r.data.warnings);
    // Both dev switches are on at once here, which is exactly the case a
    // single warning field used to hide.
    check("…alongside the email echo, not instead of it",
      (r.data.warnings || []).includes("email-echo-on"), r.data.warnings);

    await athlete.call("POST", "/api/auth/signup", { name: "Shopper", email: "shop+" + stamp + "@example.invalid", password: pw });

    /* ---- the coach stocks it ---- */
    r = await admin({ action: "save", product: { name_en: "", name_ar: "" } });
    check("a product with no name is refused", r.status === 400 && r.data.error === "bad-name", r);
    r = await admin({ action: "save", product: { name_en: "Club tee", price: 0 } });
    check("a free product is refused", r.status === 400 && r.data.error === "bad-price", r);

    r = await admin({
      action: "save",
      product: { name_en: "Club tee " + stamp, name_ar: "تي شيرت النادي", desc_en: "Purple, of course.", price: 25000, options: "S,M,L,XL", stock: 2, active: 1 },
    });
    check("a product saves", r.status === 200 && r.data.products.some((p) => p.name_en === "Club tee " + stamp), r.status);
    const tee = r.data.products.find((p) => p.name_en === "Club tee " + stamp);

    r = await admin({ action: "save", product: { name_en: "Draft cap " + stamp, price: 9000, active: 0 } });
    const cap = r.data.products.find((p) => p.name_en === "Draft cap " + stamp);

    /* ---- what the athlete sees ---- */
    r = await athlete.call("GET", "/api/store");
    check("the shop lists the active product", (r.data.products || []).some((p) => p.id === tee.id), r.data.products);
    check("…and not the inactive one", !(r.data.products || []).some((p) => p.id === cap.id), r.data.products);
    check("…with its sizes", (r.data.products.find((p) => p.id === tee.id) || {}).options.join(",") === "S,M,L,XL", r.data.products);
    check("…and no stock count", !("stock" in (r.data.products.find((p) => p.id === tee.id) || {})), r.data.products[0]);
    check("the shop is shut until the coach opens it", r.data.open === false, r.data.open);

    r = await athlete.call("POST", "/api/store/checkout", { product: tee.id, variant: "M" });
    check("…and buying is refused while it is", r.status === 403 && r.data.error === "store-shut", r);

    await anon.call("POST", "/api/admin/settings", { password: ADMIN, set: { store_open: true, currency: "usd" } });
    // Settings are cached per isolate for a minute, so wait for the change to
    // actually be visible rather than assuming it lands at once.
    const opened = await waitFor(async () => {
      const s = await athlete.call("GET", "/api/store");
      return s.data && s.data.open === true;
    });
    check("opening the shop takes effect", opened, "the store stayed shut");

    /* ---- buying ---- */
    r = await anon.call("POST", "/api/store/checkout", { product: tee.id, variant: "M" });
    check("buying needs a login", r.status === 401, r.status);
    r = await athlete.call("POST", "/api/store/checkout", { product: cap.id, variant: "" });
    check("an inactive product cannot be bought", r.status === 404, r);
    r = await athlete.call("POST", "/api/store/checkout", { product: tee.id, variant: "XXL" });
    check("a size that is not offered is refused", r.status === 400 && r.data.error === "pick-a-size", r);
    r = await athlete.call("POST", "/api/store/checkout", { product: tee.id });
    check("no size at all is refused", r.status === 400 && r.data.error === "pick-a-size", r);
    r = await athlete.call("POST", "/api/store/checkout", { product: tee.id, variant: "M", qty: 9 });
    check("more than the shelf holds is refused", r.status === 409 && r.data.error === "sold-out", r);

    r = await athlete.call("POST", "/api/store/checkout", { product: tee.id, variant: "M" });
    check("a real order gets a payment page", r.status === 200 && /checkout\.stripe\.test/.test(r.data.url || ""), r);
    const orderId = r.data.order;

    const asked = seen[seen.length - 1];
    // Stripe's nesting is percent-encoded on the wire, so read it back the
    // way Stripe does rather than matching the raw string.
    const sent = new URLSearchParams(asked.body);
    check("stripe was asked with the secret key", /^Bearer sk_/.test(asked.auth || ""), asked.auth);
    check("…for the price the database holds, not the browser",
      sent.get("line_items[0][price_data][unit_amount]") === "25000", asked.body.slice(0, 200));
    check("…in the club's currency", sent.get("line_items[0][price_data][currency]") === "usd", asked.body.slice(0, 200));
    check("…with the size on the line", /\(M\)/.test(sent.get("line_items[0][price_data][product_data][name]") || ""),
      sent.get("line_items[0][price_data][product_data][name]"));
    check("…naming the order so the webhook can find it", sent.get("client_reference_id") === orderId, asked.body.slice(0, 200));

    r = await athlete.call("GET", "/api/store/order?id=" + orderId);
    check("the order is pending until the money is real", r.data.order.status === "pending", r.data.order);
    r = await orders({ action: "list" });
    check("…and the coach is not shown it yet", !(r.data.orders || []).some((o) => o.id === orderId), r.data.orders);

    /* ---- the webhook: the part that has to be right ---- */
    const good = event(orderId);
    r = await anon.call("POST", "/api/stripe/webhook", good, { "content-type": "application/json" });
    check("an unsigned webhook is refused", r.status === 400, r);
    r = await anon.call("POST", "/api/stripe/webhook", good, { "stripe-signature": "t=1,v1=deadbeef" });
    check("a wrong signature is refused", r.status === 400 && r.data.error === "stale-signature", r);

    let s = sign(good, "whsec_the_wrong_secret");
    r = await anon.call("POST", "/api/stripe/webhook", s.body, { "stripe-signature": s.header });
    check("a signature under the wrong secret is refused", r.status === 400 && r.data.error === "bad-signature", r);

    s = sign(good, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600);
    r = await anon.call("POST", "/api/stripe/webhook", s.body, { "stripe-signature": s.header });
    check("an hour-old signature is refused", r.status === 400 && r.data.error === "stale-signature", r);

    s = sign(good, WEBHOOK_SECRET);
    const tampered = good.replace(orderId, orderId);
    r = await anon.call("POST", "/api/stripe/webhook", tampered.replace('"pi_test_1"', '"pi_tampered"'), { "stripe-signature": s.header });
    check("a body changed after signing is refused", r.status === 400 && r.data.error === "bad-signature", r);

    r = await athlete.call("GET", "/api/store/order?id=" + orderId);
    check("…and none of that paid the order", r.data.order.status === "pending", r.data.order);

    s = sign(good, WEBHOOK_SECRET);
    r = await anon.call("POST", "/api/stripe/webhook", s.body, { "stripe-signature": s.header });
    check("a properly signed webhook is accepted", r.status === 200 && r.data.ok, r);

    r = await athlete.call("GET", "/api/store/order?id=" + orderId);
    check("the order is paid", r.data.order.status === "paid" && !!r.data.order.paid_at, r.data.order);

    r = await admin({ action: "list" });
    check("the shelf came down by one", r.data.products.find((p) => p.id === tee.id).stock === 1, r.data.products.find((p) => p.id === tee.id));

    /* Stripe retries; a retry must not take a second shirt. */
    s = sign(good, WEBHOOK_SECRET);
    r = await anon.call("POST", "/api/stripe/webhook", s.body, { "stripe-signature": s.header });
    check("a retry changes nothing", r.status === 200 && r.data.already === "paid", r);
    r = await admin({ action: "list" });
    check("…and the shelf is still 1", r.data.products.find((p) => p.id === tee.id).stock === 1, r.data.products.find((p) => p.id === tee.id));

    /* An event for something else is acknowledged and ignored. */
    const other = JSON.stringify({ type: "payment_intent.succeeded", data: { object: {} } });
    s = sign(other, WEBHOOK_SECRET);
    r = await anon.call("POST", "/api/stripe/webhook", s.body, { "stripe-signature": s.header });
    check("another kind of event is ignored, not failed", r.status === 200 && r.data.ignored === "payment_intent.succeeded", r);

    /* ---- the coach hands it over ---- */
    r = await orders({ action: "list" });
    const mine = (r.data.orders || []).find((o) => o.id === orderId);
    check("the coach sees the paid order", !!mine && mine.who === "Shopper", r.data.orders);
    check("…and is told how many to bring", r.data.to_hand_over >= 1, r.data.to_hand_over);
    check("…and what has been taken", (r.data.taken || []).some((t) => t.total >= 25000), r.data.taken);

    r = await orders({ action: "hand", id: orderId });
    check("handing it over is recorded", r.data.orders.find((o) => o.id === orderId).status === "handed", r.status);
    r = await athlete.call("GET", "/api/store/order?id=" + orderId);
    check("…and the athlete can see that", r.data.order.status === "handed" && !!r.data.order.handed_at, r.data.order);

    r = await admin({ action: "delete", id: tee.id });
    check("a product with orders cannot be deleted", r.status === 409 && r.data.error === "has-orders", r);

    r = await orders({ action: "cancel", id: orderId });
    check("cancelling is recorded", r.data.orders.find((o) => o.id === orderId).status === "cancelled", r.status);
    r = await admin({ action: "list" });
    check("…and puts the shirt back on the shelf", r.data.products.find((p) => p.id === tee.id).stock === 2, r.data.products.find((p) => p.id === tee.id));

    /* Another athlete must not be able to read this one's order. */
    const nosy = who();
    await nosy.call("POST", "/api/auth/signup", { name: "Nosy", email: "nosy+" + stamp + "@example.invalid", password: pw });
    r = await nosy.call("GET", "/api/store/order?id=" + orderId);
    check("somebody else's order is not readable", r.status === 404, r);

    /* ---- tidy up ---- */
    await anon.call("POST", "/api/admin/settings", { password: ADMIN, set: { store_open: false } });
    await admin({ action: "delete", id: cap.id });
    // The tee has an order against it now, so it cannot be deleted — taking
    // it off sale is what a coach would do, and keeps the shop tidy between runs.
    await admin({ action: "save", product: { id: tee.id, name_en: "Club tee " + stamp, price: 25000, active: 0 } });

    console.log(failures ? "\n" + failures + " failure(s)." : "\nAll passed.");
  } finally {
    stub.close();
  }
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("smoke-store: " + (e.stack || e));
  process.exit(1);
});
