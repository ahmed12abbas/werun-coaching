-- Monday evening speed session moves to 20:00 from 2 November 2026. Paste into
-- the D1 console. The slot's time is wall-clock; a workout already published
-- carries its own instant, which no change moves: 20:00 Riyadh is 17:00Z. Past
-- Mondays keep the time they ran at. The window columns are only a record
-- (windowFor() works it out from starts_at), kept honest at 1h/2h.
UPDATE schedule SET at = '20:00'
WHERE weekday = 1 AND active = 1 AND at >= '12:00';

UPDATE club_sessions
SET starts_at = date || 'T17:00:00.000Z',
    window_open_at = date || 'T16:00:00.000Z',
    window_close_at = date || 'T19:00:00.000Z'
WHERE date >= '2026-11-02'
  AND schedule_id IN (SELECT id FROM schedule WHERE weekday = 1 AND active = 1 AND at >= '12:00');
