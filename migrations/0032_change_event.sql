-- One occurrence as a special event -- "We Run Race 2026" in place of that
-- Saturday's long run. A change could already move the time, the place and the
-- map pin; these let it also rename the session, say where to sign up, and
-- dress it as the club's race. All NULL for the ordinary change.
ALTER TABLE schedule_changes ADD COLUMN title_en TEXT;
ALTER TABLE schedule_changes ADD COLUMN title_ar TEXT;
ALTER TABLE schedule_changes ADD COLUMN link_url TEXT;
ALTER TABLE schedule_changes ADD COLUMN theme TEXT;
