import { NextRequest, NextResponse } from 'next/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * POST /api/adsb/ingest
 *
 * Receives a batch of ADS-B aircraft position reports and writes them to Supabase.
 * Air-mode mirror of /api/ais/ingest. Designed to be called by a cron job or an
 * external ADS-B processor.
 *
 * Protected by ADSB_INGEST_SECRET (falls back to AIS_INGEST_SECRET) in the
 * Authorization header.
 *
 * Multi-jurisdiction: FIR geofences are loaded from public.geofences (mig 082,
 * kind='FIR', active=true) with a 60-second module-level cache. The jurisdiction_id
 * is resolved from the matched ring rather than being hardcoded. Abutting FIRs
 * (SO|DJ share lng 43.45) are disambiguated by the strict half-open ray-cast —
 * identical semantics to the Go detector (backend/internal/fir).
 *
 * Body: { positions: Array<{ icao24, lat, lng, registration?, icao_type?,
 *         engine_type?, mtow_kg?, altitude_ft?, ground_speed_kt?, heading? }> }
 */

// Terminal arrival-alert states: an alert in one of these is "closed" and a new
// air detection may open a fresh one. Mirrors arrival_alerts' open-state indexes.
const TERMINAL_ALERT_STATES = ['RECONCILED', 'CANCELLED'];

// FIR geofences loaded from public.geofences (mig 082) — module-level 60s cache.
// Detection resolves jurisdiction_id from the matched ring (multi-jurisdiction).
// Ray-cast keeps the EXACT strict semantics of the Go detector (half-open shared
// edges): the abutting SO|DJ FIRs at lng 43.45 resolve to exactly one jurisdiction.
type FirRing = { jurisdiction_id: string; ring: Array<{ lat: number; lng: number }> };
let firCache: { fetchedAt: number; firs: FirRing[] } | null = null;
// 60s — matches the Go geofence store TTL; geofence admin edits propagate within one TTL window.
const FIR_CACHE_TTL_MS = 60_000;

async function loadFIRs(admin: ReturnType<typeof createPlatformClient>): Promise<FirRing[]> {
  if (firCache && Date.now() - firCache.fetchedAt < FIR_CACHE_TTL_MS) return firCache.firs;
  const { data, error } = await admin
    .from('geofences')
    .select('jurisdiction_id, ring:geometry') // 'geometry' is the JSONB column name (mig 082), aliased to 'ring' — not a PostGIS type.
    .eq('kind', 'FIR')
    .eq('active', true);
  if (error || !data || data.length === 0) {
    throw new Error(`adsb: FIR geofence load failed: ${error?.message ?? 'no active FIR geofences'}`);
  }
  const firs = data as unknown as FirRing[];
  firCache = { fetchedAt: Date.now(), firs };
  return firs;
}

// AIR activation matrix (jurisdiction_mode_config) — same 60s module cache as FIRs.
// FAIL-CLOSED: a jurisdiction absent from the set is DISABLED (no new air alerts;
// positions/registry keep flowing — billing stops, detection data does not).
// NOTE: an empty result (no AIR rows) is valid — it means everything is disabled.
let airEnabledCache: { fetchedAt: number; enabled: Set<string> } | null = null;

async function loadAirEnabled(admin: ReturnType<typeof createPlatformClient>): Promise<Set<string>> {
  if (airEnabledCache && Date.now() - airEnabledCache.fetchedAt < FIR_CACHE_TTL_MS) return airEnabledCache.enabled;
  const { data, error } = await admin
    .from('jurisdiction_mode_config')
    .select('jurisdiction_id, enabled')
    .eq('mode', 'AIR');
  if (error || !data) throw new Error(`adsb: air matrix load failed: ${error?.message}`);
  const enabled = new Set<string>(data.filter((r) => r.enabled === true).map((r) => r.jurisdiction_id as string));
  airEnabledCache = { fetchedAt: Date.now(), enabled };
  return enabled;
}

function matchFIR(lat: number, lng: number, firs: FirRing[]): string | null {
  for (const f of firs) {
    if (pointInRing(lat, lng, f.ring)) return f.jurisdiction_id;
  }
  return null;
}

function pointInRing(lat: number, lng: number, poly: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const yi = poly[i].lat, xi = poly[i].lng, yj = poly[j].lat, xj = poly[j].lng;
    if (xi > lng !== xj > lng && lat < ((yj - yi) * (lng - xi)) / (xj - xi) + yi) inside = !inside;
  }
  return inside;
}

