-- Where to reach an athlete when the session is an hour away.
--
-- One row per browser that has said yes, not one per athlete: the club runs
-- on phones, but people open the app on a laptop too, and a push endpoint
-- belongs to a browser rather than a person. The endpoint is what the push
-- service gave that browser, and it is unique on purpose -- a browser that
-- subscribes twice is still one place to send to.
--
-- No keys beside it. The notifications this sends carry no payload at all:
-- the push wakes the service worker, which asks /api/push/next what to say
-- with the athlete's own cookie. That means nothing about the session is
-- readable in transit by the push service, there is no encryption to get
-- wrong, and a notification about a session that was called off in the
-- meantime says so, because the text is fetched at the moment it is shown.
CREATE TABLE push_subs (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint  TEXT NOT NULL UNIQUE,
  at        TEXT NOT NULL
);
CREATE INDEX push_subs_user ON push_subs(user_id);

-- What has already gone out. The sender runs on a schedule and the schedule
-- is not exact, so it will see the same session twice; the primary key is
-- what makes the second run a no-op rather than a second buzz in somebody's
-- pocket.
CREATE TABLE push_sent (
  ref     TEXT NOT NULL,          -- schedule_id|date, the occurrence
  kind    TEXT NOT NULL,          -- 'soon' for now; the hour-before reminder
  user_id TEXT NOT NULL,
  at      TEXT NOT NULL,
  PRIMARY KEY (ref, kind, user_id)
);
