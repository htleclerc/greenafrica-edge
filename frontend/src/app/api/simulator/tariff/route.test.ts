import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock state shared between vi.mock factory and test bodies.
const mocks = vi.hoisted(() => ({
    user: null as { id: string } | null,
    shipownerRow: null as { jurisdiction_id: string; account_state: string } | null,
    tariffRow: null as { rate_per_tco2: number; currency: string } | null,
    jurisdictionIdFromImpl: null as string | null,
    jurisdictionImplThrows: false,
    // Captures the mode value passed to .eq('mode', <value>) on the tariffs query.
    capturedMode: null as string | null,
}));

vi.mock('@/lib/supabase/server', () => {
    return {
        createClient: vi.fn(async () => ({
            auth: {
                getUser: vi.fn(async () => ({
                    data: { user: mocks.user },
                    error: null,
                })),
            },
            from: vi.fn((table: string) => {
                if (table === 'shipowners') {
                    return {
                        select: vi.fn(() => ({
                            eq: vi.fn(() => ({
                                maybeSingle: vi.fn(async () => ({
                                    data: mocks.shipownerRow,
                                    error: null,
                                })),
                            })),
                        })),
                    };
                }
                if (table === 'tariffs') {
                    const tail = {
                        eq: vi.fn(() => ({
                            lte: vi.fn(() => ({
                                or: vi.fn(() => ({
                                    order: vi.fn(() => ({
                                        limit: vi.fn(() => ({
                                            maybeSingle: vi.fn(async () => ({
                                                data: mocks.tariffRow,
                                                error: null,
                                            })),
                                        })),
                                    })),
                                })),
                            })),
                        })),
                    };
                    return {
                        select: vi.fn(() => ({
                            // .eq('jurisdiction_id', ...)
                            eq: vi.fn(() => ({
                                // .eq('mode', <value>) — capture the mode filter
                                eq: vi.fn((_col: string, value: string) => {
                                    mocks.capturedMode = value;
                                    return tail;
                                }),
                            })),
                        })),
                    };
                }
                return {};
            }),
        })),
    };
});

vi.mock('@/lib/auth/tenantContext', () => ({
    _getServerJurisdictionIdImpl: vi.fn(async () => {
        if (mocks.jurisdictionImplThrows || mocks.jurisdictionIdFromImpl === null) {
            throw new Error('getServerJurisdictionId: no jurisdiction resolved');
        }
        return mocks.jurisdictionIdFromImpl;
    }),
}));

import type { NextRequest } from 'next/server';
import { GET } from './route';

// Minimal NextRequest stub: GET() only reads request.nextUrl.searchParams.get('mode').
function makeRequest(mode?: string): NextRequest {
    const url = mode
        ? `http://localhost/api/simulator/tariff?mode=${mode}`
        : 'http://localhost/api/simulator/tariff';
    return { nextUrl: new URL(url) } as unknown as NextRequest;
}

describe('GET /api/simulator/tariff', () => {
    beforeEach(() => {
        mocks.user = null;
        mocks.shipownerRow = null;
        mocks.tariffRow = null;
        mocks.jurisdictionIdFromImpl = null;
        mocks.jurisdictionImplThrows = false;
        mocks.capturedMode = null;
        vi.clearAllMocks();
    });

    it('returns 401 when not authenticated', async () => {
        mocks.user = null;
        const res = await GET(makeRequest());
        expect(res.status).toBe(401);
        const json = await res.json();
        expect(json).toEqual({ error: 'Unauthorized' });
    });

    it('returns 200 with rate for operator with active tariff', async () => {
        mocks.user = { id: 'user-1' };
        mocks.shipownerRow = { jurisdiction_id: 'jid-sl', account_state: 'ACTIVE' };
        mocks.tariffRow = { rate_per_tco2: 40, currency: 'USD' };

        const res = await GET(makeRequest());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ jurisdictionId: 'jid-sl', ratePerTco2: 40, currency: 'USD' });
    });

    it('returns 200 with null rate for non-ACTIVE operator (no staff fallback)', async () => {
        mocks.user = { id: 'user-suspended' };
        mocks.shipownerRow = { jurisdiction_id: 'jid-sl', account_state: 'SUSPENDED' };

        const res = await GET(makeRequest());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ jurisdictionId: null, ratePerTco2: null, currency: 'USD' });
    });

    it('returns 200 with rate for staff when _getServerJurisdictionIdImpl resolves', async () => {
        mocks.user = { id: 'user-2' };
        mocks.shipownerRow = null; // not an operator
        mocks.jurisdictionIdFromImpl = 'jid-sl';
        mocks.tariffRow = { rate_per_tco2: 40, currency: 'USD' };

        const res = await GET(makeRequest());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ jurisdictionId: 'jid-sl', ratePerTco2: 40, currency: 'USD' });
    });

    it('returns 200 with null rate when no active tariff found', async () => {
        mocks.user = { id: 'user-3' };
        mocks.shipownerRow = { jurisdiction_id: 'jid-sl', account_state: 'ACTIVE' };
        mocks.tariffRow = null; // no active tariff

        const res = await GET(makeRequest());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ jurisdictionId: 'jid-sl', ratePerTco2: null, currency: 'USD' });
    });

    it('returns 200 with null rate when jurisdiction resolution throws', async () => {
        mocks.user = { id: 'user-4' };
        mocks.shipownerRow = null; // not an operator
        mocks.jurisdictionImplThrows = true;

        const res = await GET(makeRequest());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ jurisdictionId: null, ratePerTco2: null, currency: 'USD' });
    });

    // ── ?mode= param (CHANTIER 3) ─────────────────────────────────────────────

    it('defaults to MARITIME tariff when ?mode is absent', async () => {
        mocks.user = { id: 'user-1' };
        mocks.shipownerRow = { jurisdiction_id: 'jid-sl', account_state: 'ACTIVE' };
        mocks.tariffRow = { rate_per_tco2: 40, currency: 'USD' };

        await GET(makeRequest());
        expect(mocks.capturedMode).toBe('MARITIME');
    });

    it('queries the AIR tariff matrix when ?mode=AIR', async () => {
        mocks.user = { id: 'user-air' };
        mocks.shipownerRow = { jurisdiction_id: 'jid-sl', account_state: 'ACTIVE' };
        mocks.tariffRow = { rate_per_tco2: 35, currency: 'USD' };

        const res = await GET(makeRequest('AIR'));
        expect(mocks.capturedMode).toBe('AIR');
        const json = await res.json();
        expect(json).toEqual({ jurisdictionId: 'jid-sl', ratePerTco2: 35, currency: 'USD' });
    });

    it('falls back to MARITIME for an invalid ?mode value', async () => {
        mocks.user = { id: 'user-1' };
        mocks.shipownerRow = { jurisdiction_id: 'jid-sl', account_state: 'ACTIVE' };
        mocks.tariffRow = { rate_per_tco2: 40, currency: 'USD' };

        await GET(makeRequest('SPACE'));
        expect(mocks.capturedMode).toBe('MARITIME');
    });
});
