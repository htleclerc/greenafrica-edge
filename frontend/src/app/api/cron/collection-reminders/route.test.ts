import { describe, it, expect, vi, beforeEach } from 'vitest';

// notifyOwner + resolveInvoiceRecipients + bailiff lookup sont mockés : ce test
// vérifie l'orchestration du cron (sélection, ordre notif→registre, idempotence,
// auth), pas leurs internes.
// vi.hoisted : les factories vi.mock sont hoistées au-dessus des imports, donc
// une const top-level référencée dedans doit passer par vi.hoisted (cf.
// src/app/api/cron/daily-precompute/route.test.ts pour le même motif).
const { notifyOwnerMock, sendProformaReminderEmailMock } = vi.hoisted(() => ({
    notifyOwnerMock: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    sendProformaReminderEmailMock: vi.fn().mockResolvedValue({ success: true, id: 'email-1' }),
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
vi.mock('@/services/emailService', () => ({
    sendProformaReminderEmail: sendProformaReminderEmailMock,
}));

import { GET } from './route';

const CRON_SECRET = 'test-cron-secret';

function req(auth: string | null): Request {
    const headers = new Headers();
    if (auth) headers.set('authorization', auth);
    return new Request('http://localhost/api/cron/collection-reminders', { headers });
}

// Faux client Supabase capturant les inserts collection_reminders + l'update
// emailed_at sur owner_notifications.
function makeClient(opts: {
    proformas?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
    paymentsError?: { message: string };
}) {
    const captured = {
        reminderInserts: [] as Record<string, unknown>[],
        emailedAtUpdates: [] as { id: string; payload: Record<string, unknown> }[],
    };
    const proformas = opts.proformas ?? [];
    const payments = opts.payments ?? [];

    const from = (table: string) => {
        if (table === 'payments') {
            // Encaissements confirmes, lus en un lot avant la boucle.
            let rows = [...payments];
            const chain: Record<string, unknown> = {};
            chain.select = () => chain;
            chain.in = (col: string, vals: unknown[]) => {
                rows = rows.filter((r) => vals.includes(r[col]));
                return chain;
            };
            chain.eq = (col: string, val: unknown) => {
                rows = rows.filter((r) => r[col] === val);
                return chain;
            };
            chain.then = (res: (v: unknown) => unknown) =>
                Promise.resolve(
                    opts.paymentsError ? { data: null, error: opts.paymentsError } : { data: rows, error: null },
                ).then(res);
            return chain;
        }
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
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { official_email: 'billing@armateur.com', name: 'Demo Armateur' }, error: null }) }) }) };
        }
        if (table === 'profiles') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        }
        if (table === 'owner_notifications') {
            return {
                update: (payload: Record<string, unknown>) => ({
                    eq: async (_col: string, id: string) => {
                        captured.emailedAtUpdates.push({ id, payload });
                        return { error: null };
                    },
                }),
            };
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
    sendProformaReminderEmailMock.mockResolvedValue({ success: true, id: 'email-1' });
});

