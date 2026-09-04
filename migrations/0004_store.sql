-- The club shop: pay online, collect at the track.
--
-- No addresses and no shipping, because the coach hands the thing over on
-- Monday — which also means the club never holds a delivery address it would
-- then have to look after.
--
-- Money is an integer in the currency's smallest unit (piastres, cents), the
-- way Stripe counts it. Nothing here ever holds a card number: the payment
-- happens on Stripe's own page and this table learns the result from a signed
-- webhook.

CREATE TABLE products (
  id         TEXT PRIMARY KEY,
  name_en    TEXT NOT NULL DEFAULT '',
  name_ar    TEXT NOT NULL DEFAULT '',
  desc_en    TEXT NOT NULL DEFAULT '',
  desc_ar    TEXT NOT NULL DEFAULT '',
  price      INTEGER NOT NULL,          -- smallest unit, e.g. 25000 = 250.00
  -- "S,M,L,XL" for a shirt, empty for a water bottle. The athlete picks one
  -- and it is written onto the order, which is all a club of this size needs
  -- before it needs a variants table.
  options    TEXT NOT NULL DEFAULT '',
  stock      INTEGER,                   -- NULL means "as many as they want"
  active     INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX products_active ON products(active, sort);

CREATE TABLE orders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id),
  -- Copied, not joined: what the athlete bought and what they paid must keep
  -- saying so after the coach edits the price or renames the shirt.
  name        TEXT NOT NULL,
  variant     TEXT NOT NULL DEFAULT '',
  qty         INTEGER NOT NULL DEFAULT 1,
  amount      INTEGER NOT NULL,
  currency    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'paid', 'handed', 'cancelled')),
  -- Stripe's own references, so a payment can always be traced back to a row
  -- in their dashboard and the other way round.
  session_id  TEXT UNIQUE,
  payment_id  TEXT,
  created_at  TEXT NOT NULL,
  paid_at     TEXT,
  handed_at   TEXT
);
CREATE INDEX orders_user ON orders(user_id, created_at);
CREATE INDEX orders_status ON orders(status, created_at);
