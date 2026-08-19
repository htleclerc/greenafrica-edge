import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockEnforce } = vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockEnforce: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({ rpc: mockRpc }),
}));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: mockEnforce,
    getClientId: () => 'test-client',
}));

import { lookupVesselTeaser } from './vesselTeaserService';

const ROW = {
    vessel_name: 'MV DESERT STAR',
    imo_number: '9424223',
    port_call: 'Berbera',
    outstanding_count: 3,
    earliest_due_date: '2026-08-22T00:00:00Z',
    has_overdue: false,
    claimable: true,
};

beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    mockEnforce.mockResolvedValue({ allowed: true });
    mockRpc.mockResolvedValue({ data: [ROW], error: null });
});

describe('lookupVesselTeaser', () => {
    it("retourne OUTSTANDING quand des avis sont en attente", async () => {
        const r = await lookupVesselTeaser('IMO 9424223', 'client-1');
        expect(r.state).toBe('OUTSTANDING');
        expect(r).toMatchObject({ teaser: { vesselName: 'MV DESERT STAR', outstandingCount: 3 } });
    });

    it("ne laisse passer aucun montant dans l'objet retourné", async () => {
        mockRpc.mockResolvedValue({
            data: [{ ...ROW, tax_amount_usd: 12400 }],
            error: null,
        });
        const r = await lookupVesselTeaser('9424223', 'client-1');
        expect(JSON.stringify(r)).not.toContain('12400');
        expect(JSON.stringify(r)).not.toContain('tax_amount');
    });

    it("retourne CLEAR quand le navire existe sans avis en attente", async () => {
        mockRpc.mockResolvedValue({
            data: [{ ...ROW, outstanding_count: 0, claimable: false }],
            error: null,
        });
        const r = await lookupVesselTeaser('9424223', 'client-1');
        expect(r.state).toBe('CLEAR');
    });

    it("retourne UNKNOWN quand la RPC ne renvoie rien", async () => {
        mockRpc.mockResolvedValue({ data: [], error: null });
        expect(await lookupVesselTeaser('9424223', 'client-1')).toEqual({ state: 'UNKNOWN' });
    });

    it("retourne UNKNOWN — pas une erreur distincte — quand le quota est dépassé", async () => {
        // Décision de sécurité : rate-limité et introuvable doivent être
        // indistinguables, sinon le throttling devient un oracle d'énumération.
        mockEnforce.mockResolvedValue({ allowed: false, reason: 'rate_limited_per_minute' });
        expect(await lookupVesselTeaser('9424223', 'client-1')).toEqual({ state: 'UNKNOWN' });
        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("retourne UNKNOWN sur identifiant invalide sans consommer de quota", async () => {
        expect(await lookupVesselTeaser('abc', 'client-1')).toEqual({ state: 'UNKNOWN' });
        expect(mockEnforce).not.toHaveBeenCalled();
        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("retourne UNKNOWN quand la RPC échoue", async () => {
        mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
        expect(await lookupVesselTeaser('9424223', 'client-1')).toEqual({ state: 'UNKNOWN' });
    });
});
