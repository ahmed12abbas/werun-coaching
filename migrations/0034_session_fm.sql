-- The club trains a half- and a full-marathon group off one calendar: same
-- meeting point, same code, same check-in, different workout. So the full
-- plan is a second name and payload on the session row rather than a second
-- session — two rows would mean two codes at one track. Empty means the
-- session is the same for both groups.
ALTER TABLE club_sessions ADD COLUMN name_fm TEXT NOT NULL DEFAULT '';
ALTER TABLE club_sessions ADD COLUMN payload_fm TEXT NOT NULL DEFAULT '';
