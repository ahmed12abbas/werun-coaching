-- One row per athlete who has linked Strava, replaced on reconnect.
--
-- Tokens only, never activity data: the Home card is read live from Strava
-- at request time (POST /api/strava, action "home") rather than mirrored,
-- so a run deleted on Strava stops showing up here too.
CREATE TABLE strava_links (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  athlete_id    TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,   -- unix seconds, Strava's own clock
  connected_at  TEXT NOT NULL
);
