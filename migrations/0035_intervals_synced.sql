-- When the athlete's phone last put the club's weeks on their Intervals.icu
-- calendar. A link is not the same as a sync: one made before calendar writing
-- was asked for still reads runs but never reaches the watch. /coach counts both.
ALTER TABLE intervals_links ADD COLUMN synced_at TEXT;
