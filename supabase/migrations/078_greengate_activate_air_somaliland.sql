-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 078: GreenGate v8 — Wedge 1-D activate AIR for Somaliland
-- mig 071 inserted the Somaliland AIR jurisdiction_mode_config row as enabled=FALSE
-- (awaiting W1-A..C). W1-A/B/C have landed (aircraft, ICAO LTO calc, FIR detection),
-- so turn AIR on. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.jurisdiction_mode_config
   SET enabled = TRUE,
       geofence_ref = 'somaliland-fir',
       activated_at = COALESCE(activated_at, NOW())
 WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f' AND mode = 'AIR';
-- DOWN: UPDATE public.jurisdiction_mode_config SET enabled=FALSE, geofence_ref=NULL,
--       activated_at=NULL WHERE jurisdiction_id='00000000-0000-4000-8000-00000000534f' AND mode='AIR';
