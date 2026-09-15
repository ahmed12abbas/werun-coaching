-- An optional photo on a club news post, uploaded the same way an About page
-- photo is (routes/about.js): shrunk in the browser, stored in KV under its
-- own prefix, and this column holds the /api/feed/img?id= URL it comes back
-- with. NULL for a post with no photo -- most of them.
ALTER TABLE posts ADD COLUMN photo_url TEXT;
