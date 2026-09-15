-- The reminder job (routes/push.js, every quarter of an hour) and a coach's
-- "coming" counts (lib/weekplan.js) ask session_signups by date alone, and
-- neither key on the table leads with it — so every run read every signup
-- ever made. The table only grows; this keeps those reads to the days asked for.
CREATE INDEX IF NOT EXISTS session_signups_date ON session_signups(date);
