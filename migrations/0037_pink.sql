-- The Pink Run/Walk, 26 Oct 2026: guests registering with no account.
-- One row per phone number (normalised to 9665…), so registering twice
-- updates the row. routes/pink.js also creates this table itself if it is
-- missing, because tonight's deploy lands before anyone can paste this in.
CREATE TABLE IF NOT EXISTS pink_signups (
  phone      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  age        TEXT NOT NULL,
  people     INTEGER NOT NULL,
  first_time INTEGER NOT NULL DEFAULT 0, -- 1 = first time running with the club
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