describe('GET /api/cron/collection-reminders', () => {
    it('rejette une requête sans secret', async () => {
        __setClientForTest(makeClient({}).client);
        const res = await GET(req(null));
        expect(res.status).toBe(401);
    });

    it('rejette une requête quand CRON_SECRET n\'est pas configuré', async () => {
        delete process.env.CRON_SECRET;
        __setClientForTest(makeClient({}).client);
        const res = await GET(req('Bearer undefined'));
        expect(res.status).toBe(401);
    });

    it('envoie l\'e-mail inline avec cc + tier, puis écrit la notif PUIS le registre pour une pro-forma à J+15 sans relance', async () => {
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

        // E-mail envoyé inline avec les copies résolues + le palier.
        expect(sendProformaReminderEmailMock).toHaveBeenCalledTimes(1);
        expect(sendProformaReminderEmailMock).toHaveBeenCalledWith(expect.objectContaining({
            to: 'billing@armateur.com',
            cc: ['finance@so.gov'],
            tier: 'J15',
            invoiceRef: 'PRO-2026-30-aaaa',
        }));

        // Notif insérée avec skipEmail (l'envoi a déjà eu lieu ci-dessus) + tier dans body.
        expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
        const notifArg = notifyOwnerMock.mock.calls[0][1];
        expect(notifArg).toMatchObject({ kind: 'PROFORMA_REMINDER', skipEmail: true });
        expect(notifArg.params).toMatchObject({ tier: 'J15', invoice_ref: 'PRO-2026-30-aaaa' });

        // emailed_at estampillé sur la notif puisque l'envoi a réussi.
        expect(captured.emailedAtUpdates).toHaveLength(1);
        expect(captured.emailedAtUpdates[0].id).toBe('notif-1');
        expect(captured.emailedAtUpdates[0].payload).toHaveProperty('emailed_at');

        // Registre écrit APRÈS la notif, tier J15.
        expect(captured.reminderInserts).toHaveLength(1);
        expect(captured.reminderInserts[0]).toMatchObject({
            transaction_id: 'txn-1', tier: 'J15', sent_email: 'billing@armateur.com',
        });
    });

    it('n\'inscrit RIEN au registre quand l\'envoi e-mail échoue', async () => {
        // Inscrire malgré l'échec scellait un mensonge : `dueTier` s'arrête dès
        // que le palier figure dans `sentTiers`, et l'unicité (transaction_id,
        // tier) interdit toute reprise. Le palier était brûlé, la rampe
        // avançait, et un débiteur pouvait atteindre « dernier avis avant
        // huissier » sans avoir jamais reçu une lettre — avec un registre
        // affirmant le contraire. Sur une créance portée au contentieux, la
        // preuve elle-même devenait fausse.
        sendProformaReminderEmailMock.mockResolvedValueOnce({ success: false, error: 'resend down' });
        const created = new Date(Date.now() - 15 * 86_400_000).toISOString();
        const { client, captured } = makeClient({
            proformas: [{
                id: 'txn-3', invoice_ref: 'PRO-2026-30-cccc', tax_amount_usd: 500,
                vessel_name: 'MV Z', status: 'PENDING', created_at: created,
                shipowner_id: 'own-3', agent_profile_id: null, jurisdiction_id: 'jur-so',
            }],
        });
        __setClientForTest(client);

        const res = await GET(req(`Bearer ${CRON_SECRET}`));
        expect(res.status).toBe(200);

        // Le palier reste dû : la relance repartira tant qu'elle n'est pas
        // réellement partie.
        expect(captured.reminderInserts).toHaveLength(0);
        expect(captured.emailedAtUpdates).toHaveLength(0);
        // La notif in-app est déjà créée à ce stade — elle sert de filet au
        // notification-email-loop, qui la rattrapera puisque emailed_at est nul.
        expect(notifyOwnerMock).toHaveBeenCalledTimes(1);

        const body = await res.json();
        expect(body.failed).toBe(1);
        expect(body.sent).toBe(0);
    });

    it('relance sur le reste dû, pas sur le montant plein de la facture', async () => {
        // `partial_paid_usd` est gelée (mig 089) : la relance annonçait le
        // montant plein d'une facture déjà réglée en partie. Une mise en
        // demeure qui réclame ce qui a été payé se retourne contre son auteur.
        const created = new Date(Date.now() - 15 * 86_400_000).toISOString();
        const { client } = makeClient({
            proformas: [{
                id: 'txn-4', invoice_ref: 'PRO-2026-30-dddd', tax_amount_usd: 28999.99,
                vessel_name: 'RASHA', status: 'PARTIALLY_PAID', created_at: created,
                shipowner_id: 'own-4', agent_profile_id: null, jurisdiction_id: 'jur-so',
            }],
            payments: [{ transaction_id: 'txn-4', amount_usd_minor: 398512, status: 'CONFIRMED' }],
        });
        __setClientForTest(client);

        await GET(req(`Bearer ${CRON_SECRET}`));
        expect(sendProformaReminderEmailMock).toHaveBeenCalledWith(expect.objectContaining({
            amountUsd: expect.closeTo(25014.87, 2),
        }));
        expect(notifyOwnerMock.mock.calls[0][1].params.amount_usd).toBeCloseTo(25014.87, 2);
    });

    it('ne relance pas une créance éteinte par les paiements', async () => {
        // Statut resté en arrière (recompute manqué, encaissement hors rail) :
        // le montant fait foi, pas le libellé.
        const created = new Date(Date.now() - 45 * 86_400_000).toISOString();
        const { client, captured } = makeClient({
            proformas: [{
                id: 'txn-5', invoice_ref: 'PRO-2026-30-eeee', tax_amount_usd: 500,
                vessel_name: 'MV W', status: 'PENDING', created_at: created,
                shipowner_id: 'own-5', agent_profile_id: null, jurisdiction_id: 'jur-so',
            }],
            payments: [{ transaction_id: 'txn-5', amount_usd_minor: 50000, status: 'CONFIRMED' }],
        });
        __setClientForTest(client);

        const res = await GET(req(`Bearer ${CRON_SECRET}`));
        const body = await res.json();
        expect(sendProformaReminderEmailMock).not.toHaveBeenCalled();
        expect(captured.reminderInserts).toHaveLength(0);
        expect(body.skipped).toBe(1);
    });

    it('n envoie rien du tout si les encaissements sont illisibles', async () => {
        // Relancer sans connaître ce qui a été payé, c'est accepter d'annoncer
        // un montant faux à un débiteur. Mieux vaut ne pas relancer.
        const created = new Date(Date.now() - 15 * 86_400_000).toISOString();
        const { client, captured } = makeClient({
            proformas: [{
                id: 'txn-6', invoice_ref: 'PRO-2026-30-ffff', tax_amount_usd: 500,
                vessel_name: 'MV V', status: 'PENDING', created_at: created,
                shipowner_id: 'own-6', agent_profile_id: null, jurisdiction_id: 'jur-so',
            }],
            paymentsError: { message: 'timeout' },
        });
        __setClientForTest(client);

        const res = await GET(req(`Bearer ${CRON_SECRET}`));
        expect(res.status).toBe(500);
        expect(sendProformaReminderEmailMock).not.toHaveBeenCalled();
        expect(captured.reminderInserts).toHaveLength(0);
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
        expect(sendProformaReminderEmailMock).not.toHaveBeenCalled();
        expect(notifyOwnerMock).not.toHaveBeenCalled();
        expect(captured.reminderInserts).toHaveLength(0);
    });
});
