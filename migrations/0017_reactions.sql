-- What the club thinks of a post.
--
-- One reaction per member per thing, which is why the member is half the
-- primary key: double-tapping again changes your mind rather than adding a
-- second voice, and tapping the same face again takes it back. Counting is
-- therefore a GROUP BY over rows, never a stored total -- the same rule the
-- points ledger follows.
--
-- `target` is "post:<id>" or "tip:<id>" in one column because the two things
-- on the news screen live in two different places -- posts in D1, the coach's
-- articles in KV -- and a foreign key could only ever have covered one of
-- them. Nothing here reads back into either table: a reaction on something
-- that has since been deleted is a row nobody asks for.
CREATE TABLE reactions (
  target  TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji   TEXT NOT NULL,
  at      TEXT NOT NULL,
  PRIMARY KEY (target, user_id)
);
CREATE INDEX reactions_target ON reactions(target);
