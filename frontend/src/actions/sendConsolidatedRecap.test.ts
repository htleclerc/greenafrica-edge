import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted garantit que ces vi.fn() existent avant que les factories vi.mock
// (elles-mêmes hissées en tête de fichier) ne s'exécutent — sinon TDZ sur les
// `const` référencés depuis une factory hissée. Même pattern que
// sendManualReminder.test.ts.
const {
    getUserMock, serverFromMock, platformFromMock, storageUploadMock,
    composeOwnerStatementMock, generateStatementPdfMock,
    fetchBillingCcMock, fetchJurisdictionNameMock,
    resolveRecipientsMock, sendRecapMock,
} = vi.hoisted(() => ({
    getUserMock: vi.fn(),
    serverFromMock: vi.fn(),
    platformFromMock: vi.fn(),
    storageUploadMock: vi.fn(),
    composeOwnerStatementMock: vi.fn(),
    generateStatementPdfMock: vi.fn(),
    fetchBillingCcMock: vi.fn(),
    fetchJurisdictionNameMock: vi.fn(),
    resolveRecipientsMock: vi.fn(),
    sendRecapMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: getUserMock }, from: serverFromMock }),
}));

// storage.from(...).upload est câblé mais ne doit JAMAIS être appelé par cette
// action (voir tests « ne dépose rien dans statements/ » plus bas).
//
// createTenantClient partage le même dispatcher que createPlatformClient : le
// client scopé (C1) n'est passé qu'à composeOwnerStatement, lui-même entièrement
// remplacé par composeOwnerStatementMock ci-dessous — son .from() n'est donc
// jamais réellement invoqué ici. Même pattern que updateArmateurContacts.test.ts.
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: platformFromMock, storage: { from: () => ({ upload: storageUploadMock }) } }),
    createTenantClient: () => ({ from: platformFromMock, storage: { from: () => ({ upload: storageUploadMock }) } }),
}));

