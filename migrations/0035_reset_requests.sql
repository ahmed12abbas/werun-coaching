-- An athlete who has lost their password, asking the club for a way back in.
--
-- Written by POST /api/auth/reset/request whether or not mail is switched on:
-- with mail off it is the only way the club hears of it, and with mail on it
-- is the fallback when the letter never arrives. A coach (or an admin) sees
-- the open ones on /coach and hands over the same one-time link /admin's
-- "Reset link" makes -- the coach never sees or sets a password.
--
-- `handled_by` is who sent the link or turned it down, so a link that reached
-- the wrong person can be traced to the coach who sent it.
CREATE TABLE reset_requests (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  handled_by TEXT,                     -- a coach's or admin's user id
  handled_at TEXT,
  outcome    TEXT CHECK (outcome IN ('sent', 'dismissed'))
);
CREATE INDEX reset_requests_open ON reset_requests(handled_at, at);
CREATE INDEX reset_requests_user ON reset_requests(user_id);