export async function POST(request: NextRequest) {
  try {
    // Verify the ingest secret (ADS-B specific, falling back to the AIS secret).
    const authHeader = request.headers.get('Authorization');
    const expectedKey = process.env.ADSB_INGEST_SECRET || process.env.AIS_INGEST_SECRET;

    if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { positions } = (await request.json()) as {
      positions: Array<{
        icao24: string;
        lat: number;
        lng: number;
        registration?: string;
        icao_type?: string;
        engine_type?: string;
        mtow_kg?: number;
        altitude_ft?: number;
        ground_speed_kt?: number;
        heading?: number;
      }>;
    };

    if (!positions || !Array.isArray(positions) || positions.length === 0) {
      return NextResponse.json({ error: 'No positions provided' }, { status: 400 });
    }

    // Cross-tenant ADS-B ingest feed (keyed by ADSB_INGEST_SECRET, no tenant
    // context). UNSCOPED platform client; FIR geofences determine jurisdiction_id
    // per-detection (multi-country).
    const admin = createPlatformClient();

    // Load detection config once for the whole batch (fail-closed: if either
    // FIR geofences or the AIR activation matrix is unavailable, reject the
    // whole batch rather than silently mis-bill or mis-detect).
    let firs: FirRing[];
    let airEnabled: Set<string>;
    try {
      [firs, airEnabled] = await Promise.all([loadFIRs(admin), loadAirEnabled(admin)]);
    } catch {
      return NextResponse.json({ error: 'detection config unavailable' }, { status: 500 });
    }

    let positionsInserted = 0;
    let aircraftUpserted = 0;
    let alertsCreated = 0;
    let alertsSkippedDisabled = 0;

    for (const pos of positions) {
      if (!pos.icao24 || pos.lat == null || pos.lng == null) continue;
      // Range guard: drop obviously bogus coordinates before any DB write.
      if (pos.lat < -90 || pos.lat > 90 || pos.lng < -180 || pos.lng > 180) continue;

      // Upsert the aircraft by icao24. Only set columns that were provided so a
      // sparse feed never overwrites prior enrichment with NULLs. jurisdiction_id
      // is left to the column DEFAULT.
      const aircraftRow: Record<string, unknown> = { icao24: pos.icao24 };
      if (pos.registration) aircraftRow.registration = pos.registration;
      if (pos.icao_type) aircraftRow.icao_type = pos.icao_type;
      if (pos.engine_type) aircraftRow.engine_type = pos.engine_type;
      if (pos.mtow_kg != null) aircraftRow.mtow_kg = pos.mtow_kg;

      const { error: acErr } = await admin
        .from('aircraft')
        .upsert(aircraftRow, { onConflict: 'icao24' });
      if (!acErr) aircraftUpserted++;
      else console.warn('[adsb] aircraft upsert failed:', acErr);

      // Resolve the aircraft id + operator from icao24.
      const { data: aircraft } = await admin
        .from('aircraft')
        .select('id, operator_id')
        .eq('icao24', pos.icao24)
        .limit(1)
        .maybeSingle();

      if (!aircraft) continue;

      // Resolve jurisdiction from FIR geofences.
      const matchedJid = matchFIR(pos.lat, pos.lng, firs);
      const inFir = matchedJid !== null;

      // GHOST operator: an aircraft with no operator gets a placeholder GHOST
      // shipowners row (AIR mode), then aircraft.operator_id is linked to it.
      // jurisdiction_id is set to the matched FIR jurisdiction when inside a FIR;
      // outside any FIR the column DEFAULT applies (home-registry semantics).
      let operatorId = aircraft.operator_id as string | null;
      if (!operatorId) {
        const ghostRow: Record<string, unknown> = {
          name: pos.registration || pos.icao24,
          account_state: 'GHOST',
          applicable_modes: ['AIR'],
        };
        if (matchedJid !== null) ghostRow.jurisdiction_id = matchedJid;
        const { data: ghost } = await admin
          .from('shipowners')
          .insert(ghostRow)
          .select('id')
          .single();
        if (ghost) {
          operatorId = ghost.id as string;
          await admin
            .from('aircraft')
            .update({ operator_id: operatorId })
            .eq('id', aircraft.id);
        }
      }

      // FIR geofence + position insert.
      const { error: posErr } = await admin.from('aircraft_positions').insert({
        aircraft_id: aircraft.id,
        lat: pos.lat,
        lng: pos.lng,
        altitude_ft: pos.altitude_ft ?? null,
        ground_speed_kt: pos.ground_speed_kt ?? null,
        heading: pos.heading ?? null,
        in_fir: inFir,
      });
      if (!posErr) positionsInserted++;

      // Air arrival detection: inside the FIR + AIR enabled for this jurisdiction
      // + no OPEN air alert for this aircraft → open one (MATCHED_AUTO), then
      // best-effort enqueue the proforma.
      // FAIL-CLOSED: if the jurisdiction has no row in the activation matrix (or
      // its row is disabled) we skip alert creation. Positions + registry keep
      // flowing regardless — billing stops, detection data does not.
      if (inFir) {
        if (!airEnabled.has(matchedJid!)) {
          alertsSkippedDisabled++;
        } else {
          const { data: openAlert } = await admin
            .from('arrival_alerts')
            .select('id')
            .eq('aircraft_id', aircraft.id)
            .not('status', 'in', `(${TERMINAL_ALERT_STATES.join(',')})`)
            .limit(1)
            .maybeSingle();

          if (!openAlert) {
            const { data: newAlert } = await admin
              .from('arrival_alerts')
              .insert({
                aircraft_id: aircraft.id,
                mode: 'AIR',
                detected_lat: pos.lat,
                detected_lng: pos.lng,
                status: 'MATCHED_AUTO',
                jurisdiction_id: matchedJid, // always non-null here (inFir === true)
              })
              .select('id')
              .single();

            if (newAlert) {
              alertsCreated++;
              // Best-effort enqueue (non-fatal on error, like claimArrivalAlert).
              const { error: enqErr } = await admin.rpc('pgmq_enqueue_proforma', {
                alert_id: newAlert.id,
              });
              if (enqErr) {
                console.error('[adsb] enqueue failed:', enqErr);
              }
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      positions_inserted: positionsInserted,
      aircraft_upserted: aircraftUpserted,
      alerts_created: alertsCreated,
      alerts_skipped_disabled: alertsSkippedDisabled,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
