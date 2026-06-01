// frontend/src/app/api/owner/payments/[id]/proofs/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
let mockSessionShipowner: { id: string; jurisdiction_id: string } | null = null;
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: mockGetUser },
        // The owner's own shipowner row is now resolved via the RLS session client.
        from: (table: string) => {
            if (table === 'shipowners') {
                return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockSessionShipowner, error: null }) }) }) };
            }
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        },
    }),
}));

// Privileged payment/proof ops go through the tenant-scoped factory.
const svc = { from: vi.fn() };
vi.mock('@/lib/supabase/tenant', () => ({ createTenantClient: () => svc }));

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
    // Shipowner self-lookup resolves via the session client (configured above).
    mockSessionShipowner = { id: opts.shipownerId, jurisdiction_id: '00000000-0000-4000-8000-00000000534f' };
    svc.from.mockImplementation((table: string) => {
        if (table === 'payments') {
            return {
                select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p1', shipowner_id: opts.paymentShipownerId, status: opts.status }, error: null }) }) }),
                update: () => ({ eq: async () => ({ error: null }) }),
            };
        }
        // audit_logs.insert (and any other passthrough table)
        return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
            insert: async () => ({ error: null }),
        };
    });
}

describe('POST /api/owner/payments/[id]/proofs', () => {
    beforeEach(() => { vi.clearAllMocks(); mockSessionShipowner = null; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; });

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
