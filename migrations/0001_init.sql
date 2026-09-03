-- The platform's tables. Applied by the deploy workflow with
--   wrangler d1 migrations apply werun-db --remote
-- and locally by tools/dev.js. See docs/PLATFORM-PLAN.md for what each holds.
--
-- Ids are random text (crypto.randomUUID in the Worker) so they can sit in a
-- URL or a QR code without giving away how many of anything there are.
-- Times are ISO-8601 text in UTC, the same as the KV documents already use.

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  pass_salt         TEXT NOT NULL,
  pass_hash         TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'athlete' CHECK (role IN ('athlete', 'coach')),
  lang              TEXT NOT NULL DEFAULT 'en',
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  email_verified_at TEXT,
  created_at        TEXT NOT NULL,
  last_seen_at      TEXT
);

-- One row per logged-in device. Only the hash of the cookie token is kept, so
-- reading this table out does not hand anyone a live login.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ua         TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- A session the coach has published to the club: the same payload the share
-- link carries, plus when it happens and when check-in is allowed.
CREATE TABLE club_sessions (
  id              TEXT PRIMARY KEY,
  date            TEXT NOT NULL,            -- YYYY-MM-DD, the athlete's calendar day
  day             TEXT NOT NULL,            -- monday … sunday
  name            TEXT NOT NULL,
  payload         TEXT NOT NULL,            -- share-link payload, decoded by js/model.js
  starts_at       TEXT NOT NULL,
  window_open_at  TEXT NOT NULL,
  window_close_at TEXT NOT NULL,
  points          INTEGER NOT NULL DEFAULT 10,
  published_by    TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX club_sessions_date ON club_sessions(date);

-- One per athlete per session, as a constraint and not a rule in the UI.
CREATE TABLE checkins (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES club_sessions(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  method     TEXT NOT NULL DEFAULT 'qr',
  voided_at  TEXT,
  voided_by  TEXT,
  UNIQUE (session_id, user_id)
);
CREATE INDEX checkins_user ON checkins(user_id);

-- Points are never edited in place: every change is a row, and a total is a
-- sum. A voided check-in gets a matching negative row rather than a delete.
CREATE TABLE points_ledger (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta   INTEGER NOT NULL,
  reason  TEXT NOT NULL CHECK (reason IN ('checkin', 'streak', 'adjust', 'void')),
  ref_id  TEXT,
  note    TEXT,
  at      TEXT NOT NULL
);
CREATE INDEX points_ledger_user ON points_ledger(user_id);

-- The news feed. Both languages on one row, like the tips articles in KV.
CREATE TABLE posts (
  id           TEXT PRIMARY KEY,
  title_en     TEXT NOT NULL DEFAULT '',
  title_ar     TEXT NOT NULL DEFAULT '',
  body_en      TEXT NOT NULL DEFAULT '',
  body_ar      TEXT NOT NULL DEFAULT '',
  pinned       INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,                        -- NULL while it is a draft
  author_id    TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX posts_published ON posts(published_at);

-- What the coach can change from /admin without a deploy. Values are JSON.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
