-- An optional web address on a club news post: when set, the post's title in
-- the app is a link to it. NULL for the ones without -- most of them.
ALTER TABLE posts ADD COLUMN link_url TEXT;
