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
 * Body: { positions: Array<{ icao24, lat, lng, registration?, icao_type?,
 *         engine_type?, mtow_kg?, altitude_ft?, ground_speed_kt?, heading? }> }
 */

// Somaliland tenant id (last bytes 0x534F = ASCII "SO"); mirrors mig 071 seed.
const SOMALILAND_JID = '00000000-0000-4000-8000-00000000534f';

// Terminal arrival-alert states: an alert in one of these is "closed" and a new
// air detection may open a fresh one. Mirrors arrival_alerts' open-state indexes.
const TERMINAL_ALERT_STATES = ['RECONCILED', 'CANCELLED'];

// Approximate Somaliland FIR bounding ring (lat 7.5–11.8 N, lng 42.5–49.5 E) —
// the SAME coarse rectangle as Go backend/internal/fir. Ray-cast point-in-polygon.
// {lat, lng} pairs; NOT the official ICAO FIR boundary.
const SOMALILAND_FIR: Array<{ lat: number; lng: number }> = [
  { lat: 7.5, lng: 42.5 },
  { lat: 7.5, lng: 49.5 },
  { lat: 11.8, lng: 49.5 },
  { lat: 11.8, lng: 42.5 },
  { lat: 7.5, lng: 42.5 },
];

function pointInFIR(lat: number, lng: number): boolean {
  let inside = false;
  const poly = SOMALILAND_FIR;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const yi = poly[i].lat;
    const xi = poly[i].lng;
    const yj = poly[j].lat;
    const xj = poly[j].lng;
    if (xi > lng !== xj > lng && lat < ((yj - yi) * (lng - xi)) / (xj - xi) + yi) {
      inside = !inside;
    }
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
    // context). UNSCOPED platform client; aircraft rows inherit jurisdiction via
    // the column DEFAULT until geofence→jurisdiction lands (mirrors /api/ais/ingest).
    const admin = createPlatformClient();

    let positionsInserted = 0;
    let aircraftUpserted = 0;
    let alertsCreated = 0;

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

      // Resolve the aircraft id + operator from icao24.
      const { data: aircraft } = await admin
        .from('aircraft')
        .select('id, operator_id')
        .eq('icao24', pos.icao24)
        .limit(1)
        .maybeSingle();

      if (!aircraft) continue;

      // GHOST operator: an aircraft with no operator gets a placeholder GHOST
      // shipowners row (AIR mode), then aircraft.operator_id is linked to it.
      let operatorId = aircraft.operator_id as string | null;
      if (!operatorId) {
        const { data: ghost } = await admin
          .from('shipowners')
          .insert({
            name: pos.registration || pos.icao24,
            account_state: 'GHOST',
            applicable_modes: ['AIR'],
            jurisdiction_id: SOMALILAND_JID,
          })
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
      const inFir = pointInFIR(pos.lat, pos.lng);
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

      // Air arrival detection: inside the FIR + no OPEN air alert for this
      // aircraft → open one (MATCHED_AUTO), then best-effort enqueue the proforma.
      if (inFir) {
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
              jurisdiction_id: SOMALILAND_JID,
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

    return NextResponse.json({
      success: true,
      positions_inserted: positionsInserted,
      aircraft_upserted: aircraftUpserted,
      alerts_created: alertsCreated,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
