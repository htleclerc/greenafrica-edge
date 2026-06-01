import { NextRequest, NextResponse } from 'next/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * POST /api/ais/ingest
 *
 * Receives a batch of AIS position reports and writes them to Supabase.
 * Designed to be called by a cron job or external AIS processor.
 *
 * Protected by AISSTREAM_API_KEY in the Authorization header.
 *
 * Body: { positions: Array<{ mmsi, lat, lng, heading, speedKnots, timestamp, imoNumber?, name?, shipType? }> }
 */
export async function POST(request: NextRequest) {
  try {
    // Verify the ingest API key
    const authHeader = request.headers.get('Authorization');
    const expectedKey = process.env.AIS_INGEST_SECRET;

    if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { positions } = (await request.json()) as {
      positions: Array<{
        mmsi: string;
        lat: number;
        lng: number;
        heading?: number;
        speedKnots?: number;
        timestamp?: string;
        imoNumber?: string;
        name?: string;
        shipType?: number;
      }>;
    };

    if (!positions || !Array.isArray(positions) || positions.length === 0) {
      return NextResponse.json({ error: 'No positions provided' }, { status: 400 });
    }

    // Cross-tenant AIS ingest feed (keyed by AIS_INGEST_SECRET, no tenant
    // context). UNSCOPED platform client; vessel rows inherit jurisdiction via
    // the column DEFAULT until geofence→jurisdiction lands in Wedge 1.
    const adminClient = createPlatformClient();

    let inserted = 0;
    let upserted = 0;

    for (const pos of positions) {
      if (!pos.mmsi || !pos.lat || !pos.lng) continue;

      // Upsert vessel if new MMSI
      if (pos.name || pos.imoNumber) {
        const { error: vesselErr } = await adminClient.from('vessels').upsert(
          {
            mmsi: pos.mmsi,
            imo_number: pos.imoNumber || '',
            name: pos.name?.trim() || `VESSEL-${pos.mmsi}`,
            call_sign: '',
            flag_code: '',
            category: 'CARGO',
            compliance_status: 'APPROACHING',
          },
          { onConflict: 'mmsi' },
        );
        if (!vesselErr) upserted++;
      }

      // Find the vessel ID from MMSI
      const { data: vessel } = await adminClient
        .from('vessels')
        .select('id')
        .eq('mmsi', pos.mmsi)
        .limit(1)
        .single();

      if (!vessel) continue;

      // Insert position
      const { error: posErr } = await adminClient.from('vessel_positions').insert({
        vessel_id: vessel.id,
        lat: pos.lat,
        lng: pos.lng,
        heading: pos.heading ?? 0,
        speed_knots: pos.speedKnots ?? 0,
        recorded_at: pos.timestamp || new Date().toISOString(),
      });

      if (!posErr) inserted++;
    }

    return NextResponse.json({
      success: true,
      positions_inserted: inserted,
      vessels_upserted: upserted,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