vi.mock('@/lib/auth/tenantContext', () => ({ getServerJurisdictionId: vi.fn(async () => 'jur-so') }));
vi.mock('@/lib/jurisdictionName', () => ({
    fetchJurisdictionBillingCc: fetchBillingCcMock,
    fetchJurisdictionName: fetchJurisdictionNameMock,
}));
vi.mock('@/services/invoiceIssuanceService', () => ({ resolveInvoiceRecipients: resolveRecipientsMock }));
vi.mock('@/services/emailService', () => ({ sendCollectionRecapEmail: sendRecapMock }));
// currentMonthBounds retourne des bornes fixes : la couverture de sa propre
// logique de date vit dans statementService.test.ts, pas ici.
vi.mock('@/services/statementService', () => ({
    currentMonthBounds: () => ({
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-20T14:30:00.000Z'),
        label: 'August 2026',
    }),
    composeOwnerStatement: composeOwnerStatementMock,
}));
vi.mock('@/services/invoiceService', () => ({ generateStatementPdf: generateStatementPdfMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { sendConsolidatedRecap } from './sendConsolidatedRecap';

const OWNER = '22222222-2222-4222-8222-222222222222';

const OPEN_LINES = [
    { transactionId: 'txn-1', invoiceRef: 'PRO-1', vesselName: 'MV A', issuedAt: '2026-08-01', ageDays: 19, outstandingUsd: 16500 },
    { transactionId: 'txn-2', invoiceRef: 'PRO-2', vesselName: 'MV B', issuedAt: '2026-08-05', ageDays: 15, outstandingUsd: 11492 },
    { transactionId: 'txn-3', invoiceRef: 'PRO-3', vesselName: 'MV C', issuedAt: '2026-08-10', ageDays: 10, outstandingUsd: 5000 },
];

// Fabrique le client platform : armateur + inserts capturés. `owner_statements`
// EST câblé (contrairement aux autres tables absentes du dispatcher) pour
// pouvoir compter ses écritures explicitement, plutôt que de laisser un appel
// non prévu planter le test avec une erreur générique « platform table ... ».
function setup(opts: {
    role?: string; isActive?: boolean; ownerJur?: string;
    openLines?: typeof OPEN_LINES;
    insertErr?: { message: string } | null; fullName?: string | null;
}) {
    const captured = {
        reminderInserts: [] as Record<string, unknown>[][],
        audit: null as Record<string, unknown> | null,
        ownerStatementsWrites: 0,
    };
    const lines = opts.openLines ?? OPEN_LINES;

    serverFromMock.mockImplementation((t: string) => {
        if (t === 'profiles') {
            return {
                select: () => ({
                    eq: () => ({
                        single: async () => ({
                            data: { role: opts.role ?? 'FINANCE_ADMIN', full_name: opts.fullName ?? null, is_active: opts.isActive ?? true },
                        }),
                    }),
                }),
            };
        }
        throw new Error(`server table ${t}`);
    });

    composeOwnerStatementMock.mockResolvedValue({
        openLines: lines,
        payments: [],
        totalOutstandingUsd: lines.reduce((s, l) => s + l.outstandingUsd, 0),
        paymentsInMonthUsd: 0,
        openCount: lines.length,
    });

    platformFromMock.mockImplementation((t: string) => {
        if (t === 'shipowners') {
            return {
                select: () => ({
                    eq: () => ({
                        single: async () => ({
                            data: {
                                id: OWNER, name: 'Demo Armateur', official_email: 'billing@armateur.com',
                                billing_cc_emails: ['cc@armateur.com'], jurisdiction_id: opts.ownerJur ?? 'jur-so',
                            },
                            error: null,
                        }),
                    }),
                }),
            };
        }
        if (t === 'collection_reminders') {
            return {
                insert: (rows: Record<string, unknown>[]) => {
                    captured.reminderInserts.push(rows);
                    return Promise.resolve({ error: opts.insertErr ?? null });
                },
            };
        }
        if (t === 'audit_logs') {
            return { insert: async (p: Record<string, unknown>) => { captured.audit = p; return { error: null }; } };
        }
        // Câblée uniquement pour compter — voir commentaire de fonction.
        if (t === 'owner_statements') {
            return {
                insert: () => { captured.ownerStatementsWrites += 1; return Promise.resolve({ error: null }); },
                upsert: () => { captured.ownerStatementsWrites += 1; return Promise.resolve({ error: null }); },
            };
        }
        throw new Error(`platform table ${t}`);
    });

    return captured;
}

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1', email: 'staff@gg.africa' } } });
    fetchBillingCcMock.mockResolvedValue(['finance@so.gov']);
    fetchJurisdictionNameMock.mockResolvedValue('Republic of Somaliland');
    generateStatementPdfMock.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    resolveRecipientsMock.mockReturnValue({ to: 'billing@armateur.com', cc: ['cc@armateur.com', 'finance@so.gov'] });
    sendRecapMock.mockResolvedValue({ success: true, id: 'e1' });
});

describe('sendConsolidatedRecap — gardes', () => {
    it('refuse un rôle non-staff', async () => {
        setup({ role: 'SHIPPING_AGENT' });
        const r = await sendConsolidatedRecap({ shipownerId: OWNER });
        expect(r).toMatchObject({ ok: false });
    });

    it('refuse un armateur d\'une autre juridiction pour un appelant non-SUPERADMIN', async () => {
        setup({ ownerJur: 'jur-dj' });
        const r = await sendConsolidatedRecap({ shipownerId: OWNER });
        expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
    });

    it('refuse un récapitulatif vide (zéro facture ouverte), sans écriture', async () => {
        const cap = setup({ openLines: [] });
        const r = await sendConsolidatedRecap({ shipownerId: OWNER });
        expect(r).toMatchObject({ ok: false, reason: 'nothing outstanding' });
        expect(cap.reminderInserts).toHaveLength(0);
        expect(sendRecapMock).not.toHaveBeenCalled();
    });

    it("refuse quand aucun destinataire n'est joignable, sans écriture (cas armateur « À identifier »)", async () => {
        const cap = setup({});
        resolveRecipientsMock.mockReturnValue(null);
        const r = await sendConsolidatedRecap({ shipownerId: OWNER });
        expect(r).toMatchObject({ ok: false });
        expect(cap.reminderInserts).toHaveLength(0);
        expect(cap.audit).toBeNull();
        expect(sendRecapMock).not.toHaveBeenCalled();
    });

    it("n'insère rien si l'envoi échoue", async () => {
        const cap = setup({});
        sendRecapMock.mockResolvedValue({ success: false, error: 'smtp' });
        const r = await sendConsolidatedRecap({ shipownerId: OWNER });
        expect(r).toMatchObject({ ok: false });
        expect(cap.reminderInserts).toHaveLength(0);
        expect(cap.audit).toBeNull();
    });
});

describe('sendConsolidatedRecap — envoi', () => {
    it('réussit et trace UN SEUL insert groupé de lignes MANUAL partageant le même sent_at', async () => {
        const cap = setup({});
        const r = await sendConsolidatedRecap({ shipownerId: OWNER });
        expect(r).toMatchObject({ ok: true });

        // Composé sur le mois EN COURS (currentMonthBounds mocké), pas periodBounds.
        expect(composeOwnerStatementMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ shipownerId: OWNER }),
        );

        // Un seul appel .insert(), avec un tableau de N lignes — pas N appels.
        expect(cap.reminderInserts).toHaveLength(1);
        const rows = cap.reminderInserts[0];
        expect(rows).toHaveLength(OPEN_LINES.length);
        expect(rows.every((row) => row.tier === 'MANUAL')).toBe(true);
        expect(rows.every((row) => row.template_used === 'manual_recap')).toBe(true);
        expect(rows.every((row) => row.debtor_response_type === 'SILENT')).toBe(true);
        expect(rows.map((row) => row.transaction_id)).toEqual(['txn-1', 'txn-2', 'txn-3']);

        // Clé de regroupement : le même sent_at sur toutes les lignes.
        const sentAts = new Set(rows.map((row) => row.sent_at));
        expect(sentAts.size).toBe(1);

        expect(cap.audit).toMatchObject({
            severity: 'INFO',
            entity_type: 'Shipowner',
            entity_id: OWNER,
            details_json: expect.objectContaining({ event: 'CONSOLIDATED_RECAP_SENT', invoiceCount: OPEN_LINES.length }),
        });

        expect(sendRecapMock.mock.calls[0][0]).toMatchObject({
            to: 'billing@armateur.com',
            totalOutstandingUsd: OPEN_LINES.reduce((s, l) => s + l.outstandingUsd, 0),
        });
    });

    it("n'écrit RIEN dans owner_statements et ne dépose rien dans le stockage statements/ (protège le relevé mensuel officiel)", async () => {
        const cap = setup({});
        const r = await sendConsolidatedRecap({ shipownerId: OWNER });
        expect(r).toMatchObject({ ok: true });
        expect(cap.ownerStatementsWrites).toBe(0);
        expect(storageUploadMock).not.toHaveBeenCalled();
    });

    it('refuse et ne perd pas la trace si le registre échoue après un envoi réussi', async () => {
        const cap = setup({ insertErr: { message: 'db down' } });
        const r = await sendConsolidatedRecap({ shipownerId: OWNER });
        expect(r).toMatchObject({ ok: false });
        expect(cap.reminderInserts).toHaveLength(1); // la tentative a bien eu lieu
    });
});
