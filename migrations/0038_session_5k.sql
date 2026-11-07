-- A third group on the same calendar: the 5/10k runners, beside the half
-- (the session itself) and the full (0034). Same reasoning as there — one
-- row, one code, one check-in, a second workout riding on it. Empty means
-- the session is the same as the half plan's.
ALTER TABLE club_sessions ADD COLUMN name_5k TEXT NOT NULL DEFAULT '';
ALTER TABLE club_sessions ADD COLUMN payload_5k TEXT NOT NULL DEFAULT '';
