-- A news post the coach wants in front of everyone: when set, the app opens it
-- as a sheet once a day (per device) for as long as the post stays live and
-- ticked. 0 for the rest -- almost all of them.
ALTER TABLE posts ADD COLUMN popup INTEGER NOT NULL DEFAULT 0;
