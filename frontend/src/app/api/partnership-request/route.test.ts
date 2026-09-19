import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RateLimitResult } from '@/lib/rateLimit';

const enforceRateLimit = vi.fn<(...a: unknown[]) => Promise<RateLimitResult>>(
    async () => ({ allowed: true }),
);
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
    getClientId: () => '1.2.3.4',
}));
vi.mock('@/services/emailService', () => ({
    sendPartnershipConfirmationEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'x' }, error: null }) }) }) }),
    }),
}));

beforeEach(() => { enforceRateLimit.mockClear(); enforceRateLimit.mockResolvedValue({ allowed: true }); });

const body = {
    partnershipType: 'technology', orgName: 'Acme', country: 'DJ',
    contactName: 'Jane', contactEmail: 'jane@acme.test', message: 'Hello there, partner.',
};
const req = (b: unknown) => new Request('http://t/api/partnership-request', {
    method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' },
});

describe('POST /api/partnership-request', () => {
    it('returns 429 when rate limited', async () => {
        enforceRateLimit.mockResolvedValue({ allowed: false, reason: 'rate_limited_per_minute' });
        const { POST } = await import('./route');
        const res = await POST(req(body) as never);
        expect(res.status).toBe(429);
    });

    it('processes a valid request when under the limit', async () => {
        const { POST } = await import('./route');
        const res = await POST(req(body) as never);
        expect(res.status).toBe(200);
        expect(enforceRateLimit).toHaveBeenCalledWith('partnership', '1.2.3.4');
    });
});
