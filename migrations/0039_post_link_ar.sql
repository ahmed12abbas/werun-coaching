-- A news post's title link in Arabic, beside link_url (0031), which is now the
-- English one: a race page or a form often has a page per language. Each
-- reader gets their own language's link and falls back to the other's.
ALTER TABLE posts ADD COLUMN link_url_ar TEXT;
