-- Not everybody wants their name on a board. The default is to appear —
-- a leaderboard nobody is on is not a leaderboard — and one tap on the Me
-- screen takes an athlete off it. Their own points are unaffected either way.
ALTER TABLE users ADD COLUMN board_hidden INTEGER NOT NULL DEFAULT 0;
