-- Personal-best times, one row per linked athlete, seconds or NULL.
--
-- Strava has no single "PR" endpoint: best_efforts only ride along on a
-- detailed GET of one activity. Computed once from the athlete's most recent
-- runs (see refreshBests in routes/strava.js) and cached here rather than
-- re-scanned on every Home load — a scan is dozens of Strava calls against
-- an app-wide rate limit shared by the whole club.
CREATE TABLE strava_bests (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secs_1k     INTEGER,
  secs_5k     INTEGER,
  secs_10k    INTEGER,
  secs_21k    INTEGER,
  secs_42k    INTEGER,
  updated_at  TEXT NOT NULL
);
