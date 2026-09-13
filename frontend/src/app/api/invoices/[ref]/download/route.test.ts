import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rateLimitMock, verifySigMock, createPlatformClientMock, createSignedUrlMock } = vi.hoisted(() => ({
    rateLimitMock: vi.fn(),
    verifySigMock: vi.fn(),
    createPlatformClientMock: vi.fn(),
    createSignedUrlMock: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: rateLimitMock,
    getClientId: () => 'ip-test',
}));
vi.mock('@/services/invoiceService', () => ({
    verifyInvoiceSignature: verifySigMock,
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: createPlatformClientMock,
}));

import { GET } from './route';

/**
 * Base de transactions honorant `.eq()` / `.neq()`, comme la table réelle :
 * sans ça, un test qui pose deux lignes de même invoice_ref (le cas de la
 * rebascule du livre, mig 128) ne distinguerait pas un filtre appliqué d'un
 * filtre ignoré.
 */
function fakeAdmin(rows: Record<string, unknown>[]) {
    return {
        from: () => {
            const filters: [string, unknown][] = [];
            const chain: Record<string, unknown> = {};
            chain.select = () => chain;
            chain.eq = (c: string, v: unknown) => { filters.push([c, v]); return chain; };
            chain.neq = (c: string, v: unknown) => { filters.push(['!' + c, v]); return chain; };
            chain.maybeSingle = async () => {
                const matched = rows.filter((r) =>
                    filters.every(([c, v]) => (c.startsWith('!') ? r[c.slice(1)] !== v : r[c] === v)));
                if (matched.length > 1) {
                    // PostgREST : plusieurs lignes pour .maybeSingle() est une erreur, pas une liste.
                    return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
                }
                return { data: matched[0] ?? null, error: null };
            };
            return chain;
        },
        storage: { from: () => ({ createSignedUrl: createSignedUrlMock }) },
    };
}

function req(ref: string, h = 'hash-abc', s = 'sig-abc'): Request {
    return new Request(`http://localhost/api/invoices/${ref}/download?h=${h}&s=${s}`);
}

function call(ref: string) {
    return GET(req(ref) as never, { params: Promise.resolve({ ref }) });
}

const LIVE_ROW = { invoice_ref: 'PRO-2026-064036', content_hash: 'hash-abc', invoice_pdf_url: 'statements/x.pdf', status: 'OVERDUE' };
const VOID_ROW = { invoice_ref: 'PRO-2026-064036', content_hash: 'hash-old', invoice_pdf_url: 'statements/old.pdf', status: 'VOID' };

beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockResolvedValue({ allowed: true });
    verifySigMock.mockReturnValue(true);
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://cdn.example/signed.pdf' }, error: null });
});

describe('GET /api/invoices/[ref]/download', () => {
    it('sert la facture réellement due même quand la référence porte aussi une ligne VOID du seed', () => {
        // Régression : après la rebascule du livre (mig 128), une même référence
        // peut être portée par deux lignes — l'annulée du seed et la vraie due.
        // Sans le filtre .neq('status', 'VOID'), .maybeSingle() trouvait les deux
        // et PostgREST levait une erreur, que la route confondait avec « inconnue ».
        createPlatformClientMock.mockReturnValue(fakeAdmin([VOID_ROW, LIVE_ROW]));
        return call('PRO-2026-064036').then(async (res) => {
            expect(res.status).toBe(302);
            expect(res.headers.get('location')).toBe('https://cdn.example/signed.pdf');
            expect(createSignedUrlMock).toHaveBeenCalledWith('statements/x.pdf', 300);
        });
    });

    it('sert la facture quand il n’y a qu’une ligne, comme avant', async () => {
        createPlatformClientMock.mockReturnValue(fakeAdmin([LIVE_ROW]));
        const res = await call('PRO-2026-064036');
        expect(res.status).toBe(302);
    });

    it('reste introuvable pour une référence qui n’existe que sous une ligne VOID', async () => {
        createPlatformClientMock.mockReturnValue(fakeAdmin([VOID_ROW]));
        const res = await call('PRO-2026-064036');
        expect(res.status).toBe(404);
    });

    it('reste introuvable pour une référence absente', async () => {
        createPlatformClientMock.mockReturnValue(fakeAdmin([]));
        const res = await call('PRO-2026-000000');
        expect(res.status).toBe(404);
    });

    it('refuse une signature invalide même sur une ligne valide', async () => {
        verifySigMock.mockReturnValue(false);
        createPlatformClientMock.mockReturnValue(fakeAdmin([LIVE_ROW]));
        const res = await call('PRO-2026-064036');
        expect(res.status).toBe(404);
        expect(createPlatformClientMock).not.toHaveBeenCalled();
    });

    it('respecte le plafond de débit avant tout le reste', async () => {
        rateLimitMock.mockResolvedValue({ allowed: false, reset: Date.now() + 5000 });
        const res = await call('PRO-2026-064036');
        expect(res.status).toBe(429);
        expect(verifySigMock).not.toHaveBeenCalled();
    });

    it('demande h et s, sinon reste muette sur l’existence de la référence', async () => {
        const res = await GET(new Request('http://localhost/api/invoices/PRO-2026-064036/download') as never, {
            params: Promise.resolve({ ref: 'PRO-2026-064036' }),
        });
        expect(res.status).toBe(404);
    });
});
