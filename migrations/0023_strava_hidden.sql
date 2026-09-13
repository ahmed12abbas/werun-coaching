-- Whether the club may have their Strava number -- the same switch Instagram
-- has (0015). 0022 said an empty field was how to keep it private, but linking
-- Strava now fills the number in on its own, so the choice needs a column of
-- its own. The board's SELECT reads it, so a hidden number never leaves the
-- database.
--
-- Default 0 -- shown -- matching Instagram's, so a number already typed in
-- keeps its button.
ALTER TABLE users ADD COLUMN strava_hidden INTEGER NOT NULL DEFAULT 0;
