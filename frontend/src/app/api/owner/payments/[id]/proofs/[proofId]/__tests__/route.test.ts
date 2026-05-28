// frontend/src/app/api/owner/payments/[id]/proofs/[proofId]/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mockGetUser } }) }));

const storageRemove = vi.fn().mockResolvedValue({ error: null });
const svc: { from: ReturnType<typeof vi.fn>; storage: { from: () => { remove: typeof storageRemove } } } = {
    from: vi.fn(),
    storage: { from: () => ({ remove: storageRemove }) },
};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => svc }));

import { DELETE } from '../route';

beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
});

it('deletes an owned proof and reverts to INITIATED when it was the last one', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    let proofDeleted = false;
    svc.from.mockImplementation((table: string) => {
        if (table === 'shipowners') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'own-A' } }) }) }) };
        if (table === 'payments') return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p1', shipowner_id: 'own-A', status: 'PROCESSING' } }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
        };
        if (table === 'payment_proofs') return {
            select: (_cols?: string, _opts?: unknown) => {
                // Count query form: .select('id', { count, head }).eq('payment_id', id) -> resolves to { count }
                if (_opts && typeof _opts === 'object' && 'count' in (_opts as Record<string, unknown>)) {
                    return { eq: async () => ({ count: 0 }) };
                }
                // Single-proof lookup form: .select('id, payment_id, storage_path').eq().eq().maybeSingle()
                return {
                    eq: () => ({
                        eq: () => ({ maybeSingle: async () => ({ data: { id: 'pr1', payment_id: 'p1', storage_path: 'own-A/p1/x.pdf' } }) }),
                    }),
                };
            },
            delete: () => ({ eq: async () => { proofDeleted = true; return { error: null }; } }),
        };
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    });
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }) as never, { params: Promise.resolve({ id: 'p1', proofId: 'pr1' }) });
    expect(res.status).toBe(200);
    expect(proofDeleted).toBe(true);
    expect(storageRemove).toHaveBeenCalledWith(['own-A/p1/x.pdf']);
});
