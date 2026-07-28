import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted garantit que ces vi.fn() existent avant que les factories vi.mock
// (elles-mêmes hissées en tête de fichier) ne s'exécutent — sinon TDZ sur les
// `const` référencés depuis une factory hissée.
const {
    getUserMock, serverFromMock, platformFromMock, storageDownloadMock, sendEscalationMock,
} = vi.hoisted(() => ({
    getUserMock: vi.fn(),
    serverFromMock: vi.fn(),
    platformFromMock: vi.fn(),
    storageDownloadMock: vi.fn(),
    sendEscalationMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: getUserMock }, from: serverFromMock }),
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: platformFromMock, storage: { from: () => ({ download: storageDownloadMock }) } }),
}));

vi.mock('@/lib/auth/tenantContext', () => ({ getServerJurisdictionId: vi.fn(async () => 'jur-so') }));
vi.mock('@/lib/jurisdictionName', () => ({
    fetchJurisdictionBillingCc: vi.fn(async () => ['finance@so.gov']),
    fetchJurisdictionBailiffCc: vi.fn(async () => ['huissier@eidle.so']),
    fetchJurisdictionName: vi.fn(async () => 'Republic of Somaliland'),
}));
vi.mock('@/services/invoiceIssuanceService', () => ({
    resolveInvoiceRecipients: vi.fn(() => ({ to: 'billing@armateur.com', cc: ['huissier@eidle.so'] })),
}));
vi.mock('@/services/emailService', () => ({ sendCollectionEscalationEmail: sendEscalationMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { escalateCollection } from './escalateCollection';

const TXN = '11111111-1111-4111-8111-111111111111';

// Fabrique le client platform : transaction + relances existantes + inserts capturés.
function setup(opts: {
    role?: string; isActive?: boolean; txnJur?: string; pdf?: string | null;
    sentTiers?: string[]; insertErr?: { code?: string; message: string } | null;
}) {
    const captured = { reminderInsert: null as Record<string, unknown> | null, audit: null as Record<string, unknown> | null };
    serverFromMock.mockImplementation((t: string) => {
        if (t === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: opts.role ?? 'FINANCE_ADMIN', is_active: opts.isActive ?? true } }) }) }) };
        throw new Error(`server table ${t}`);
    });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new Uint8Array([1]).buffer }, error: null });
    // Les relances existantes sont lues via `.select('tier').eq('transaction_id', …)` (await direct
    // du query builder) — on renvoie un thenable qui résout vers { data: [{tier}], error }.
    const remBuilder = { then: (res: (v: { data: { tier: string }[]; error: null }) => unknown) => res({ data: (opts.sentTiers ?? []).map((tier) => ({ tier })), error: null }) };
    platformFromMock.mockImplementation((t: string) => {
        if (t === 'transactions') return { select: () => ({ eq: () => ({ single: async () => ({
            data: {
                id: TXN, jurisdiction_id: opts.txnJur ?? 'jur-so', invoice_ref: 'PRO-1', tax_amount_usd: 500,
                shipowner_id: 'own-1', agent_profile_id: null, invoice_pdf_url: opts.pdf === undefined ? 'SO/proformas/2026/07/PRO-1.pdf' : opts.pdf,
                vessel: { name: 'MV X', imo_number: 'IMO1' }, shipowner: { name: 'Owner', official_email: 'billing@armateur.com' }, agent: null,
            }, error: null }) }) }) };
        if (t === 'collection_reminders') return {
            select: () => ({ eq: () => remBuilder }),
            insert: (payload: Record<string, unknown>) => { captured.reminderInsert = payload; return Promise.resolve({ error: opts.insertErr ?? null }); },
        };
        if (t === 'audit_logs') return { insert: async (p: Record<string, unknown>) => { captured.audit = p; return { error: null }; } };
        throw new Error(`platform table ${t}`);
    });
    return captured;
}

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1', email: 'staff@gg.africa' } } });
    sendEscalationMock.mockResolvedValue({ success: true, id: 'e1' });
});

describe('escalateCollection — rampe', () => {
    it('refuse BAILIFF sans J45', async () => {
        setup({ sentTiers: ['J3', 'J7', 'J15', 'J30'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/ramp|J45/i) });
    });

    it('accepte BAILIFF quand J45 existe', async () => {
        const cap = setup({ sentTiers: ['J45'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: true, tier: 'BAILIFF' });
        expect(cap.reminderInsert).toMatchObject({ tier: 'BAILIFF', escalated_bailiff: true });
        expect(cap.audit).toMatchObject({ severity: 'WARNING', details_json: expect.objectContaining({ event: 'ESCALATED_BAILIFF' }) });
    });

    it('refuse JUDICIAL sans BAILIFF', async () => {
        setup({ sentTiers: ['J45'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'JUDICIAL' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/ramp|bailiff/i) });
    });

    it('accepte JUDICIAL quand BAILIFF existe', async () => {
        const cap = setup({ sentTiers: ['J45', 'BAILIFF'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'JUDICIAL' });
        expect(r).toMatchObject({ ok: true, tier: 'JUDICIAL' });
        expect(cap.reminderInsert).toMatchObject({ tier: 'JUDICIAL', escalated_bailiff: true });
    });
});

describe('escalateCollection — gardes', () => {
    it('refuse un doublon (tier déjà présent)', async () => {
        setup({ sentTiers: ['J45', 'BAILIFF'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/already escalated/i) });
    });

    it('refuse sans PDF stocké', async () => {
        setup({ sentTiers: ['J45'], pdf: null });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/no stored PDF/i) });
    });

    it('refuse un rôle non-staff', async () => {
        setup({ role: 'SHIPPING_AGENT', sentTiers: ['J45'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false });
    });

    it('refuse un staff désactivé', async () => {
        setup({ isActive: false, sentTiers: ['J45'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/inactive/i) });
    });

    it('refuse un staff hors juridiction', async () => {
        setup({ txnJur: 'jur-dj', sentTiers: ['J45'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
    });

    it("n'insère rien si l'e-mail échoue", async () => {
        const cap = setup({ sentTiers: ['J45'] });
        sendEscalationMock.mockResolvedValue({ success: false, error: 'smtp' });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false });
        expect(cap.reminderInsert).toBeNull();
    });
});
