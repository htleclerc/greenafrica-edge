import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 9: revealOwnerRefundIban — security-sensitive surface
//
// Covers: auth gate, missing-IBAN error, happy path decrypt, audit log written.
// ─────────────────────────────────────────────────────────────────────────────

interface InsertCall { table: string; payload: Record<string, unknown> }

let shipownerRow: { iban: string | null; jurisdiction_id?: string } | null = null;
let requireRoleResult: { user: { id: string; fullName: string } | null; supabase: unknown; error: unknown } = {
    user: { id: 'admin-1', fullName: 'Admin One' },
    supabase: null,
    error: null,
};
const insertCalls: InsertCall[] = [];
const decryptIbanMock = vi.fn();

const mockSupabase = {
    from: vi.fn((table: string) => {
        if (table === 'shipowners') {
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: shipownerRow, error: null }),
                    }),
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

vi.mock('@/services/kycService', () => ({
    decryptIban: decryptIbanMock,
}));

beforeEach(() => {
    shipownerRow = { iban: 'encrypted-iban-token', jurisdiction_id: '00000000-0000-4000-8000-00000000534f' };
    requireRoleResult = {
        user: { id: 'admin-1', fullName: 'Admin One' },
        supabase: null,
        error: null,
    };
    insertCalls.length = 0;
    decryptIbanMock.mockReset();
    decryptIbanMock.mockResolvedValue('FR7630006000011234567890189');
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    vi.clearAllMocks();
});

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('revealOwnerRefundIban', () => {
    it('rejects callers without FINANCE_ADMIN or SUPERADMIN role', async () => {
        requireRoleResult = { user: null, supabase: null, error: { status: 403 } };
        const { revealOwnerRefundIban } = await import('./revealOwnerRefundIban');
        const result = await revealOwnerRefundIban({ shipownerId: VALID_UUID });
        expect(result.ok).toBe(false);
    });

    it('rejects non-uuid shipownerId via Zod', async () => {
        const { revealOwnerRefundIban } = await import('./revealOwnerRefundIban');
        await expect(revealOwnerRefundIban({ shipownerId: 'not-a-uuid' })).rejects.toThrow();
    });

    it('returns error when shipowner not found', async () => {
        shipownerRow = null;
        const { revealOwnerRefundIban } = await import('./revealOwnerRefundIban');
        const result = await revealOwnerRefundIban({ shipownerId: VALID_UUID });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/not found|no iban/i);
    });

    it('returns error when shipowner has no IBAN on file', async () => {
        shipownerRow = { iban: null };
        const { revealOwnerRefundIban } = await import('./revealOwnerRefundIban');
        const result = await revealOwnerRefundIban({ shipownerId: VALID_UUID });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/no iban|not found/i);
        expect(decryptIbanMock).not.toHaveBeenCalled();
    });

    it('happy path: returns decrypted IBAN and writes audit log', async () => {
        const { revealOwnerRefundIban } = await import('./revealOwnerRefundIban');
        const result = await revealOwnerRefundIban({ shipownerId: VALID_UUID });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.iban).toBe('FR7630006000011234567890189');
        expect(decryptIbanMock).toHaveBeenCalledWith('encrypted-iban-token');

        const audit = insertCalls.find((c) => c.table === 'audit_logs');
        expect(audit).toBeDefined();
        expect(audit!.payload).toMatchObject({
            user_id: 'admin-1',
            action: 'TRANSACTION_UPDATED',
            entity_type: 'Shipowner',
            entity_id: VALID_UUID,
        });
        const details = audit!.payload.details_json as Record<string, unknown>;
        expect(details.event).toBe('IBAN_REVEALED');
    });
});
