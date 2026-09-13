-- A leader is a coach under another name: `role` stays 'coach', so every guard
-- and every list that asks "does this person coach?" answers the same, and
-- this column only changes the word on the badge. `role` carries a CHECK
-- constraint SQLite cannot alter (see 0010), which is why it is not a third
-- role value.
ALTER TABLE users ADD COLUMN is_leader INTEGER NOT NULL DEFAULT 0;
