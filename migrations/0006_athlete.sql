-- Who is running, in the two ways a coach actually needs to know.
--
-- Birth year rather than a full date of birth: it gives the age group a
-- session or a race entry is set by, and it is one number instead of the
-- exact day — the club has no use for the day, so it does not hold it.
--
-- Both are allowed to be empty. Someone who will not say still runs with the
-- club, and a join form that refuses them is a form that loses them.
-- No CHECK constraint on either: the Worker is the only writer and it already
-- whitelists the answer, so the constraint would repeat a rule rather than add
-- one — and every extra clause on an ADD COLUMN is another thing the console
-- can refuse, which after two failed pastes is not a trade worth making.
ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN birth_year INTEGER;
