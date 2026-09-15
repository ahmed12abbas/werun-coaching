-- An admin asking one athlete how a session went, off that session's "Who
-- came" list in /admin. Set by /api/admin/members (action ask-feedback) and
-- spent by the athlete's next check-in, which answers with the feedback box
-- and puts this back to 0 -- so it asks once, not on every scan.
ALTER TABLE users ADD COLUMN ask_feedback INTEGER NOT NULL DEFAULT 0;
