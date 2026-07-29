import { describe, it, expect, vi, beforeEach } from 'vitest';

const { notifyOwnerMock } = vi.hoisted(() => ({ notifyOwnerMock: vi.fn().mockResolvedValue({ id: 'n1' }) }));
vi.mock('@/services/notificationService', () => ({ notifyOwner: notifyOwnerMock }));
vi.mock('@/services/statementService', () => ({
    periodBounds: () => ({ periodStart: new Date('2026-06-01T00:00:00Z'), periodEnd: new Date('2026-07-01T00:00:00Z'), label: 'June 2026' }),
    statementStoragePath: () => 'statements/own-1/2026-06.pdf',
    composeOwnerStatement: vi.fn().mockResolvedValue({ openLines: [], payments: [], totalOutstandingUsd: 500, paymentsInMonthUsd: 0, openCount: 1 }),
}));
vi.mock('@/services/invoiceService', () => ({ generateStatementPdf: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])) }));
vi.mock('@/lib/jurisdictionName', () => ({ fetchJurisdictionName: vi.fn().mockResolvedValue('Republic of Somaliland') }));

import { GET, __setClientForTest } from './route';

const CRON_SECRET = 'test-cron';

function req(auth: string | null, dryRun = false): Request {
    const h = new Headers(); if (auth) h.set('authorization', auth);
    return new Request(`http://localhost/api/cron/monthly-statements${dryRun ? '?dryRun=1' : ''}`, { headers: h });
}

// Faux client : liste des armateurs à solde > 0 + shipowners (jurisdiction_id) +
// storage.upload + owner_statements.upsert. `viewError` simule un échec PostgREST
// sur les vues de recouvrement.
function makeClient(owners: Record<string, unknown>[], opts: { viewError?: boolean } = {}) {
    const captured = { uploads: [] as string[], upserts: [] as Record<string, unknown>[] };
    const client = {
        from: (t: string) => {
            if (t === 'v_armateur_recouvrement' || t === 'v_compagnie_recouvrement') {
                return {
                    select: () => ({
                        gt: async () => opts.viewError
                            ? { data: null, error: { message: 'relation error' } }
                            : { data: t === 'v_armateur_recouvrement' ? owners : [], error: null },
                    }),
                };
            }
            if (t === 'shipowners') {
                return { select: () => ({ in: async () => ({ data: [{ id: 'own-1', jurisdiction_id: 'jur-so' }], error: null }) }) };
            }
            if (t === 'owner_statements') {
                return { upsert: async (p: Record<string, unknown>) => { captured.upserts.push(p); return { error: null }; } };
            }
            throw new Error(`unexpected ${t}`);
        },
        storage: { from: () => ({ upload: async (path: string) => { captured.uploads.push(path); return { error: null }; } }) },
    };
    return { client: client as never, captured };
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    notifyOwnerMock.mockResolvedValue({ id: 'n1' });
});

describe('GET /api/cron/monthly-statements', () => {
    it('rejette sans secret', async () => {
        __setClientForTest(makeClient([]).client);
        expect((await GET(req(null))).status).toBe(401);
    });

    it('génère un relevé par armateur à solde > 0 (upload + upsert + notify)', async () => {
        const { client, captured } = makeClient([
            { id: 'own-1', name: 'Owner One', official_email: 'o1@x.com', total_outstanding_usd: 500 },
        ]);
        __setClientForTest(client);
        const res = await GET(req(`Bearer ${CRON_SECRET}`));
        expect(res.status).toBe(200);
        expect(captured.uploads).toEqual(['statements/own-1/2026-06.pdf']);
        expect(captured.upserts[0]).toMatchObject({ shipowner_id: 'own-1', jurisdiction_id: 'jur-so', pdf_path: 'statements/own-1/2026-06.pdf' });
        expect(notifyOwnerMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            kind: 'STATEMENT_READY', attachments: expect.objectContaining({ pdfBuffer: expect.any(Uint8Array) }),
        }));
    });

    it('dry-run n\'écrit rien', async () => {
        const { client, captured } = makeClient([
            { id: 'own-1', name: 'Owner One', official_email: 'o1@x.com', total_outstanding_usd: 500 },
        ]);
        __setClientForTest(client);
        const res = await GET(req(`Bearer ${CRON_SECRET}`, true));
        expect(res.status).toBe(200);
        expect(captured.uploads).toHaveLength(0);
        expect(notifyOwnerMock).not.toHaveBeenCalled();
    });

    it('renvoie 500 si les vues de recouvrement échouent (pas de liste vide silencieuse)', async () => {
        const { client } = makeClient([], { viewError: true });
        __setClientForTest(client);
        const res = await GET(req(`Bearer ${CRON_SECRET}`));
        expect(res.status).toBe(500);
        expect(notifyOwnerMock).not.toHaveBeenCalled();
    });
});
