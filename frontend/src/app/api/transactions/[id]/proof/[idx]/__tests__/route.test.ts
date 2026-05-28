import { it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mockGetUser } }) }));

const createSignedUrl = vi.fn();
const svc: Record<string, unknown> = {};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => svc }));

import { GET } from '../route';

const PROOF = { path: 'legacy/t1/a.pdf', mime_type: 'application/pdf', size_bytes: 10, uploaded_at: '2026-01-01T00:00:00Z' };

// Configure the service-role client mock. `ownerId` is the vessel owner,
// `role` is the caller's profiles.role (null = no/shipowner profile).
function setupSvc(opts: { ownerId: string; role: string | null; files?: unknown[] }) {
    const files = opts.files ?? [PROOF];
    (svc as { from: unknown }).from = (table: string) => {
        if (table === 'transactions') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { payment_proof_files: files, vessel_id: 'v1' } }) }) }) };
        }
        if (table === 'vessels') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { owner_id: opts.ownerId } }) }) }) };
        }
        if (table === 'profiles') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.role === null ? null : { role: opts.role } }) }) }) };
        }
        return {};
    };
    (svc as { storage: unknown }).storage = { from: () => ({ createSignedUrl }) };
}

function makeCtx(idx = '0') {
    return { params: Promise.resolve({ id: 't1', idx }) };
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null });
});

it('200 with a url when the caller owns the vessel', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } });
    setupSvc({ ownerId: 'owner-1', role: null });
    const res = await GET({} as never, makeCtx('0'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://signed/x' });
    expect(createSignedUrl).toHaveBeenCalledOnce();
});

it('403 for a foreign non-staff caller, and never signs a URL', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'intruder' } } });
    setupSvc({ ownerId: 'owner-1', role: null });
    const res = await GET({} as never, makeCtx('0'));
    expect(res.status).toBe(403);
    expect(createSignedUrl).not.toHaveBeenCalled();
});

it('200 with a url for a staff caller (FINANCE_ADMIN) who is not the owner', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'finance-1' } } });
    setupSvc({ ownerId: 'owner-1', role: 'FINANCE_ADMIN' });
    const res = await GET({} as never, makeCtx('0'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://signed/x' });
    expect(createSignedUrl).toHaveBeenCalledOnce();
});

it('403 for a SHIPPING_AGENT who is not the owner (fleet-scoped, not staff here)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'agent-1' } } });
    setupSvc({ ownerId: 'owner-1', role: 'SHIPPING_AGENT' });
    const res = await GET({} as never, makeCtx('0'));
    expect(res.status).toBe(403);
    expect(createSignedUrl).not.toHaveBeenCalled();
});

it('400 for an out-of-range idx for an authorized caller', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } });
    setupSvc({ ownerId: 'owner-1', role: null });
    const res = await GET({} as never, makeCtx('5'));
    expect(res.status).toBe(400);
    expect(createSignedUrl).not.toHaveBeenCalled();
});

it('401 when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    setupSvc({ ownerId: 'owner-1', role: null });
    const res = await GET({} as never, makeCtx('0'));
    expect(res.status).toBe(401);
    expect(createSignedUrl).not.toHaveBeenCalled();
});
