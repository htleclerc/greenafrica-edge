import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * GET /api/ais/poll
 *
 * Short-burst AIS poller for development/demo — connects to aisstream.io
 * WebSocket for ~15 seconds, collects vessel positions in the Somaliland EEZ,
 * writes them to Supabase, then closes and returns results.
 *
 * No auth required for dev use. For production, use the Go backend ingester.
 */

const AISSTREAM_WS = 'wss://stream.aisstream.io/v0/stream';
const BURST_DURATION_MS = 15_000; // 15 seconds

const SOMALILAND_BBOX = [
    [9.5, 43.0],
    [13.5, 52.0],
];

interface AisMsg {
    MessageType: string;
    MetaData: {
        MMSI: number;
        MMSI_String: string;
        ShipName: string;
        latitude: number;
        longitude: number;
        time_utc: string;
    };
    Message: {
        PositionReport?: {
            Cog: number;
            Sog: number;
            TrueHeading: number;
        };
        ShipStaticData?: {
            ImoNumber: number;
            Name: string;
            Type: number;
        };
    };
}

function aisTypeToCategory(t: number): string {
    if (t >= 70 && t <= 79) return 'CARGO';
    if (t >= 80 && t <= 89) return 'TANKER';
    if (t >= 60 && t <= 69) return 'FERRY';
    return 'CARGO';
}

export const maxDuration = 30; // Vercel function timeout

export async function GET() {
    const apiKey = process.env.AISSTREAM_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'AISSTREAM_API_KEY not configured' }, { status: 500 });
    }

    // Cross-tenant AIS poller (dev/demo). UNSCOPED platform client; vessel rows
    // inherit jurisdiction via the column DEFAULT until Wedge 1 geofencing.
    let admin: SupabaseClient;
    try {
        admin = createPlatformClient();
    } catch {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const collected: Array<{ mmsi: string; name: string; lat: number; lng: number; speed: number }> = [];

    try {
        await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(AISSTREAM_WS);
            const timeout = setTimeout(() => {
                ws.close();
                resolve();
            }, BURST_DURATION_MS);

            ws.onopen = () => {
                ws.send(JSON.stringify({
                    APIKey: apiKey,
                    BoundingBoxes: [SOMALILAND_BBOX],
                }));
            };

            ws.onmessage = async (event) => {
                try {
                    const msg: AisMsg = JSON.parse(
                        typeof event.data === 'string' ? event.data : event.data.toString(),
                    );
                    const mmsi = msg.MetaData.MMSI_String;
                    const lat = msg.MetaData.latitude;
                    const lng = msg.MetaData.longitude;
                    if (!mmsi || !lat || !lng) return;

                    const sog = (msg.Message.PositionReport?.Sog ?? 0) / 10;
                    const heading = msg.Message.PositionReport?.TrueHeading ?? 0;
                    const name = msg.MetaData.ShipName?.trim() || `VESSEL-${mmsi}`;
                    const category = msg.Message.ShipStaticData
                        ? aisTypeToCategory(msg.Message.ShipStaticData.Type)
                        : 'CARGO';

                    // Upsert vessel
                    await admin.from('vessels').upsert(
                        {
                            mmsi,
                            name,
                            imo_number: msg.Message.ShipStaticData?.ImoNumber
                                ? String(msg.Message.ShipStaticData.ImoNumber)
                                : '',
                            call_sign: '',
                            flag_code: '',
                            category,
                            compliance_status: 'APPROACHING',
                        },
                        { onConflict: 'mmsi' },
                    );

                    // Get vessel ID
                    const { data: vessel } = await admin
                        .from('vessels')
                        .select('id')
                        .eq('mmsi', mmsi)
                        .limit(1)
                        .single();

                    if (vessel) {
                        await admin.from('vessel_positions').insert({
                            vessel_id: vessel.id,
                            lat,
                            lng,
                            heading,
                            speed_knots: sog,
                            recorded_at: msg.MetaData.time_utc || new Date().toISOString(),
                        });
                    }

                    collected.push({ mmsi, name, lat, lng, speed: sog });
                } catch {
                    // skip malformed messages
                }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('WebSocket connection failed'));
            };

            ws.onclose = () => {
                clearTimeout(timeout);
                resolve();
            };
        });
    } catch (err) {
        return NextResponse.json({
            error: err instanceof Error ? err.message : 'AIS poll failed',
            collected: collected.length,
        }, { status: 502 });
    }

    return NextResponse.json({
        success: true,
        duration_ms: BURST_DURATION_MS,
        vessels_collected: collected.length,
        unique_vessels: new Set(collected.map((c) => c.mmsi)).size,
        positions: collected,
    });
}
