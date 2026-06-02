import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────────────────────────
//
// Hoisted spies so the vi.mock factories (which vitest lifts above imports) can
// reference them without a temporal-dead-zone error.
const mocks = vi.hoisted(() => ({
    requireRoleSpy: vi.fn(),
    createPlatformClientSpy: vi.fn(),
    createTenantClientSpy: vi.fn(),
    createPaymentRequestSpy: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: mocks.requireRoleSpy,
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: mocks.createPlatformClientSpy,
    createTenantClient: mocks.createTenantClientSpy,
}));

vi.mock('@/services/paymentService', () => ({
    createPaymentRequest: mocks.createPaymentRequestSpy,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const txRow = {
    id: '11111111-2222-3333-4444-555555555555',
    jurisdiction_id: 'jur-somaliland',
    vessel_id: null, // null → skip the optional owner-email lookup
    vessel_name: 'MV Test',
    vessel_imo: '1234567',
    tax_amount_usd: 1000,
    transaction_type: 'ENTRY_TAX',
    port_call: 'BERBERA',
    created_at: '2026-01-01T00:00:00Z',
    status: 'PENDING',
};

const auditInsertSpy = vi.fn(async () => ({ error: null }));

const platformMock = {
    from(table: string) {
        if (table === 'transactions') {
            return {
                select: () => ({
                    eq: () => ({
                        single: async () => ({ data: txRow, error: null }),
                    }),
                }),
            };
        }
        throw new Error(`Unexpected platform table: ${table}`);
    },
};

const tenantMock = {
    from(table: string) {
        if (table === 'audit_logs') return { insert: auditInsertSpy };
        if (table === 'vessels' || table === 'profiles') {
            return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
        }
        throw new Error(`Unexpected tenant table: ${table}`);
    },
};

const { POST } = await import('./route');

function buildReq(body: object): NextRequest {
    return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
    vi.clearAllMocks();
    // Default: an authorized SHIPPING_AGENT session.
    mocks.requireRoleSpy.mockImplementation(async () => ({
        user: { id: 'agent-1', fullName: 'Agent One', role: 'SHIPPING_AGENT' },
        supabase: {},
        error: null,
    }));
    mocks.createPlatformClientSpy.mockImplementation(() => platformMock);
    mocks.createTenantClientSpy.mockImplementation(() => tenantMock);
    mocks.createPaymentRequestSpy.mockImplementation(async () => ({
        paymentId: 'pay-1',
        provider: 'stripe',
        status: 'pending',
        checkoutUrl: 'https://checkout.example/session',
    }));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/payments/create — authentication gate', () => {
    it('returns 401 and touches neither the DB nor the payment provider when unauthenticated', async () => {
        mocks.requireRoleSpy.mockImplementation(async () => ({
            user: null,
            supabase: null,
            error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        }));

        const res = await POST(buildReq({ transactionId: txRow.id }));

        expect(res.status).toBe(401);
        // The gate must short-circuit BEFORE any tenant data access or provider call.
        expect(mocks.createPlatformClientSpy).not.toHaveBeenCalled();
        expect(mocks.createTenantClientSpy).not.toHaveBeenCalled();
        expect(mocks.createPaymentRequestSpy).not.toHaveBeenCalled();
        expect(auditInsertSpy).not.toHaveBeenCalled();
    });

    it('returns 403 and creates no payment when the role is not allowed', async () => {
        mocks.requireRoleSpy.mockImplementation(async () => ({
            user: null,
            supabase: null,
            error: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }),
        }));

        const res = await POST(buildReq({ transactionId: txRow.id }));

        expect(res.status).toBe(403);
        expect(mocks.createPlatformClientSpy).not.toHaveBeenCalled();
        expect(mocks.createPaymentRequestSpy).not.toHaveBeenCalled();
    });

    it('gates on the debtor self-pay role plus money-rail admins', async () => {
        await POST(buildReq({ transactionId: txRow.id }));

        expect(mocks.requireRoleSpy).toHaveBeenCalledWith([
            'SHIPPING_AGENT',
            'SUPERADMIN',
            'FINANCE_ADMIN',
        ]);
    });

    it('lets an authorized caller create a payment session', async () => {
        const res = await POST(buildReq({ transactionId: txRow.id }));

        expect(res.status).toBe(200);
        expect(mocks.createPaymentRequestSpy).toHaveBeenCalledTimes(1);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.checkoutUrl).toBe('https://checkout.example/session');
    });
});
