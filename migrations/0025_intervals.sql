-- One row per athlete who has linked Intervals.icu, replaced on reconnect.
--
-- The same shape as strava_links (0018): tokens only, never activity data —
-- the Home card reads Intervals.icu live at request time.
CREATE TABLE intervals_links (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  athlete_id    TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,   -- unix seconds
  connected_at  TEXT NOT NULL
);
