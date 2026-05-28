// frontend/src/app/api/transactions/[id]/proof/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mockGetUser } }) }));

const storageUpload = vi.fn().mockResolvedValue({ error: null });
const svc: Record<string, unknown> = {};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => svc }));

import { POST } from '../route';

function makeReq(): Request {
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'mt103.pdf', { type: 'application/pdf' }));
    return new Request('http://x', { method: 'POST', body: fd });
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    let savedFiles: unknown[] = [];
    (svc as { from: unknown }).from = (table: string) => {
        if (table === 'transactions') {
            return {
                select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 't1', vessel_id: 'v1', payment_proof_files: savedFiles, status: 'PENDING' } }) }) }),
                update: (patch: { payment_proof_files: unknown[] }) => ({ eq: async () => { savedFiles = patch.payment_proof_files; return { error: null }; } }),
            };
        }
        if (table === 'vessels') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { owner_id: 'u1' } }) }) }) };
        if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
        return {};
    };
    (svc as { storage: unknown }).storage = { from: () => ({ upload: storageUpload }) };
});

it('uploads a proof for a transaction owned by the caller', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await POST(makeReq() as never, { params: Promise.resolve({ id: 't1' }) });
    expect(res.status).toBe(200);
    expect(storageUpload).toHaveBeenCalledOnce();
});

it('403 when the caller does not own the vessel', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'someone-else' } } });
    const res = await POST(makeReq() as never, { params: Promise.resolve({ id: 't1' }) });
    expect(res.status).toBe(403);
    expect(storageUpload).not.toHaveBeenCalled();
});
