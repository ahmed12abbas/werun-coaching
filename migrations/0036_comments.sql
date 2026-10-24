-- What the club says under a post or a coach's article.
--
-- `target` is "post:<id>" or "tip:<id>", the same key reactions use (0017) and
-- for the same reason: posts live in D1 and articles in KV, so no foreign key
-- could cover both. A comment is its author's to take down, or an admin's.
CREATE TABLE comments (
  id      TEXT PRIMARY KEY,
  target  TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body    TEXT NOT NULL,
  at      TEXT NOT NULL
);
CREATE INDEX comments_target ON comments(target, at);
