import { describe, it, expect, vi, beforeEach } from 'vitest';

const { JID } = vi.hoisted(() => ({ JID: '00000000-0000-4000-8000-00000000534f' }));
const OTHER_JID = '00000000-0000-4000-8000-0000000000d1';

const getUserMock = vi.fn();
const serverFromMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: getUserMock }, from: serverFromMock }),
}));
const platformFromMock = vi.fn();
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({ from: platformFromMock }) }));
vi.mock('@/lib/auth/tenantContext', () => ({ getServerJurisdictionId: vi.fn(async () => JID) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateIssuerProfile } from './updateIssuerProfile';

const ACCOUNT = {
    label: 'SEPA', currency: 'USD', holder: 'Solide Technology Limited',
    iban: 'MT12SYPL39480821090981701607644', swift: 'SYPLMTM2XXX',
    bank: 'SYSTEM PAY SERVICES (MALTA) LIMITED', is_primary: true,
};

/** Jeu valide minimal ; les tests n'en modifient qu'un champ à la fois. */
function input(over: Record<string, unknown> = {}) {
    return {
        jurisdictionId: JID,
        issuerName: 'SOLIDE TECHNOLOGY (Concessionaire)',
        issuerLegalName: 'SOLIDE TECHNOLOGY LIMITED',
        issuerAddress: 'Masalaha Street, Hargeisa, Somaliland',
        sovereignLine: 'Republic of Somaliland',
        supervisingMinistry: 'Ministry of Environment & Climate Change',
        authorityLine: 'Maritime Carbon Tax Authority',
        decreeReference: 'MOE&CC/MWI/36/2026',
        directorName: 'Noel KPATCHAVI',
        directorTitle: 'Director, Solide Technology',
        directorEmail: 'st.operations@greengate.africa',
        directorPhone: '+33 7 51 42 23 84',
        operationsEmail: 'st.operations@greengate.africa',
        billingEmail: 'billing@greengate.africa',
        paymentTermsDays: 45,
        latePenaltyUsd: 20000,
        disputePeriodDays: 10,
        escalationLine: 'Reminder > formal notice > bailiff',
        bailiffName: 'Eidle Advocats',
        legalBasisUrl: 'https://greengate.africa/legal-basis',
        bankAccounts: [ACCOUNT],
        ...over,
    };
}

function setup(opts: { role?: string; isActive?: boolean; defaultExists?: boolean } = {}) {
    const captured = {
        upsert: null as Record<string, unknown> | null,
        update: null as Record<string, unknown> | null,
        insert: null as Record<string, unknown> | null,
        audit: null as Record<string, unknown> | null,
    };
    serverFromMock.mockImplementation(() => ({
        select: () => ({ eq: () => ({ single: async () => ({
            data: { role: opts.role ?? 'FINANCE_ADMIN', is_active: opts.isActive ?? true, full_name: 'Staff' },
        }) }) }),
    }));
    platformFromMock.mockImplementation((t: string) => {
        if (t === 'jurisdiction_issuer_profile') {
            return {
                select: () => ({ is: () => ({ maybeSingle: async () => ({
                    data: opts.defaultExists === false ? null : { id: 'row-default' },
                }) }) }),
                upsert: async (p: Record<string, unknown>) => { captured.upsert = p; return { error: null }; },
                update: (p: Record<string, unknown>) => { captured.update = p; return { eq: async () => ({ error: null }) }; },
                insert: async (p: Record<string, unknown>) => { captured.insert = p; return { error: null }; },
            };
        }
        if (t === 'audit_logs') {
            return { insert: async (p: Record<string, unknown>) => { captured.audit = p; return { error: null }; } };
        }
        throw new Error(`platform table ${t}`);
    });
    return captured;
}

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1', email: 'staff@gg.africa' } } });
});

describe('updateIssuerProfile', () => {
    it('ecrit le profil d une juridiction et journalise en WARNING', async () => {
        const cap = setup();
        const r = await updateIssuerProfile(input());
        expect(r).toMatchObject({ ok: true });
        expect(cap.upsert).toMatchObject({ jurisdiction_id: JID, payment_terms_days: 45 });
        // WARNING : c'est l'entree qu'on relira pour savoir qui a change le
        // compte imprime sur les factures.
        expect(cap.audit).toMatchObject({
            severity: 'WARNING',
            details_json: expect.objectContaining({ event: 'ISSUER_PROFILE_UPDATED', scope: 'jurisdiction' }),
        });
    });

    it('ne journalise pas l IBAN complet', async () => {
        // Il est deja publie sur chaque facture ; le detenteur et le BIC
        // suffisent a reperer un changement de compte.
        const cap = setup();
        await updateIssuerProfile(input());
        expect(JSON.stringify(cap.audit)).not.toContain('MT12SYPL39480821090981701607644');
        expect(JSON.stringify(cap.audit)).toContain('SYPLMTM2XXX');
    });

    it('reserve la ligne de defaut au superadmin', async () => {
        setup({ role: 'FINANCE_ADMIN' });
        const r = await updateIssuerProfile(input({ jurisdictionId: null }));
        expect(r).toMatchObject({ ok: false });
        if (!r.ok) expect(r.reason).toMatch(/superadmin/i);
    });

    it('met a jour la ligne de defaut existante sans la dupliquer', async () => {
        const cap = setup({ role: 'SUPERADMIN' });
        const r = await updateIssuerProfile(input({ jurisdictionId: null }));
        expect(r).toMatchObject({ ok: true });
        expect(cap.update).toMatchObject({ payment_terms_days: 45 });
        expect(cap.insert).toBeNull();
    });

    it('cree la ligne de defaut quand elle manque', async () => {
        const cap = setup({ role: 'SUPERADMIN', defaultExists: false });
        await updateIssuerProfile(input({ jurisdictionId: null }));
        expect(cap.insert).toMatchObject({ jurisdiction_id: null });
    });

    it('confine un finance admin a sa juridiction', async () => {
        setup({ role: 'FINANCE_ADMIN' });
        const r = await updateIssuerProfile(input({ jurisdictionId: OTHER_JID }));
        expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
    });

    it('refuse un port officer', async () => {
        // L'ecran /admin/jurisdictions lui est ouvert, pas le compte de collecte.
        setup({ role: 'PORT_OFFICER' });
        const r = await updateIssuerProfile(input());
        expect(r).toMatchObject({ ok: false, reason: 'insufficient role' });
    });

    it('exige exactement un compte principal', async () => {
        setup();
        const two = await updateIssuerProfile(input({
            bankAccounts: [ACCOUNT, { ...ACCOUNT, label: 'BBVA', is_primary: true }],
        }));
        expect(two).toMatchObject({ ok: false });
        if (!two.ok) expect(two.reason).toMatch(/primary/i);

        const none = await updateIssuerProfile(input({ bankAccounts: [{ ...ACCOUNT, is_primary: false }] }));
        expect(none).toMatchObject({ ok: false });
    });

    it('refuse un compte sans IBAN ni numero', async () => {
        setup();
        const r = await updateIssuerProfile(input({
            bankAccounts: [{ ...ACCOUNT, iban: null, account_number: null }],
        }));
        expect(r).toMatchObject({ ok: false });
        if (!r.ok) expect(r.reason).toMatch(/IBAN|account number/i);
    });

    it('refuse un delai de reglement aberrant', async () => {
        setup();
        expect(await updateIssuerProfile(input({ paymentTermsDays: 0 }))).toMatchObject({ ok: false });
    });
});
