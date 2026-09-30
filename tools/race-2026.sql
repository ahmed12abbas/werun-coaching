-- Saturday 10 Oct 2026 becomes the club's race. One row against that one
-- occurrence of the Saturday long run; the standing week is not touched, and
-- "Put it back" in /admin removes it. Needs migration 0032.
INSERT OR REPLACE INTO schedule_changes
  (id, schedule_id, date, cancelled, title_en, title_ar, place_en, place_ar,
   map_url, link_url, theme, created_at)
SELECT lower(hex(randomblob(16))), id, '2026-10-10', 0,
  'We Run Race 2026', 'سباق وي ران 2026',
  'Wadi Namar', 'وادي نمار',
  'https://maps.app.goo.gl/iwMsfCAEHbdAcF6v5',
  'https://www.kaminsports.sa/events/we-run-race-2026',
  'race', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM schedule
WHERE weekday = 6 AND active = 1 AND title_en LIKE 'Long run%'
LIMIT 1;
