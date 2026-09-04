CREATE TABLE schedule ( id TEXT PRIMARY KEY, weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), at TEXT NOT NULL, title_en TEXT NOT NULL DEFAULT '', title_ar TEXT NOT NULL DEFAULT '', place_en TEXT NOT NULL DEFAULT '', place_ar TEXT NOT NULL DEFAULT '', map_url TEXT NOT NULL DEFAULT '', points INTEGER NOT NULL DEFAULT 10, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL );
CREATE INDEX schedule_day ON schedule(weekday, at);
CREATE TABLE schedule_changes ( id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES schedule(id) ON DELETE CASCADE, date TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0, at TEXT, place_en TEXT, place_ar TEXT, map_url TEXT, note_en TEXT, note_ar TEXT, created_at TEXT NOT NULL, UNIQUE (schedule_id, date) );
CREATE INDEX schedule_changes_date ON schedule_changes(date);
ALTER TABLE club_sessions ADD COLUMN schedule_id TEXT REFERENCES schedule(id);
CREATE TABLE IF NOT EXISTS d1_migrations( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL );
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0005_schedule.sql');
