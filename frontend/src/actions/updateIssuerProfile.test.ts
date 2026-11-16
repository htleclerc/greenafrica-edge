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

interface SetupOptions {
    role?: string;
    isActive?: boolean;
    defaultExists?: boolean;
    /** Comptes de la ligne générale (sans pays). */
    generalAccounts?: unknown;
    /** Comptes propres au pays ; absent = il suit les comptes généraux. */
    ownAccounts?: unknown;
    /** Pays que l'appelant administre (mig 174). */
    administers?: string[];
}

function setup(opts: SetupOptions = {}) {
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
                select: () => ({
                    // Ligne générale (jurisdiction_id IS NULL).
                    is: () => ({ maybeSingle: async () => ({
                        data: opts.defaultExists === false
                            ? null
                            : { id: 'row-default', bank_accounts: opts.generalAccounts ?? [ACCOUNT] },
                        error: null,
                    }) }),
                    // Ligne du pays.
                    eq: () => ({ maybeSingle: async () => ({
                        data: opts.ownAccounts === undefined ? null : { bank_accounts: opts.ownAccounts },
                        error: null,
                    }) }),
                }),
                upsert: async (p: Record<string, unknown>) => { captured.upsert = p; return { error: null }; },
                update: (p: Record<string, unknown>) => { captured.update = p; return { eq: async () => ({ error: null }) }; },
                insert: async (p: Record<string, unknown>) => { captured.insert = p; return { error: null }; },
            };
        }
        if (t === 'audit_logs') {
            return { insert: async (p: Record<string, unknown>) => { captured.audit = p; return { error: null }; } };
        }
        if (t === 'user_jurisdictions') {
            // getAdminScope : rattachements de l'appelant portant is_admin.
            return { select: () => ({ eq: () => ({ eq: async () => ({
                data: (opts.administers ?? []).map((jurisdiction_id) => ({ jurisdiction_id })),
                error: null,
            }) }) }) };
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
        const cap = setup({ generalAccounts: [{ ...ACCOUNT, swift: 'AUTREBICXXX' }] });
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

    // ── Comptes de paiement : generaux par defaut ─────────────────────────────
    describe('comptes de paiement', () => {
        const OWN = { ...ACCOUNT, label: 'Compte du pays', swift: 'PAYSBICXXXX', iban: 'SO000000000000000000001' };

        it('un pays sans comptes propres continue de suivre les comptes generaux', async () => {
            // Le formulaire renvoie les comptes generaux tels quels : rien n est
            // fige dans la ligne du pays.
            const cap = setup({ generalAccounts: [ACCOUNT] });
            const r = await updateIssuerProfile(input({ bankAccounts: [ACCOUNT] }));
            expect(r).toMatchObject({ ok: true });
            expect(cap.upsert).toMatchObject({ jurisdiction_id: JID, bank_accounts: null });
            expect(cap.audit).toMatchObject({ details_json: expect.objectContaining({ accounts: 'general' }) });
        });

        it('une liste vide remet le pays sur les comptes generaux', async () => {
            const cap = setup({ ownAccounts: [OWN] });
            const r = await updateIssuerProfile(input({ bankAccounts: [] }));
            expect(r).toMatchObject({ ok: true });
            expect(cap.upsert).toMatchObject({ bank_accounts: null });
        });

        it('des comptes differents des generaux sont une distinction du pays, ecrite telle quelle', async () => {
            const cap = setup({ generalAccounts: [ACCOUNT] });
            const r = await updateIssuerProfile(input({ bankAccounts: [OWN] }));
            expect(r).toMatchObject({ ok: true });
            expect(cap.upsert?.bank_accounts).toMatchObject([{ swift: 'PAYSBICXXXX' }]);
            expect(cap.audit).toMatchObject({ details_json: expect.objectContaining({ accounts: 'own' }) });
        });

        it('la ligne generale porte toujours au moins un compte', async () => {
            setup({ role: 'SUPERADMIN' });
            const r = await updateIssuerProfile(input({ jurisdictionId: null, bankAccounts: [] }));
            expect(r).toMatchObject({ ok: false });
            if (!r.ok) expect(r.reason).toMatch(/at least one account/i);
        });
    });

    // ── Administrateur d un pays (mig 174) ────────────────────────────────────
    describe('administrateur d un pays', () => {
        const FORGED = { ...ACCOUNT, holder: 'Quelqu un d autre', iban: 'XX00FORGED', swift: 'FORGEDXXXXX' };

        it('modifie le profil de son pays, quel que soit son role', async () => {
            const cap = setup({ role: 'PORT_OFFICER', administers: [JID] });
            const r = await updateIssuerProfile(input({ paymentTermsDays: 30 }));
            expect(r).toMatchObject({ ok: true });
            expect(cap.upsert).toMatchObject({ jurisdiction_id: JID, payment_terms_days: 30 });
        });

        it('ne change jamais les comptes : un pays sur les comptes generaux y reste', async () => {
            const cap = setup({ role: 'PORT_OFFICER', administers: [JID] });
            const r = await updateIssuerProfile(input({ bankAccounts: [FORGED] }));
            expect(r).toMatchObject({ ok: true });
            expect(cap.upsert).toMatchObject({ bank_accounts: null });
            expect(JSON.stringify(cap.upsert)).not.toContain('FORGEDXXXXX');
        });

        it('ne change jamais les comptes : ceux du pays restent ce qu ils etaient', async () => {
            const own = [{ ...ACCOUNT, swift: 'PAYSBICXXXX' }];
            const cap = setup({ role: 'MANAGER', administers: [JID], ownAccounts: own });
            const r = await updateIssuerProfile(input({ bankAccounts: [FORGED] }));
            expect(r).toMatchObject({ ok: true });
            expect(cap.upsert?.bank_accounts).toEqual(own);
        });

        it('ne touche pas au profil d un autre pays', async () => {
            setup({ role: 'PORT_OFFICER', administers: [JID] });
            const r = await updateIssuerProfile(input({ jurisdictionId: OTHER_JID }));
            expect(r).toMatchObject({ ok: false, reason: 'insufficient role' });
        });

        it('ne touche pas a la ligne generale', async () => {
            setup({ role: 'PORT_OFFICER', administers: [JID] });
            const r = await updateIssuerProfile(input({ jurisdictionId: null }));
            expect(r).toMatchObject({ ok: false });
        });
    });

    it('refuse un delai de reglement aberrant', async () => {
        setup();
        expect(await updateIssuerProfile(input({ paymentTermsDays: 0 }))).toMatchObject({ ok: false });
    });
});
