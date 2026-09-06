-- Which coaches are taking which session this week.
--
-- The club has ten standing sessions and more coaches than sessions, and the
-- thing nobody could see was "is anybody actually on Wednesday?". So: a coach
-- puts themselves on a session for one date, ahead of the week, and every
-- other coach can see who else did.
--
-- Deliberately NOT `club_sessions.coach_id`. That column answers a different
-- question — who is named on the workout an athlete opens — and it holds one
-- id, on a row that only exists once a session has been published or opened
-- for a code. A rota is many coaches, on a date nobody has published yet, and
-- it is nobody's business but the coaches'. Two questions, two places; see the
-- note in CLAUDE.md about coach_id, which this does not touch.
--
-- Keyed on the standing slot and the date rather than on a session id, for
-- the same reason: the week a coach signs up against is the standing pattern,
-- and seven of the ten slots have no `club_sessions` row until somebody shows
-- a code on the morning. Making a session row just to record a rota tick
-- would put empty sessions on the club's calendar weeks ahead.
--
-- The primary key is the whole row bar the timestamp, so ticking twice is the
-- same as ticking once and there is no way to be on a session twice.
CREATE TABLE coach_rota (
  schedule_id TEXT NOT NULL,
  date        TEXT NOT NULL,            -- YYYY-MM-DD, the occurrence
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,            -- when they put themselves down
  PRIMARY KEY (schedule_id, date, user_id)
);

-- The week reads a date range, which is the only way anything reads this.
CREATE INDEX coach_rota_date ON coach_rota(date);

-- No REFERENCES on schedule_id, matching club_sessions: foreign keys are off
-- by default here so it would enforce nothing, and a slot that is deleted
-- leaves rows that match no slot -- which the week simply does not draw.
