import { describe, it, expect, vi, beforeEach } from 'vitest';

// notifyOwner + resolveInvoiceRecipients + bailiff lookup sont mockés : ce test
// vérifie l'orchestration du cron (sélection, ordre notif→registre, idempotence,
// auth), pas leurs internes.
// vi.hoisted : les factories vi.mock sont hoistées au-dessus des imports, donc
// une const top-level référencée dedans doit passer par vi.hoisted (cf.
// src/app/api/cron/daily-precompute/route.test.ts pour le même motif).
const { notifyOwnerMock } = vi.hoisted(() => ({
    notifyOwnerMock: vi.fn().mockResolvedValue({ id: 'notif-1' }),
}));
vi.mock('@/services/notificationService', () => ({
    notifyOwner: notifyOwnerMock,
    EMAIL_KINDS: new Set(['PROFORMA_REMINDER']),
}));
vi.mock('@/services/invoiceIssuanceService', () => ({
    resolveInvoiceRecipients: vi.fn(() => ({ to: 'billing@armateur.com', cc: ['finance@so.gov'] })),
}));
vi.mock('@/lib/jurisdictionName', () => ({
    fetchJurisdictionBillingCc: vi.fn().mockResolvedValue([]),
}));

import { GET } from './route';

const CRON_SECRET = 'test-cron-secret';

function req(auth: string | null): Request {
    const headers = new Headers();
    if (auth) headers.set('authorization', auth);
    return new Request('http://localhost/api/cron/collection-reminders', { headers });
}

// Faux client Supabase capturant les inserts collection_reminders.
function makeClient(opts: {
    proformas?: Record<string, unknown>[];
    remindersByTxn?: Record<string, { tier: string }[]>;
}) {
    const captured = { reminderInserts: [] as Record<string, unknown>[] };
    const proformas = opts.proformas ?? [];
    const remindersByTxn = opts.remindersByTxn ?? {};

    const from = (table: string) => {
        if (table === 'transactions') {
            // Chaîne alignée sur la route : .eq('document_type').in('status').not('shipowner_id').limit()
            return {
                select: () => ({
                    eq: () => ({
                        in: () => ({
                            not: () => ({ limit: async () => ({ data: proformas, error: null }) }),
                        }),
                    }),
                }),
            };
        }
        if (table === 'collection_reminders') {
            return {
                select: () => ({
                    eq: () => ({ order: () => ({ /* sentTiers + latest response */
                        limit: async () => ({ data: [], error: null }) }) }),
                }),
                insert: (payload: Record<string, unknown>) => {
                    captured.reminderInserts.push(payload);
                    return { error: null };
                },
            };
        }
        if (table === 'shipowners') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { official_email: 'billing@armateur.com' }, error: null }) }) }) };
        }
        if (table === 'profiles') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        }
        throw new Error(`unexpected table ${table}`);
    };
    return { client: { from } as unknown as import('@supabase/supabase-js').SupabaseClient, captured };
}

// Le test injecte le client via un hook module-level (voir implémentation :
// serviceClient() est remplaçable par __setClientForTest).
import { __setClientForTest } from './route';

beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    notifyOwnerMock.mockResolvedValue({ id: 'notif-1' });
});

describe('GET /api/cron/collection-reminders', () => {
    it('rejette une requête sans secret', async () => {
        __setClientForTest(makeClient({}).client);
        const res = await GET(req(null));
        expect(res.status).toBe(401);
    });

    it('écrit la notif PUIS le registre pour une pro-forma à J+15 sans relance', async () => {
        const created = new Date(Date.now() - 15 * 86_400_000).toISOString();
        const { client, captured } = makeClient({
            proformas: [{
                id: 'txn-1', invoice_ref: 'PRO-2026-30-aaaa', tax_amount_usd: 500,
                vessel_name: 'MV X', status: 'PENDING', created_at: created,
                shipowner_id: 'own-1', agent_profile_id: null, jurisdiction_id: 'jur-so',
            }],
        });
        __setClientForTest(client);

        const res = await GET(req(`Bearer ${CRON_SECRET}`));
        expect(res.status).toBe(200);

        // Notif insérée avec skipEmail (pas de double e-mail) + tier dans body.
        expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
        const notifArg = notifyOwnerMock.mock.calls[0][1];
        expect(notifArg).toMatchObject({ kind: 'PROFORMA_REMINDER', skipEmail: true });
        expect(notifArg.params).toMatchObject({ tier: 'J15', invoice_ref: 'PRO-2026-30-aaaa' });

        // Registre écrit APRÈS la notif, tier J15.
        expect(captured.reminderInserts).toHaveLength(1);
        expect(captured.reminderInserts[0]).toMatchObject({
            transaction_id: 'txn-1', tier: 'J15', sent_email: 'billing@armateur.com',
        });
    });

    it('n\'écrit rien pour une pro-forma DISPUTED', async () => {
        const created = new Date(Date.now() - 45 * 86_400_000).toISOString();
        const { client, captured } = makeClient({
            proformas: [{
                id: 'txn-2', invoice_ref: 'PRO-2026-30-bbbb', tax_amount_usd: 500,
                vessel_name: 'MV Y', status: 'DISPUTED', created_at: created,
                shipowner_id: 'own-2', agent_profile_id: null, jurisdiction_id: 'jur-so',
            }],
        });
        __setClientForTest(client);

        const res = await GET(req(`Bearer ${CRON_SECRET}`));
        expect(res.status).toBe(200);
        expect(notifyOwnerMock).not.toHaveBeenCalled();
        expect(captured.reminderInserts).toHaveLength(0);
    });
});
