-- Their Instagram, and whether the club may have it.
--
-- The same pair as the bio (0013, 0014) and for the same reason: a runner
-- card that says who somebody is off the track is worth more than one that
-- does not, and the athlete who does not want their account handed to a club
-- of strangers must be able to keep it. So the handle is one column and the
-- choice is another, and the choice is what the board's own SELECT reads --
-- a hidden handle never leaves the database, the way a hidden line does not.
--
-- The bare handle, not a URL: it is what an athlete knows about their own
-- account, the link is built where it is drawn, and a column that holds
-- whatever was pasted is a column that eventually holds someone else's site.
-- 30 characters because that is Instagram's own limit; the Worker cuts to it.
--
-- NOT NULL DEFAULT '' rather than nullable, again: every read is "print this
-- or print nothing", and "" is already that answer.
ALTER TABLE users ADD COLUMN instagram TEXT NOT NULL DEFAULT '';

-- Default 0 -- shown -- because nobody has one yet: the field arrives empty
-- for every member, so the first person it can possibly describe is somebody
-- who has just typed their own handle into a box next to a ticked switch.
ALTER TABLE users ADD COLUMN instagram_hidden INTEGER NOT NULL DEFAULT 0;
