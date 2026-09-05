import { describe, it, expect, vi, beforeEach } from 'vitest';

const { composeMock, pdfMock, sessionMock, platformMock } = vi.hoisted(() => ({
    composeMock: vi.fn(),
    pdfMock: vi.fn(),
    sessionMock: vi.fn(),
    platformMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: sessionMock }));
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: platformMock }));
vi.mock('@/lib/jurisdictionName', () => ({
    fetchJurisdictionName: vi.fn().mockResolvedValue('Republic of Somaliland'),
}));
vi.mock('@/services/statementService', async () => {
    const actual = await vi.importActual<typeof import('@/services/statementService')>(
        '@/services/statementService',
    );
    return { ...actual, composeOwnerStatement: composeMock };
});
vi.mock('@/services/invoiceService', () => ({ generateStatementPdf: pdfMock }));

import { GET } from './route';

const OWNER = {
    id: 'own-1', name: 'FAROS SHIPPING CO SARL', jurisdiction_id: 'jur-so',
    account_state: 'ACTIVE', profile_id: 'u1',
};

type Row = Record<string, unknown>;

/**
 * Client de session : utilisateur authentifié + les tables qu'il peut lire.
 * Le stub HONORE les filtres : sans cela, la lecture par `profile_id` et celle
 * du compte de l'appartenance rendraient la même ligne, et le chemin « membre »
 * ne serait jamais emprunté.
 */
function session(
    owner: Row | null = OWNER,
    opts: { userId?: string; membership?: Row | null; vessel?: Row | null } = {},
) {
    const calls: string[] = [];
    const tables: Record<string, Row | null> = {
        shipowners: owner, owner_members: opts.membership ?? null, vessels: opts.vessel ?? null,
    };
    return {
        calls,
        client: {
            auth: { getUser: async () => ({ data: { user: { id: opts.userId ?? 'u1' } } }) },
            from: (table: string) => {
                calls.push(table);
                const filters: Row = {};
                const chain: Record<string, unknown> = {};
                chain.select = () => chain;
                chain.eq = (col: string, val: unknown) => { filters[col] = val; return chain; };
                chain.maybeSingle = async () => {
                    const row = tables[table];
                    if (!row) return { data: null, error: null };
                    for (const [col, val] of Object.entries(filters)) {
                        if (row[col] !== val) return { data: null, error: null };
                    }
                    return { data: row, error: null };
                };
                return chain;
            },
        },
    };
}

function req(query = ''): Request {
    return new Request(`http://localhost/api/owner/statement${query}`);
}

beforeEach(() => {
    vi.clearAllMocks();
    composeMock.mockResolvedValue({
        openLines: [{ transactionId: 't1', invoiceRef: 'PRO-1', vesselName: 'MAYAR', issuedAt: '2026-06-10', ageDays: 20, outstandingUsd: 16500 }],
        payments: [], totalOutstandingUsd: 16500, paymentsInMonthUsd: 0, openCount: 1,
        asOf: new Date('2026-08-20T00:00:00Z'),
    });
    pdfMock.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    platformMock.mockReturnValue({});
});

