import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabase = {
    from: vi.fn(),
};

const mockChain = {
    select: vi.fn(() => mockChain),
    eq: vi.fn(() => mockChain),
    order: vi.fn(() => mockChain),
    limit: vi.fn(() => mockChain),
    insert: vi.fn(async () => ({ error: null })),
    maybeSingle: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.from.mockReturnValue(mockChain as any);
});

describe('lockRate', () => {
    it('returns USD passthrough without DB call when currency=USD', async () => {
        const { lockRate } = await import('./fxRateService');
        const r = await lockRate(mockSupabase as any, 'USD');
        expect(r).toEqual({ rate: 1, source: 'IDENTITY', lockedAt: expect.any(String) });
        expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('returns cached rate when fetched_at is < 24h old', async () => {
        const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();  // 1h ago
        mockChain.maybeSingle.mockResolvedValueOnce({
            data: { rate: 0.92, source: 'OPENEXCHANGERATES', fetched_at: recent },
            error: null,
        });

        const { lockRate } = await import('./fxRateService');
        const r = await lockRate(mockSupabase as any, 'EUR');
        expect(r.rate).toBe(0.92);
        expect(r.source).toBe('OPENEXCHANGERATES');
    });

    it('throws when OXR fetch returns non-ok and no cached rate exists', async () => {
        mockChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
        global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 } as any);
        process.env.OPENEXCHANGE_RATES_API_KEY = 'test-key';

        const { lockRate } = await import('./fxRateService');
        await expect(lockRate(mockSupabase as any, 'EUR')).rejects.toThrow(/FX rate fetch failed/);
    });
});
