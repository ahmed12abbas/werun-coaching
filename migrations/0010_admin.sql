-- Who runs the club, as opposed to who takes the sessions.
--
-- `role` answers "does this person coach?" and is read all over: the session
-- picker, the week, the roster. Making admin a third value of it would mean
-- an admin dropping out of every one of those queries unless each learned to
-- say `role IN ('coach','admin')` — and the first one anybody forgot would
-- quietly lose a coach from the Tuesday picker. The two questions are not one
-- ladder: the club's head coach both coaches and administers, and a treasurer
-- might administer without ever taking a session.
--
-- So: a column of its own. It is also the only shape that fits how migrations
-- land here. `users.role` carries a CHECK constraint, and SQLite cannot alter
-- one — a third value would mean rebuilding the whole users table, with every
-- ON DELETE CASCADE hanging off it, by hand in the D1 console. ADD COLUMN is
-- one line that cannot half-happen.
--
-- INTEGER 0/1 rather than TEXT: SQLite has no boolean, and this is the shape
-- `schedule.active` already uses.

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- Everyone who is a coach today is an admin today, because today a coach can
-- open the console. A migration must not take access away from the people who
-- have it and are using it; the club decides who to demote from here, on the
-- Members screen, which is the only place that ever knew.
UPDATE users SET is_admin = 1 WHERE role = 'coach';