describe('GET /api/owner/statement', () => {
    it('rend un PDF à la demande', async () => {
        const s = session();
        sessionMock.mockResolvedValue(s.client);
        const res = await GET(req() as never);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/pdf');
    });

    it("n'écrit RIEN — ni owner_statements, ni le bucket", async () => {
        // Le relevé mensuel officiel porte une contrainte UNIQUE (armateur,
        // mois) et vit sous statements/<id>/<YYYY-MM>.pdf. Persister ici
        // écraserait, au premier clic, le document que l'armateur consulte.
        const s = session();
        sessionMock.mockResolvedValue(s.client);
        await GET(req() as never);
        expect(s.calls).toEqual(['shipowners']);
        // Aucun client privilégié utilisé pour écrire : seul le nom de la
        // juridiction est lu avec.
        expect(platformMock).toHaveBeenCalledTimes(1);
    });

    it('arrête le solde à la date demandée', async () => {
        sessionMock.mockResolvedValue(session().client);
        await GET(req('?asOf=2026-07-31') as never);
        expect(composeMock.mock.calls[0][1].asOf.toISOString().slice(0, 10)).toBe('2026-07-31');
    });

    it('ramène une date future à maintenant', async () => {
        // Un solde futur n'existe pas : l'annoncer sous une date à venir
        // donnerait un document qui prétend savoir ce qui n'est pas arrivé.
        sessionMock.mockResolvedValue(session().client);
        await GET(req('?asOf=2099-01-01') as never);
        const asOf = composeMock.mock.calls[0][1].asOf as Date;
        expect(asOf.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('refuse une date illisible plutôt que d en inventer une', async () => {
        sessionMock.mockResolvedValue(session().client);
        const res = await GET(req('?asOf=pas-une-date') as never);
        expect(res.status).toBe(400);
        expect(composeMock).not.toHaveBeenCalled();
    });

    it('restreint le relevé à un navire et le porte sur le document', async () => {
        // L'URL porte la référence opaque (mig 147) ; l'identifiant interne
        // n'est résolu qu'ici, borné au compte de l'appelant.
        const vessel = { id: 'v-1', public_ref: 'ves_7f3a9c2e51b0', shipowner_id: 'own-1' };
        sessionMock.mockResolvedValue(session(OWNER, { vessel }).client);
        await GET(req('?vessel=ves_7f3a9c2e51b0') as never);
        expect(composeMock.mock.calls[0][1].vesselId).toBe('v-1');
        expect(pdfMock.mock.calls[0][0].vesselScope).toBe('MAYAR');
    });

    it('refuse un navire inconnu ou hors du compte plutôt que de rendre un relevé vide', async () => {
        const vessel = { id: 'v-9', public_ref: 'ves_7f3a9c2e51b0', shipowner_id: 'own-OTHER' };
        sessionMock.mockResolvedValue(session(OWNER, { vessel }).client);
        const res = await GET(req('?vessel=ves_7f3a9c2e51b0') as never);
        expect(res.status).toBe(404);
        expect(composeMock).not.toHaveBeenCalled();
    });

    it("n'accepte plus un UUID comme portée navire", async () => {
        sessionMock.mockResolvedValue(session().client);
        const res = await GET(req('?vessel=34841384-e3de-4ff5-9055-8127f5691f49') as never);
        expect(res.status).toBe(404);
    });

    it('ne marque aucune portée navire sur un relevé de flotte', async () => {
        sessionMock.mockResolvedValue(session().client);
        await GET(req() as never);
        expect(pdfMock.mock.calls[0][0].vesselScope).toBeNull();
    });

    it('reste muet pour un visiteur sans compte armateur', async () => {
        // Même réponse que pour une ressource inexistante : l'API ne confirme
        // pas qu'une session est valide mais sans dossier.
        sessionMock.mockResolvedValue(session(null).client);
        const res = await GET(req() as never);
        expect(res.status).toBe(404);
        expect(composeMock).not.toHaveBeenCalled();
    });

    it('sert un MEMBRE invité du compte, pas seulement le titulaire', async () => {
        // Le bouton vit sur une page que requireOwner ouvre aux membres (mig
        // 135) : répondre 404 au membre faisait passer le relevé pour cassé.
        const s = session(OWNER, {
            userId: 'member-9',
            membership: { profile_id: 'member-9', active: true, shipowner_id: 'own-1', can_pay: false },
        });
        sessionMock.mockResolvedValue(s.client);
        const res = await GET(req() as never);
        expect(res.status).toBe(200);
        expect(composeMock.mock.calls[0][1].shipownerId).toBe('own-1');
        expect(pdfMock.mock.calls[0][0].ownerName).toBe('FAROS SHIPPING CO SARL');
    });

    it('reste muet sur un compte qui n est plus actif', async () => {
        sessionMock.mockResolvedValue(session({ ...OWNER, account_state: 'SUSPENDED' }).client);
        const res = await GET(req() as never);
        expect(res.status).toBe(404);
        expect(composeMock).not.toHaveBeenCalled();
    });

    it('rend un relevé même sans rien à devoir', async () => {
        // « Rien à devoir » est une réponse ; l'armateur a cliqué pour l'obtenir.
        composeMock.mockResolvedValueOnce({
            openLines: [], payments: [], totalOutstandingUsd: 0, paymentsInMonthUsd: 0,
            openCount: 0, asOf: new Date('2026-08-20T00:00:00Z'),
        });
        sessionMock.mockResolvedValue(session().client);
        const res = await GET(req() as never);
        expect(res.status).toBe(200);
    });

    it('interdit la mise en cache du document', async () => {
        // Un solde change à chaque encaissement : un PDF caché annoncerait une
        // dette déjà réglée.
        sessionMock.mockResolvedValue(session().client);
        const res = await GET(req() as never);
        expect(res.headers.get('cache-control')).toBe('no-store');
    });
});
