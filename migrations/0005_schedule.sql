-- The standing week.
--
-- Ten sessions that repeat, which is what the club actually runs on — and
-- three or four a month that move or are called off. Those two facts are
-- separate tables on purpose: the pattern is the truth, and a change is
-- something that happened to one occurrence of it. Editing the pattern to
-- move next Tuesday would silently move every Tuesday after it too.
--
-- Times are local wall-clock ("04:45"), not UTC. The club meets at quarter to
-- five whatever the date does to the offset, and Riyadh has no daylight
-- saving to complicate it.

CREATE TABLE schedule (
  id         TEXT PRIMARY KEY,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday, the club's first day
  at         TEXT NOT NULL,                                    -- "04:45"
  title_en   TEXT NOT NULL DEFAULT '',
  title_ar   TEXT NOT NULL DEFAULT '',
  place_en   TEXT NOT NULL DEFAULT '',
  place_ar   TEXT NOT NULL DEFAULT '',
  map_url    TEXT NOT NULL DEFAULT '',                         -- where the pin is, if there is one
  points     INTEGER NOT NULL DEFAULT 10,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX schedule_day ON schedule(weekday, at);

-- One occurrence, moved or called off. Nothing here repeats.
CREATE TABLE schedule_changes (
  id          TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,          -- the one day it applies to, YYYY-MM-DD
  cancelled   INTEGER NOT NULL DEFAULT 0,
  at          TEXT,                   -- a new time, or NULL to keep the usual one
  place_en    TEXT,
  place_ar    TEXT,
  map_url     TEXT,
  note_en     TEXT,                   -- "meeting at the far gate, the near one is shut"
  note_ar     TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (schedule_id, date)
);
CREATE INDEX schedule_changes_date ON schedule_changes(date);

-- When the coach publishes a real workout for one of these, the published
-- session says which standing slot it belongs to, so the week shows one thing
-- and not two.
ALTER TABLE club_sessions ADD COLUMN schedule_id TEXT REFERENCES schedule(id);
