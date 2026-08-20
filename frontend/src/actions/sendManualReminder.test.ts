import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted garantit que ces vi.fn() existent avant que les factories vi.mock
// (elles-mêmes hissées en tête de fichier) ne s'exécutent — sinon TDZ sur les
// `const` référencés depuis une factory hissée.
const {
    getUserMock, serverFromMock, platformFromMock, storageDownloadMock, sendReminderMock, resolveRecipientsMock,
} = vi.hoisted(() => ({
    getUserMock: vi.fn(),
    serverFromMock: vi.fn(),
    platformFromMock: vi.fn(),
    storageDownloadMock: vi.fn(),
    sendReminderMock: vi.fn(),
    resolveRecipientsMock: vi.fn(),
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
}));
vi.mock('@/services/invoiceIssuanceService', () => ({ resolveInvoiceRecipients: resolveRecipientsMock }));
vi.mock('@/services/emailService', () => ({ sendProformaReminderEmail: sendReminderMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { sendManualReminder } from './sendManualReminder';

const TXN = '11111111-1111-4111-8111-111111111111';

// Fabrique le client platform : transaction + inserts capturés. Pas de mock
// pour `collection_reminders.select` : sendManualReminder ne lit jamais le
// registre avant d'écrire (pas de rampe à vérifier), donc un tel appel
// signalerait une régression — il ferait échouer le test au lieu d'être
// silencieusement ignoré.
function setup(opts: {
    role?: string; isActive?: boolean; txnJur?: string; pdf?: string | null;
    status?: string; documentType?: string; mode?: string; createdAt?: string;
    insertErr?: { code?: string; message: string } | null; fullName?: string | null;
}) {
    const captured = {
        reminderInserts: [] as Record<string, unknown>[],
        audit: null as Record<string, unknown> | null,
    };
    serverFromMock.mockImplementation((t: string) => {
        if (t === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: opts.role ?? 'FINANCE_ADMIN', full_name: opts.fullName ?? null, is_active: opts.isActive ?? true } }) }) }) };
        throw new Error(`server table ${t}`);
    });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new Uint8Array([1]).buffer }, error: null });
    platformFromMock.mockImplementation((t: string) => {
        if (t === 'transactions') return { select: () => ({ eq: () => ({ single: async () => ({
            data: {
                id: TXN, jurisdiction_id: opts.txnJur ?? 'jur-so', invoice_ref: 'PRO-1', tax_amount_usd: 500,
                shipowner_id: 'own-1', agent_profile_id: null,
                invoice_pdf_url: opts.pdf === undefined ? 'SO/proformas/2026/07/PRO-1.pdf' : opts.pdf,
                status: opts.status ?? 'OVERDUE', document_type: opts.documentType ?? 'PROFORMA', mode: opts.mode ?? 'MARITIME',
                created_at: opts.createdAt ?? '2026-07-01T00:00:00.000Z',
                shipowner: { name: 'Owner', official_email: 'billing@armateur.com', billing_cc_emails: ['cc@armateur.com'] },
                agent: null,
            }, error: null }) }) }) };
        if (t === 'collection_reminders') return {
            insert: (payload: Record<string, unknown>) => { captured.reminderInserts.push(payload); return Promise.resolve({ error: opts.insertErr ?? null }); },
        };
        if (t === 'audit_logs') return { insert: async (p: Record<string, unknown>) => { captured.audit = p; return { error: null }; } };
        throw new Error(`platform table ${t}`);
    });
    return captured;
}

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1', email: 'staff@gg.africa' } } });
    sendReminderMock.mockResolvedValue({ success: true, id: 'e1' });
    resolveRecipientsMock.mockReturnValue({ to: 'billing@armateur.com', cc: ['cc@armateur.com'] });
});

describe('sendManualReminder — gardes', () => {
    it('refuse un rôle non-staff', async () => {
        setup({ role: 'SHIPPING_AGENT' });
        const r = await sendManualReminder({ transactionId: TXN });
        expect(r).toMatchObject({ ok: false });
    });

    it('refuse une transaction d\'une autre juridiction pour un appelant non-SUPERADMIN', async () => {
        setup({ txnJur: 'jur-dj' });
        const r = await sendManualReminder({ transactionId: TXN });
        expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
    });

    it('refuse un statut PAID', async () => {
        setup({ status: 'PAID' });
        const r = await sendManualReminder({ transactionId: TXN });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/status|eligible/i) });
    });

    it('refuse un document_type non-PROFORMA', async () => {
        setup({ documentType: 'FINAL' });
        const r = await sendManualReminder({ transactionId: TXN });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/pro-forma/i) });
    });

    it('refuse un mode non-MARITIME', async () => {
        setup({ mode: 'AIR' });
        const r = await sendManualReminder({ transactionId: TXN });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/maritime/i) });
    });

    it("refuse quand aucun destinataire n'est joignable, sans écriture (cas armateur « À identifier »)", async () => {
        const cap = setup({});
        resolveRecipientsMock.mockReturnValue(null);
        const r = await sendManualReminder({ transactionId: TXN });
        expect(r).toMatchObject({ ok: false });
        expect(cap.reminderInserts).toHaveLength(0);
    });

    it("n'insère rien si l'envoi échoue", async () => {
        const cap = setup({});
        sendReminderMock.mockResolvedValue({ success: false, error: 'smtp' });
        const r = await sendManualReminder({ transactionId: TXN });
        expect(r).toMatchObject({ ok: false });
        expect(cap.reminderInserts).toHaveLength(0);
    });
});

describe('sendManualReminder — envoi', () => {
    it('réussit et trace une ligne MANUAL, sans tier envoyé à sendProformaReminderEmail', async () => {
        const cap = setup({});
        const r = await sendManualReminder({ transactionId: TXN });
        expect(r).toMatchObject({ ok: true });
        expect(cap.reminderInserts).toHaveLength(1);
        expect(cap.reminderInserts[0]).toMatchObject({ tier: 'MANUAL', template_used: 'manual_reminder', escalated_bailiff: false });
        expect(cap.audit).toMatchObject({
            severity: 'INFO',
            details_json: expect.objectContaining({ event: 'MANUAL_REMINDER_SENT' }),
        });
        expect(sendReminderMock.mock.calls[0][0]).not.toHaveProperty('tier');
    });

    it('deux relances manuelles successives sur la même facture produisent deux lignes (index partiel non bloquant)', async () => {
        const cap = setup({});
        const r1 = await sendManualReminder({ transactionId: TXN });
        const r2 = await sendManualReminder({ transactionId: TXN });
        expect(r1).toMatchObject({ ok: true });
        expect(r2).toMatchObject({ ok: true });
        expect(cap.reminderInserts).toHaveLength(2);
        expect(cap.reminderInserts.every((row) => row.tier === 'MANUAL')).toBe(true);
    });

    it('envoie sans pièce jointe quand le PDF est absent, sans refus', async () => {
        const cap = setup({ pdf: null });
        const r = await sendManualReminder({ transactionId: TXN });
        expect(r).toMatchObject({ ok: true });
        expect(cap.reminderInserts).toHaveLength(1);
        expect(sendReminderMock.mock.calls[0][0].pdfBuffer).toBeUndefined();
    });

    it('envoie sans pièce jointe quand le téléchargement du PDF échoue, sans refus', async () => {
        setup({});
        storageDownloadMock.mockResolvedValue({ data: null, error: { message: 'network' } });
        const r = await sendManualReminder({ transactionId: TXN });
        expect(r).toMatchObject({ ok: true });
        expect(sendReminderMock.mock.calls[0][0].pdfBuffer).toBeUndefined();
    });
});
