-- The rate-limit counters, moved out of KV: its free tier allows 1,000 writes
-- a day, and on 14 Sep the club spent them by the afternoon. One row per
-- (scope, who, window); `expires` is the window's end in Unix seconds, and
-- rows past it are pruned by lib/limit.js.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
