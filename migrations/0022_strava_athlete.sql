-- Their Strava athlete number, for a Strava button beside their name on the
-- runner card, between the name and the Instagram one.
--
-- The bare number, not a URL, for the same reason as the Instagram handle
-- (0015): the link is built where it is drawn, and the Worker keeps only the
-- digits out of whatever was pasted, so nothing else can ride in on it.
--
-- No hidden flag beside it, unlike Instagram: the field exists only to be
-- shown, so leaving it empty is how an athlete keeps it to themselves.
ALTER TABLE users ADD COLUMN strava_athlete TEXT NOT NULL DEFAULT '';
