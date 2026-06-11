/**
 * route.test.ts — multi-jurisdiction FIR coverage
 *
 * Each test resets the module registry (vi.resetModules + vi.doMock + dynamic
 * import) so the module-level firCache is fresh. vi.doMock is NOT hoisted by
 * Vitest so it only applies after the explicit resetModules call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── FIR ring fixtures (from mig 082 geofences seeds) ────────────────────────
const SO_JID = '00000000-0000-4000-8000-00000000534f';
const DJ_JID = '00000000-0000-4000-8000-00000000444a';

// SO FIR: lat [7.5, 11.8], lng [43.45, 49.5] — west edge de-overlapped from 42.5
const SO_RING = [
  { lat: 7.5, lng: 43.45 },
  { lat: 7.5, lng: 49.5 },
  { lat: 11.8, lng: 49.5 },
  { lat: 11.8, lng: 43.45 },
  { lat: 7.5, lng: 43.45 },
];

// DJ FIR: lat [10.9, 12.8], lng [41.7, 43.45]
const DJ_RING = [
  { lat: 10.9, lng: 41.7 },
  { lat: 10.9, lng: 43.45 },
  { lat: 12.8, lng: 43.45 },
  { lat: 12.8, lng: 41.7 },
  { lat: 10.9, lng: 41.7 },
];

const GEOFENCE_ROWS_OK = [
  { jurisdiction_id: DJ_JID, ring: DJ_RING },
  { jurisdiction_id: SO_JID, ring: SO_RING },
];

const SECRET = 'test-adsb-secret';

function makeRequest(body: unknown) {
  return new Request('http://x/api/adsb/ingest', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

// Build a mock createPlatformClient. `geofencesData` controls what geofences
// returns; `operatorId` controls whether GHOST path runs (null = GHOST).
function makeMockCreatePlatformClient(opts: {
  geofencesData?: typeof GEOFENCE_ROWS_OK | null;
  geofencesError?: boolean;
  operatorId?: string | null;
}) {
  const insertedShipowners: unknown[] = [];
  const insertedPositions: unknown[] = [];
  const insertedAlerts: unknown[] = [];

  const geofencesResult = opts.geofencesError
    ? { data: null, error: { message: 'DB error' } }
    : opts.geofencesData === null
      ? { data: [], error: null }
      : { data: opts.geofencesData ?? GEOFENCE_ROWS_OK, error: null };

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'geofences') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue(geofencesResult),
            })),
          })),
        };
      }
      if (table === 'aircraft') {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'ac-uuid',
                    operator_id: opts.operatorId !== undefined ? opts.operatorId : 'op-uuid',
                  },
                  error: null,
                }),
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        };
      }
      if (table === 'shipowners') {
        return {
          insert: vi.fn((row: unknown) => {
            insertedShipowners.push(row);
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: { id: 'ghost-uuid' }, error: null }),
              })),
            };
          }),
        };
      }
      if (table === 'aircraft_positions') {
        return {
          insert: vi.fn((row: unknown) => {
            insertedPositions.push(row);
            return Promise.resolve({ error: null });
          }),
        };
      }
      if (table === 'arrival_alerts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              not: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
          insert: vi.fn((row: unknown) => {
            insertedAlerts.push(row);
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: { id: 'alert-uuid' }, error: null }),
              })),
            };
          }),
        };
      }
      return {};
    }),
    rpc: vi.fn().mockResolvedValue({ error: null }),
  };

  return {
    createPlatformClient: vi.fn(() => client),
    insertedShipowners,
    insertedPositions,
    insertedAlerts,
  };
}

// ─── Per-test setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.ADSB_INGEST_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
});

afterEach(() => {
  vi.resetModules(); // Clear module cache so firCache resets between tests
});

// Helper: set up the tenant mock + dynamically import the route (cache-clean)
async function importRoute(opts: Parameters<typeof makeMockCreatePlatformClient>[0]) {
  const mock = makeMockCreatePlatformClient(opts);
  vi.doMock('@/lib/supabase/tenant', () => ({
    createPlatformClient: mock.createPlatformClient,
  }));
  const { POST } = await import('./route');
  return { POST, ...mock };
}

describe('POST /api/adsb/ingest — multi-jurisdiction FIR', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const { POST } = await importRoute({});
    const req = new Request('http://x/api/adsb/ingest', {
      method: 'POST',
      body: JSON.stringify({ positions: [{ icao24: 'X', lat: 9, lng: 44 }] }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 for wrong secret', async () => {
    const { POST } = await importRoute({});
    const req = new Request('http://x/api/adsb/ingest', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
      body: JSON.stringify({ positions: [{ icao24: 'X', lat: 9, lng: 44 }] }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('case 1: position inside DJ FIR (11.55, 43.16) → alert created with DJ jurisdiction', async () => {
    vi.resetModules();
    const { POST, insertedAlerts } = await importRoute({ operatorId: 'op-1' });
    const res = await POST(makeRequest({ positions: [{ icao24: 'DJ001', lat: 11.55, lng: 43.16 }] }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.alerts_created).toBe(1);
    expect(insertedAlerts).toHaveLength(1);
    expect((insertedAlerts[0] as Record<string, unknown>).jurisdiction_id).toBe(DJ_JID);
    // Sanity: aircraft_id wired correctly
    expect((insertedAlerts[0] as Record<string, unknown>).aircraft_id).toBe('ac-uuid');
  });

  it('case 2: position inside SO FIR (9.56, 44.08) → alert created with SO jurisdiction', async () => {
    vi.resetModules();
    const { POST, insertedAlerts } = await importRoute({ operatorId: 'op-2' });
    const res = await POST(makeRequest({ positions: [{ icao24: 'SO001', lat: 9.56, lng: 44.08 }] }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.alerts_created).toBe(1);
    expect(insertedAlerts).toHaveLength(1);
    expect((insertedAlerts[0] as Record<string, unknown>).jurisdiction_id).toBe(SO_JID);
  });

  it('case 3: shared edge (11.00, 43.45) → exactly one alert, jurisdiction = SO', async () => {
    // lng 43.45 is the shared boundary between DJ FIR (right edge) and SO FIR
    // (left edge). The strict half-open ray-cast uses `xi > lng` (strict), so
    // a vertex exactly at lng 43.45 is NOT counted as crossing — the point
    // resolves to exactly one ring. Geofences are ordered DJ first, so DJ is
    // checked first; a boundary point not matching DJ falls through to SO.
    vi.resetModules();
    const { POST, insertedAlerts } = await importRoute({ operatorId: 'op-3' });
    const res = await POST(makeRequest({ positions: [{ icao24: 'EDGE01', lat: 11.0, lng: 43.45 }] }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    // Exactly one alert — no double-billing from both FIRs
    expect(json.alerts_created).toBe(1);
    expect(insertedAlerts).toHaveLength(1);
    expect((insertedAlerts[0] as Record<string, unknown>).jurisdiction_id).toBe(SO_JID);
  });

  it('case 4: position outside both FIRs (2.0, 30.0) → no alert, in_fir=false', async () => {
    vi.resetModules();
    const { POST, insertedAlerts, insertedPositions } = await importRoute({ operatorId: 'op-4' });
    const res = await POST(makeRequest({ positions: [{ icao24: 'OUT001', lat: 2.0, lng: 30.0 }] }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.alerts_created).toBe(0);
    expect(insertedAlerts).toHaveLength(0);
    expect(insertedPositions).toHaveLength(1);
    expect((insertedPositions[0] as Record<string, unknown>).in_fir).toBe(false);
  });

  it('case 5: geofences load error → 500, message = FIR geofences unavailable, zero inserts', async () => {
    vi.resetModules();
    const { POST, insertedAlerts, insertedPositions } = await importRoute({ geofencesError: true });
    const res = await POST(makeRequest({ positions: [{ icao24: 'ERR001', lat: 9.56, lng: 44.08 }] }) as never);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('FIR geofences unavailable');
    expect(insertedAlerts).toHaveLength(0);
    expect(insertedPositions).toHaveLength(0);
  });

  it('case 6: GHOST operator created inside DJ FIR gets jurisdiction_id DJ', async () => {
    vi.resetModules();
    // operatorId: null → GHOST path triggers
    const { POST, insertedShipowners } = await importRoute({ operatorId: null });
    const res = await POST(
      makeRequest({ positions: [{ icao24: 'DJ_GHOST', lat: 11.55, lng: 43.16, registration: 'DJ-XYZ' }] }) as never,
    );
    expect(res.status).toBe(200);
    expect(insertedShipowners).toHaveLength(1);
    const ghost = insertedShipowners[0] as Record<string, unknown>;
    expect(ghost.account_state).toBe('GHOST');
    expect(ghost.applicable_modes).toEqual(['AIR']);
    expect(ghost.jurisdiction_id).toBe(DJ_JID);
  });

  it('GHOST operator created outside any FIR omits jurisdiction_id (column DEFAULT)', async () => {
    vi.resetModules();
    const { POST, insertedShipowners } = await importRoute({ operatorId: null });
    const res = await POST(makeRequest({ positions: [{ icao24: 'OUT_GHOST', lat: 2.0, lng: 30.0 }] }) as never);
    expect(res.status).toBe(200);
    expect(insertedShipowners).toHaveLength(1);
    const ghost = insertedShipowners[0] as Record<string, unknown>;
    // No jurisdiction_id set — column DEFAULT applies
    expect(ghost.jurisdiction_id).toBeUndefined();
  });
});
