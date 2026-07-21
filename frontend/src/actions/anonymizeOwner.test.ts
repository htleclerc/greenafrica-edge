import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// RGPD Art. 17 — anonymizeOwner — security-sensitive surface
//
// Covers: SUPERADMIN auth gate, idempotence, nominal scrub (iban/contact
// nulled, name kept, anonymized_at set), audit log without personal values,
// linked profile anonymization.
// ─────────────────────────────────────────────────────────────────────────────

interface InsertCall { table: string; payload: Record<string, unknown> }
interface UpdateCall { table: string; patch: Record<string, unknown>; id: string }

let shipownerRow: {
    id: string;
    jurisdiction_id: string;
    anonymized_at: string | null;
    profile_id: string | null;
    proof_doc_url: string | null;
    billing_proof_doc_url: string | null;
} | null = null;

let requireRoleResult: { user: { id: string; fullName: string } | null; supabase: unknown; error: unknown } = {
    user: { id: 'admin-1', fullName: 'Admin One' },
    supabase: null,
    error: null,
};

const insertCalls: InsertCall[] = [];
const updateCalls: UpdateCall[] = [];
const storageRemoveMock = vi.fn(async () => ({ data: null, error: null }));

const mockSupabase = {
    from: vi.fn((table: string) => {
        if (table === 'shipowners') {
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: shipownerRow, error: null }),
                    }),
                }),
                update: (patch: Record<string, unknown>) => ({
                    eq: async (_col: string, id: string) => {
                        updateCalls.push({ table: 'shipowners', patch, id });
                        return { error: null };
                    },
                }),
            };
        }
        if (table === 'profiles') {
            return {
                update: (patch: Record<string, unknown>) => ({
                    eq: async (_col: string, id: string) => {
                        updateCalls.push({ table: 'profiles', patch, id });
                        return { error: null };
                    },
                }),
            };
        }
        if (table === 'audit_logs') {
            return {
                insert: async (payload: Record<string, unknown>) => {
                    insertCalls.push({ table, payload });
                    return { error: null };
                },
            };
        }
        return {} as never;
    }),
    storage: {
        from: vi.fn(() => ({
            remove: storageRemoveMock,
        })),
    },
};

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockSupabase),
    createTenantClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/auth/adminTenant', () => ({
    assertAdminCanActOn: vi.fn(async (_user: unknown, jid: string) => jid),
}));

vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => requireRoleResult),
}));

beforeEach(() => {
    shipownerRow = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        jurisdiction_id: '00000000-0000-4000-8000-00000000534f',
        anonymized_at: null,
        profile_id: 'profile-abc12345',
        proof_doc_url: 'shipowner-kyc/proof.pdf',
        billing_proof_doc_url: 'shipowner-kyc/billing.pdf',
    };
    requireRoleResult = {
        user: { id: 'admin-1', fullName: 'Admin One' },
        supabase: null,
        error: null,
    };
    insertCalls.length = 0;
    updateCalls.length = 0;
    storageRemoveMock.mockClear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    vi.clearAllMocks();
});

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('anonymizeOwner', () => {
    it('rejects callers without SUPERADMIN role', async () => {
        requireRoleResult = { user: null, supabase: null, error: { status: 403 } };
        const { anonymizeOwner } = await import('./anonymizeOwner');
        const result = await anonymizeOwner({ shipownerId: VALID_UUID });
        expect(result.ok).toBe(false);
        expect(updateCalls.find((c) => c.table === 'shipowners')).toBeUndefined();
    });

    it('rejects non-uuid shipownerId via Zod', async () => {
        const { anonymizeOwner } = await import('./anonymizeOwner');
        await expect(anonymizeOwner({ shipownerId: 'not-a-uuid' })).rejects.toThrow();
    });

    it('returns not found when shipowner does not exist', async () => {
        shipownerRow = null;
        const { anonymizeOwner } = await import('./anonymizeOwner');
        const result = await anonymizeOwner({ shipownerId: VALID_UUID });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/not found/i);
    });

    it('is idempotent when already anonymized — no new update', async () => {
        shipownerRow = {
            id: VALID_UUID,
            jurisdiction_id: '00000000-0000-4000-8000-00000000534f',
            anonymized_at: '2026-01-01T00:00:00.000Z',
            profile_id: null,
            proof_doc_url: null,
            billing_proof_doc_url: null,
        };
        const { anonymizeOwner } = await import('./anonymizeOwner');
        const result = await anonymizeOwner({ shipownerId: VALID_UUID });
        expect(result).toEqual({ ok: true, alreadyAnonymized: true });
        expect(updateCalls.find((c) => c.table === 'shipowners')).toBeUndefined();
        expect(insertCalls.find((c) => c.table === 'audit_logs')).toBeUndefined();
    });

    it('nominal path: scrubs contact/bank fields, keeps name untouched, sets anonymized_at, anonymizes profile, audits without personal values', async () => {
        const { anonymizeOwner } = await import('./anonymizeOwner');
        const result = await anonymizeOwner({ shipownerId: VALID_UUID });
        expect(result.ok).toBe(true);

        const shipownerUpdate = updateCalls.find((c) => c.table === 'shipowners');
        expect(shipownerUpdate).toBeDefined();
        expect(shipownerUpdate!.patch.iban).toBeNull();
        expect(shipownerUpdate!.patch.official_email).toBeNull();
        expect(shipownerUpdate!.patch.phone_e164).toBeNull();
        expect(shipownerUpdate!.patch.aliases).toEqual([]);
        expect(shipownerUpdate!.patch.anonymized_at).toEqual(expect.any(String));
        expect(shipownerUpdate!.patch).not.toHaveProperty('name');
        expect(shipownerUpdate!.patch).not.toHaveProperty('billing_legal_name');
        expect(shipownerUpdate!.patch).not.toHaveProperty('imo_company_no');
        expect(shipownerUpdate!.patch).not.toHaveProperty('jurisdiction_id');

        const profileUpdate = updateCalls.find((c) => c.table === 'profiles');
        expect(profileUpdate).toBeDefined();
        expect(profileUpdate!.patch.email).toBe('anon-profile-@anonymized.invalid');
        expect(profileUpdate!.patch.full_name).toBe('ANONYMIZED');

        expect(storageRemoveMock).toHaveBeenCalledWith(['shipowner-kyc/proof.pdf', 'shipowner-kyc/billing.pdf']);

        const audit = insertCalls.find((c) => c.table === 'audit_logs');
        expect(audit).toBeDefined();
        expect(audit!.payload).toMatchObject({
            user_id: 'admin-1',
            action: 'SHIPOWNER_ANONYMIZED',
            severity: 'CRITICAL',
            entity_type: 'Shipowner',
            entity_id: VALID_UUID,
        });
        const details = audit!.payload.details_json as Record<string, unknown>;
        expect(details.event).toBe('SHIPOWNER_ANONYMIZED');
        expect(Array.isArray(details.scrubbed_fields)).toBe(true);
        const serialized = JSON.stringify(audit!.payload);
        expect(serialized).not.toMatch(/@(?!anonymized\.invalid)/); // no real email leaked
    });
});
