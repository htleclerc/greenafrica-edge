// frontend/src/app/api/owner/payments/[id]/proofs/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: mockGetUser } }),
}));

const svc = { from: vi.fn() };
vi.mock('@supabase/supabase-js', () => ({ createClient: () => svc }));

const mockUpload = vi.fn();
const mockList = vi.fn();
vi.mock('@/services/paymentProofService', () => ({
    uploadProof: (...a: unknown[]) => mockUpload(...a),
    listProofs: (...a: unknown[]) => mockList(...a),
}));

import { GET, POST } from '../route';

function makeReqWithFile(): Request {
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'mt103.pdf', { type: 'application/pdf' }));
    return new Request('http://x/api/owner/payments/p1/proofs', { method: 'POST', body: fd });
}

function stubOwnership(opts: { shipownerId: string; paymentShipownerId: string; status: string }) {
    svc.from.mockImplementation((table: string) => {
        if (table === 'shipowners') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: opts.shipownerId }, error: null }) }) }) };
        }
        if (table === 'payments') {
            return {
                select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p1', shipowner_id: opts.paymentShipownerId, status: opts.status }, error: null }) }) }),
                update: () => ({ eq: async () => ({ error: null }) }),
            };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    });
}

describe('POST /api/owner/payments/[id]/proofs', () => {
    beforeEach(() => { vi.clearAllMocks(); process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; });

    it('401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null } });
        const res = await POST(makeReqWithFile() as never, { params: Promise.resolve({ id: 'p1' }) });
        expect(res.status).toBe(401);
    });

    it('403 when the payment belongs to a different shipowner', async () => {
        mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
        stubOwnership({ shipownerId: 'own-A', paymentShipownerId: 'own-B', status: 'INITIATED' });
        const res = await POST(makeReqWithFile() as never, { params: Promise.resolve({ id: 'p1' }) });
        expect(res.status).toBe(403);
        expect(mockUpload).not.toHaveBeenCalled();
    });

    it('uploads and returns the proof for an owned INITIATED payment', async () => {
        mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
        stubOwnership({ shipownerId: 'own-A', paymentShipownerId: 'own-A', status: 'INITIATED' });
        mockUpload.mockResolvedValue({ id: 'pr1', storage_path: 'own-A/p1/123-mt103.pdf' });
        const res = await POST(makeReqWithFile() as never, { params: Promise.resolve({ id: 'p1' }) });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.proof.id).toBe('pr1');
        expect(mockUpload).toHaveBeenCalledOnce();
    });
});
