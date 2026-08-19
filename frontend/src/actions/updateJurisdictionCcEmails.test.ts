import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the tenantContext mock below can return the same jurisdiction id
// used by the "in-jurisdiction" tests (staff jurisdiction must match JID for
// the ok:true cases; a distinct id is used explicitly for the forbidden case).
const { JID } = vi.hoisted(() => ({ JID: '00000000-0000-4000-8000-00000000534f' }));

const getUserMock = vi.fn();
const serverFromMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: getUserMock }, from: serverFromMock }) }));
const platformFromMock = vi.fn();
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({ from: platformFromMock }) }));
vi.mock('@/lib/auth/tenantContext', () => ({ getServerJurisdictionId: vi.fn(async () => JID) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateJurisdictionCcEmails } from './updateJurisdictionCcEmails';

function setup(opts: { role?: string; isActive?: boolean } = {}) {
    const captured = { upsert: null as Record<string, unknown> | null, audit: null as Record<string, unknown> | null };
    serverFromMock.mockImplementation(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: opts.role ?? 'FINANCE_ADMIN', is_active: opts.isActive ?? true } }) }) }) }));
    platformFromMock.mockImplementation((t: string) => {
        if (t === 'jurisdiction_billing_cc') return { upsert: async (p: Record<string, unknown>) => { captured.upsert = p; return { error: null }; } };
        if (t === 'audit_logs') return { insert: async (p: Record<string, unknown>) => { captured.audit = p; return { error: null }; } };
        throw new Error(`platform table ${t}`);
    });
    return captured;
}

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1', email: 'staff@gg.africa' } } });
});

describe('updateJurisdictionCcEmails', () => {
    it('upsert les deux listes + audit', async () => {
        const cap = setup();
        const r = await updateJurisdictionCcEmails({ jurisdictionId: JID, billingCcEmails: ['a@so.gov'], bailiffCcEmails: ['huissier@eidle.so'] });
        expect(r).toMatchObject({ ok: true });
        expect(cap.upsert).toMatchObject({ jurisdiction_id: JID, cc_emails: ['a@so.gov'], bailiff_cc_emails: ['huissier@eidle.so'] });
        expect(cap.audit).toMatchObject({ entity_type: 'Jurisdiction', details_json: expect.objectContaining({ event: 'JURISDICTION_CC_UPDATED' }) });
    });

    it('rejette un e-mail invalide', async () => {
        setup();
        const r = await updateJurisdictionCcEmails({ jurisdictionId: JID, billingCcEmails: ['not-an-email'], bailiffCcEmails: [] });
        expect(r).toMatchObject({ ok: false });
    });

    it('refuse un rôle non-staff', async () => {
        setup({ role: 'SHIPPING_AGENT' });
        const r = await updateJurisdictionCcEmails({ jurisdictionId: JID, billingCcEmails: [], bailiffCcEmails: [] });
        expect(r).toMatchObject({ ok: false });
    });

    it('refuse un staff désactivé', async () => {
        setup({ isActive: false });
        const r = await updateJurisdictionCcEmails({ jurisdictionId: JID, billingCcEmails: [], bailiffCcEmails: [] });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/inactive/i) });
    });

    it('refuse un staff hors juridiction (non-SUPERADMIN)', async () => {
        setup({ role: 'FINANCE_ADMIN' });
        const r = await updateJurisdictionCcEmails({ jurisdictionId: '00000000-0000-4000-8000-00000000444a', billingCcEmails: [], bailiffCcEmails: [] });
        expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
    });
});
