import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sessionMock, platformMock, signedUrlMock } = vi.hoisted(() => ({
    sessionMock: vi.fn(),
    platformMock: vi.fn(),
    signedUrlMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: sessionMock }));
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: platformMock }));

import { GET } from './route';

type Row = Record<string, unknown>;

const OWNER = { id: 'own-1', name: 'FAROS SHIPPING CO SARL', account_state: 'ACTIVE', profile_id: 'u1', jurisdiction_id: 'j1' };
const STATEMENT = { shipowner_id: 'own-1', period_month: '2026-08-01', pdf_path: 'statements/own-1/2026-08.pdf' };

/** Stub de session qui HONORE les filtres, sans quoi tout mois rendrait la même ligne. */
function session(tables: Record<string, Row | null>, userId = 'u1') {
    const filters: Record<string, Row> = {};
    return {
        filters,
        client: {
            auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
            from: (table: string) => {
                const f: Row = {};
                filters[table] = f;
                const chain: Record<string, unknown> = {};
                chain.select = () => chain;
                chain.eq = (col: string, val: unknown) => { f[col] = val; return chain; };
                chain.maybeSingle = async () => {
                    const row = tables[table];
                    if (!row) return { data: null, error: null };
                    for (const [col, val] of Object.entries(f)) {
                        if (row[col] !== val) return { data: null, error: null };
                    }
                    return { data: row, error: null };
                };
                return chain;
            },
        },
    };
}

function call(period: string) {
    return GET(new Request('http://localhost') as never, { params: Promise.resolve({ period }) });
}

beforeEach(() => {
    vi.clearAllMocks();
    signedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://cdn.example/signed.pdf' }, error: null });
    platformMock.mockReturnValue({ storage: { from: () => ({ createSignedUrl: signedUrlMock }) } });
});

describe('GET /api/owner/statements/:period/download', () => {
    it('redirige vers le PDF signé du mois demandé, sur le compte de la session', async () => {
        const s = session({ shipowners: OWNER, owner_statements: STATEMENT });
        sessionMock.mockResolvedValue(s.client);
        const res = await call('2026-08');
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('https://cdn.example/signed.pdf');
        expect(s.filters.owner_statements).toEqual({ shipowner_id: 'own-1', period_month: '2026-08-01' });
        expect(signedUrlMock).toHaveBeenCalledWith('statements/own-1/2026-08.pdf', 300);
    });

    it('sert un membre invité du compte', async () => {
        const membership = { profile_id: 'member-9', active: true, shipowner_id: 'own-1' };
        sessionMock.mockResolvedValue(
            session({ shipowners: OWNER, owner_members: membership, owner_statements: STATEMENT }, 'member-9').client,
        );
        expect((await call('2026-08')).status).toBe(302);
    });

    it('répond introuvable pour un mois sans relevé', async () => {
        sessionMock.mockResolvedValue(session({ shipowners: OWNER, owner_statements: STATEMENT }).client);
        expect((await call('2026-07')).status).toBe(404);
        expect(signedUrlMock).not.toHaveBeenCalled();
    });

    it("n'accepte que la forme YYYY-MM — plus d'UUID, pas de mois 13", async () => {
        sessionMock.mockResolvedValue(session({ shipowners: OWNER, owner_statements: STATEMENT }).client);
        expect((await call('2b1d6f20-1111-4222-8333-444455556666')).status).toBe(404);
        expect((await call('2026-13')).status).toBe(404);
        expect((await call('2026-8')).status).toBe(404);
        expect(sessionMock).not.toHaveBeenCalled();
    });

    it('reste muet sans compte armateur', async () => {
        sessionMock.mockResolvedValue(session({ owner_statements: STATEMENT }).client);
        expect((await call('2026-08')).status).toBe(404);
    });
});
