-- What the session actually is.
--
-- The week could say when, where, who and what it was worth, but not "80
-- minutes easy on the trail" — and that is the line an athlete reads to
-- decide whether to set an alarm. It hangs off the standing slot rather than
-- off each published session: the club runs the same ten sessions every week
-- and the description belongs to the slot, so the coach writes it once and a
-- session published into that slot inherits it.
--
-- Both languages, like every other string a member sees. Nullable and with no
-- default: a slot nobody has described yet shows nothing, which is what it
-- did before this existed.

ALTER TABLE schedule ADD COLUMN desc_en TEXT;
ALTER TABLE schedule ADD COLUMN desc_ar TEXT;
