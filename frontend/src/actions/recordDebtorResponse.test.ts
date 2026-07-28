import { describe, it, expect, vi, beforeEach } from 'vitest';

const authUser = { id: 'staff-1' };

// vi.mock factories are hoisted above module-level const declarations, so the
// mock fns they close over must themselves be created via vi.hoisted().
const { getUserMock, serverFromMock, platformFromMock, getJurMock } = vi.hoisted(() => ({
    getUserMock: vi.fn(),
    serverFromMock: vi.fn(),
    platformFromMock: vi.fn(),
    getJurMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: getUserMock }, from: serverFromMock }),
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: platformFromMock }),
}));

vi.mock('@/lib/auth/tenantContext', () => ({ getServerJurisdictionId: getJurMock }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { recordDebtorResponse } from './recordDebtorResponse';

// Helpers pour scripter les tables du client platform.
function platformTables(tables: Record<string, unknown>) {
    platformFromMock.mockImplementation((t: string) => tables[t]);
}

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: authUser } });
    // profiles.role (server client) → FINANCE_ADMIN par défaut
    serverFromMock.mockImplementation((t: string) => {
        if (t === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'FINANCE_ADMIN' } }) }) }) };
        throw new Error(`unexpected server table ${t}`);
    });
    getJurMock.mockResolvedValue('jur-so');
});

const okInput = { transactionId: '11111111-1111-4111-8111-111111111111', responseType: 'DISPUTE' as const };

describe('recordDebtorResponse', () => {
    it('refuse une entrée invalide', async () => {
        const r = await recordDebtorResponse({ transactionId: 'not-a-uuid', responseType: 'DISPUTE' });
        expect(r).toMatchObject({ ok: false });
    });

    it('refuse un rôle non-staff', async () => {
        serverFromMock.mockImplementation(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'SHIPPING_AGENT' } }) }) }) }));
        const r = await recordDebtorResponse(okInput);
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/role/i) });
    });

    it('refuse un staff hors juridiction', async () => {
        getJurMock.mockResolvedValue('jur-dj'); // ≠ jur-so de la transaction
        platformTables({
            transactions: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { jurisdiction_id: 'jur-so' } }) }) }) },
        });
        const r = await recordDebtorResponse(okInput);
        expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
    });

    it('refuse une créance sans relance', async () => {
        platformTables({
            transactions: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { jurisdiction_id: 'jur-so' } }) }) }) },
            collection_reminders: { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) },
        });
        const r = await recordDebtorResponse(okInput);
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/no reminder/i) });
    });

    it('stampe la relance la plus récente et audite', async () => {
        const updateSpy = vi.fn((_payload: Record<string, unknown>) => ({ eq: async () => ({ error: null }) }));
        const auditInsertSpy = vi.fn(async () => ({ error: null }));
        platformTables({
            transactions: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { jurisdiction_id: 'jur-so' } }) }) }) },
            collection_reminders: {
                select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: 'rem-latest', tier: 'J15', debtor_response_type: 'SILENT' } }) }) }) }) }),
                update: (payload: Record<string, unknown>) => { updateSpy(payload); return { eq: async () => ({ error: null }) }; },
            },
            audit_logs: { insert: auditInsertSpy },
        });
        const r = await recordDebtorResponse(okInput);
        expect(r).toMatchObject({ ok: true, tier: 'J15' });
        expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ debtor_response_type: 'DISPUTE' }));
        expect(auditInsertSpy).toHaveBeenCalledWith(expect.objectContaining({
            action: 'TRANSACTION_UPDATED',
            details_json: expect.objectContaining({ event: 'DEBTOR_RESPONSE_RECORDED', newResponse: 'DISPUTE' }),
        }));
    });

    it('laisse passer un SUPERADMIN hors de sa juridiction courante', async () => {
        serverFromMock.mockImplementation(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'SUPERADMIN' } }) }) }) }));
        getJurMock.mockResolvedValue('jur-dj');
        const updateSpy = vi.fn((_payload: Record<string, unknown>) => ({ eq: async () => ({ error: null }) }));
        platformTables({
            transactions: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { jurisdiction_id: 'jur-so' } }) }) }) },
            collection_reminders: {
                select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: 'r1', tier: 'J30', debtor_response_type: 'SILENT' } }) }) }) }) }),
                update: (p: Record<string, unknown>) => { updateSpy(p); return { eq: async () => ({ error: null }) }; },
            },
            audit_logs: { insert: async () => ({ error: null }) },
        });
        const r = await recordDebtorResponse(okInput);
        expect(r).toMatchObject({ ok: true });
        expect(updateSpy).toHaveBeenCalled();
    });
});
