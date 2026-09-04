-- Links sent by email: confirming an address, and setting a new password.
--
-- Only the hash of each token is kept, for the same reason sessions keep only
-- a hash — reading this table out must not hand anyone a live link. A token
-- is good once: `used_at` is stamped on the way through, and a stamped row is
-- refused even while it is still inside its expiry.
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);
