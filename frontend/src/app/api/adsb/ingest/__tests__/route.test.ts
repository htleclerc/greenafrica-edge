// frontend/src/app/api/adsb/ingest/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// SO FIR ring from mig 082 (de-overlapped west edge: 43.45 not 42.5)
const SO_JID = '00000000-0000-4000-8000-00000000534f';
const SO_RING = [
    { lat: 7.5, lng: 43.45 },
    { lat: 7.5, lng: 49.5 },
    { lat: 11.8, lng: 49.5 },
    { lat: 11.8, lng: 43.45 },
    { lat: 7.5, lng: 43.45 },
];

// Spies for the table operations we assert on.
const aircraftUpsert = vi.fn();
const alertInsert = vi.fn();
const rpc = vi.fn();

// A chainable thenable stub: every builder method returns the same object, and it
// resolves to `result` when awaited. `single`/`maybeSingle` resolve to `single`.
function makeQuery(opts: { rows?: unknown; single?: unknown }) {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = vi.fn(chain);
    q.eq = vi.fn(chain);
    q.not = vi.fn(chain);
    q.limit = vi.fn(chain);
    q.order = vi.fn(chain);
    q.single = vi.fn(async () => ({ data: opts.single ?? null, error: null }));
    q.maybeSingle = vi.fn(async () => ({ data: opts.single ?? null, error: null }));
    q.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: opts.rows ?? null, error: null });
    return q;
}

// Per-table dispatch. geofences: returns the SO FIR row so loadFIRs() succeeds.
// aircraft: upsert ok, then select→single returns the row (operator_id NULL so
// the GHOST path runs). shipowners: insert→select→single returns a ghost id.
// aircraft_positions: insert ok. arrival_alerts: the OPEN lookup returns null,
// then insert→select→single returns a new alert id.
function makeAdmin() {
    return {
        from: vi.fn((table: string) => {
            if (table === 'geofences') {
                // Two-level chain: .select().eq().eq() → resolves with FIR rows
                const eqInner = vi.fn().mockResolvedValue({
                    data: [{ jurisdiction_id: SO_JID, ring: SO_RING }],
                    error: null,
                });
                const eqOuter = vi.fn(() => ({ eq: eqInner }));
                return { select: vi.fn(() => ({ eq: eqOuter })) };
            }
            if (table === 'aircraft') {
                return {
                    upsert: (...a: unknown[]) => {
                        aircraftUpsert(...a);
                        return makeQuery({});
                    },
                    select: () => makeQuery({ single: { id: 'ac-1', operator_id: null } }),
                    update: () => makeQuery({}),
                };
            }
            if (table === 'shipowners') {
                return { insert: () => makeQuery({ single: { id: 'ghost-1' } }) };
            }
            if (table === 'aircraft_positions') {
                return { insert: () => makeQuery({}) };
            }
            if (table === 'arrival_alerts') {
                return {
                    // OPEN-alert lookup resolves to null (no open alert).
                    select: () => makeQuery({ single: null }),
                    insert: (...a: unknown[]) => {
                        alertInsert(...a);
                        return makeQuery({ single: { id: 'alert-1' } });
                    },
                };
            }
            return makeQuery({});
        }),
        rpc: (...a: unknown[]) => {
            rpc(...a);
            return Promise.resolve({ error: null });
        },
    };
}

let admin = makeAdmin();
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => admin }));

import { POST } from '../route';

function makeReq(body: unknown, secret?: string): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers.Authorization = `Bearer ${secret}`;
    return new Request('http://x/api/adsb/ingest', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
}

// NOTE: this legacy suite predates the multi-jurisdiction tests (./route.test.ts). It uses a static import, so the module-level firCache is SHARED across these tests — all cases must keep identical geofence fixtures. Covers the AIS_INGEST_SECRET fallback + counters.
describe('POST /api/adsb/ingest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        admin = makeAdmin();
        process.env.ADSB_INGEST_SECRET = 'adsb-secret';
        delete process.env.AIS_INGEST_SECRET;
    });

    it('401 without the ingest secret', async () => {
        const res = await POST(makeReq({ positions: [] }) as never);
        expect(res.status).toBe(401);
    });

    it('401 with a wrong secret', async () => {
        const res = await POST(makeReq({ positions: [] }, 'nope') as never);
        expect(res.status).toBe(401);
    });

    it('a position inside the FIR upserts the aircraft and opens an air alert', async () => {
        // Hargeisa (~9.52, 44.09) is inside the approximate Somaliland FIR ring.
        const res = await POST(
            makeReq(
                { positions: [{ icao24: 'AAA111', lat: 9.52, lng: 44.09, registration: '6O-ABC' }] },
                'adsb-secret',
            ) as never,
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.aircraft_upserted).toBe(1);
        expect(body.alerts_created).toBe(1);

        // Aircraft upsert keyed by icao24.
        expect(aircraftUpsert).toHaveBeenCalledOnce();
        expect(aircraftUpsert.mock.calls[0][0]).toMatchObject({ icao24: 'AAA111' });
        expect(aircraftUpsert.mock.calls[0][1]).toMatchObject({ onConflict: 'icao24' });

        // Air arrival_alert inserted with mode AIR + aircraft_id, no vessel_id.
        expect(alertInsert).toHaveBeenCalledOnce();
        expect(alertInsert.mock.calls[0][0]).toMatchObject({
            aircraft_id: 'ac-1',
            mode: 'AIR',
            status: 'MATCHED_AUTO',
        });

        // Best-effort proforma enqueue fired for the new alert.
        expect(rpc).toHaveBeenCalledWith('pgmq_enqueue_proforma', { alert_id: 'alert-1' });
    });

    it('a position outside the FIR upserts the aircraft but opens no alert', async () => {
        // Null Island (0,0) is outside the ring.
        const res = await POST(
            makeReq({ positions: [{ icao24: 'BBB222', lat: 0, lng: 0 }] }, 'adsb-secret') as never,
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.aircraft_upserted).toBe(1);
        expect(body.alerts_created).toBe(0);
        expect(alertInsert).not.toHaveBeenCalled();
    });
});
