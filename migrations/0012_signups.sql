-- Who says they are coming, and how many sessions a week they are aiming for.
--
-- Check-in answers "did you turn up"; this answers "are you planning to",
-- which is the thing the home screen leads with and the only thing the club
-- could not see before. It is the athlete's own row, and no athlete sees
-- anybody else's -- the roster a coach reads is still the check-ins.
--
-- Shaped exactly like coach_rota (0011) and for the same reason: the week an
-- athlete signs up against is the standing pattern, and seven of the ten
-- slots have no `club_sessions` row until somebody shows a code on the
-- morning. Making a session row to record an intention would put empty
-- sessions on the club's calendar weeks ahead.
--
-- The primary key is the whole row bar the timestamp, so tapping twice is the
-- same as tapping once.
CREATE TABLE session_signups (
  schedule_id TEXT NOT NULL,
  date        TEXT NOT NULL,            -- YYYY-MM-DD, the occurrence
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,            -- when they put their name down
  PRIMARY KEY (schedule_id, date, user_id)
);

-- One athlete's own week is the only way anything reads this.
CREATE INDEX session_signups_user ON session_signups(user_id, date);

-- How many sessions a week they are aiming for. Three is the club's own
-- default -- Sunday, Tuesday, Thursday -- and NOT NULL because a home screen
-- that has to say "of ?" is worse than one that guesses the common answer.
ALTER TABLE users ADD COLUMN week_goal INTEGER NOT NULL DEFAULT 3;
