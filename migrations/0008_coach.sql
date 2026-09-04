-- Who is taking the session.
--
-- The club has more than one coach now, and "who is at the track on Tuesday"
-- was the one thing the week could not say. It hangs off two rows because the
-- two answer different questions: `schedule.coach_id` is who usually takes
-- that standing slot, and `club_sessions.coach_id` is who took that one
-- morning — the published session wins, and falls back to the slot when it
-- was left blank.
--
-- Plainly, with no REFERENCES clause, for the same reason schedule_id has
-- none: foreign keys are off by default here, so it would enforce nothing,
-- and the D1 console refuses an ADD COLUMN that carries one — taking the
-- whole paste down with it. A coach who is deleted leaves an id that matches
-- nobody, which reads as "not said" and is the right answer anyway.

ALTER TABLE schedule ADD COLUMN coach_id TEXT;
ALTER TABLE club_sessions ADD COLUMN coach_id TEXT;
