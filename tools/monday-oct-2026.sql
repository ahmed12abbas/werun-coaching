-- The last two Monday evening speed sessions of October 2026 (19th, 26th)
-- move from Misk City Track 19:00 to Wadi Mahdia Road 19:30. One change row
-- per occurrence; the standing week is not touched, and "Put it back" in
-- /admin removes either one. A note already on the day is kept.
INSERT INTO schedule_changes
  (id, schedule_id, date, cancelled, at, place_en, place_ar, map_url, created_at)
SELECT lower(hex(randomblob(16))), s.id, d.date, 0, '19:30',
  'Wadi Mahdia Road', 'خط التفتيش - بعد الدوار',
  'https://maps.app.goo.gl/fwSWCrLb9cxV7JHB6',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM schedule s, (SELECT '2026-10-19' AS date UNION ALL SELECT '2026-10-26') d
WHERE s.weekday = 1 AND s.active = 1 AND s.at >= '12:00'
ON CONFLICT(schedule_id, date) DO UPDATE SET cancelled = 0, at = excluded.at,
  place_en = excluded.place_en, place_ar = excluded.place_ar, map_url = excluded.map_url;
