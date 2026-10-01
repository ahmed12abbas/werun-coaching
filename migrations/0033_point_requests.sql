-- A coach or leader asking an admin to count an athlete who was at a session
-- but could not scan the code -- a flat phone, no signal, a camera that would
-- not focus. The coach says who and why; only an admin says yes, and a yes is
-- a real check-in (method 'manual') with the session's points, so attendance,
-- streaks and voiding all treat it like any other.
--
-- One ask per athlete per session, whatever became of it: a "no" is the
-- admin's answer, not an invitation to ask again until it is a "yes".
CREATE TABLE point_requests (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES club_sessions(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asked_by   TEXT NOT NULL,            -- the coach's user id
  reason     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  at         TEXT NOT NULL,
  decided_by TEXT,                     -- an admin's user id, or 'password'
  decided_at TEXT,
  UNIQUE (session_id, user_id)
);
CREATE INDEX point_requests_status ON point_requests(status, at);
