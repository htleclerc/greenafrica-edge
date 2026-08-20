import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { listArmateursCockpit, getArmateurDetail, maskIban } from './armateurService';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENV_OK = !!URL && !!KEY;

describe.skipIf(!ENV_OK)('armateurService.listArmateursCockpit', () => {
    let admin: SupabaseClient;
    const armId = '33333333-3333-4333-8333-333333333333';
    const aviId = '44444444-4444-4444-8444-444444444444';

    beforeAll(async () => {
        admin = createClient(URL!, KEY!);
        await admin.from('shipowners').insert([
            { id: armId, name: 'ARM Test Cockpit', iata_code: null, is_ofac_sdn: true },
            { id: aviId, name: 'AVI Test Cockpit', iata_code: 'ZZ' },
        ]);
        await admin.from('transactions').insert({
            shipowner_id: armId, vessel_name: 'MV COCKPIT', vessel_imo: 'TEST-COCKPIT',
            transaction_type: 'ENTRY_TAX', emissions_tco2: 10, tax_amount_usd: 1000,
            partial_paid_usd: 400, status: 'PENDING', collections_status: 'CURRENT',
            document_type: 'PROFORMA', mode: 'MARITIME',
        });
    });

    afterAll(async () => {
        await admin.from('transactions').delete().eq('shipowner_id', armId);
        await admin.from('shipowners').delete().in('id', [armId, aviId]);
    });

    it('renvoie les armateurs maritimes agrégés et exclut les compagnies aviation', async () => {
        const rows = await listArmateursCockpit(admin);
        const arm = rows.find((r) => r.id === armId);
        const avi = rows.find((r) => r.id === aviId);
        expect(avi).toBeUndefined();
        expect(arm).toBeDefined();
        expect(arm!.proforma_count).toBe(1);
        expect(arm!.total_invoiced_usd).toBe(1000);
        expect(arm!.total_paid_usd).toBe(400);
        expect(arm!.total_outstanding_usd).toBe(600);
        expect(arm!.sanctioned).toBe(true);
    });
});

describe('listArmateursCockpit — colonnes de relance (mig 121, mock)', () => {
    function makeDb(rows: Record<string, unknown>[]) {
        const calls: { method: string; args: unknown[] }[] = [];
        const builder: Record<string, unknown> = {};
        builder.select = (...args: unknown[]) => { calls.push({ method: 'select', args }); return builder; };
        builder.order = (...args: unknown[]) => {
            calls.push({ method: 'order', args });
            return Promise.resolve({ data: rows, error: null });
        };
        const db = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return builder; } };
        return { db: db as never, calls };
    }

    it('normalise les nouvelles colonnes de relance (mig 121)', async () => {
        const { db } = makeDb([{
            id: 'own-1', name: 'ACME', account_state: 'ACTIVE',
            is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false,
            proforma_count: '3', total_invoiced_usd: '900', total_paid_usd: '100',
            total_outstanding_usd: '800',
            overdue_count: '2', next_due_date: '2026-09-01T00:00:00Z',
            last_auto_tier: 'J15', last_reminder_at: '2026-08-18T09:00:00Z',
            latest_response_type: 'PAYMENT_PROMISE',
        }]);
        const rows = await listArmateursCockpit(db);
        // PostgREST renvoie les BIGINT en string — la normalisation est le contrat.
        expect(rows[0].overdue_count).toBe(2);
        expect(rows[0].next_due_date).toBe('2026-09-01T00:00:00Z');
        expect(rows[0].last_auto_tier).toBe('J15');
        expect(rows[0].latest_response_type).toBe('PAYMENT_PROMISE');
    });

    it('retombe sur des valeurs neutres quand aucune relance n_a eu lieu', async () => {
        const { db } = makeDb([{
            id: 'own-2', name: 'BETA', account_state: 'GHOST',
            is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false,
            proforma_count: '0', total_invoiced_usd: '0', total_paid_usd: '0',
            total_outstanding_usd: '0', overdue_count: '0',
            next_due_date: null, last_auto_tier: null, last_reminder_at: null,
            latest_response_type: null,
        }]);
        const rows = await listArmateursCockpit(db);
        expect(rows[0].overdue_count).toBe(0);
        expect(rows[0].next_due_date).toBeNull();
        expect(rows[0].last_auto_tier).toBeNull();
    });
});

describe('maskIban', () => {
    it('masque tout sauf les 4 derniers', () => {
        expect(maskIban(null)).toBeNull();
        expect(maskIban('CY17002001280000001200527600')).toBe('•••• 7600');
    });
});

// Faux multi-tables partagé par les describe getArmateurDetail ci-dessous,
// distinct de makeDb plus haut : makeDb ne sert que listArmateursCockpit (une
// seule table), alors que getArmateurDetail en interroge sept. Chaque table
// reçoit son propre jeu de données ; le builder retourné est à la fois
// chaînable (select/eq/is/in/order/maybeSingle renvoient l'objet lui-même) et
// "thenable" (il expose .then), donc un `await` — direct ou via Promise.all —
// se résout quel que soit le nombre de maillons de chaîne appelés avant.
function dbWith(opts: {
    shipowner: Record<string, unknown>;
    vessels?: Record<string, unknown>[];
    transactions?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
    reminders?: Record<string, unknown>[];
    recouvrement?: Record<string, unknown> | null;
    mappings?: Record<string, unknown>[];
}) {
    function chain(data: unknown) {
        const builder: Record<string, unknown> = {
            select: () => builder,
            eq: () => builder,
            is: () => builder,
            in: () => builder,
            order: () => builder,
            maybeSingle: () => builder,
            then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
                Promise.resolve({ data, error: null }).then(resolve),
        };
        return builder;
    }
    const tables: Record<string, unknown> = {
        shipowners: opts.shipowner,
        vessels: opts.vessels ?? [],
        transactions: opts.transactions ?? [],
        payments: opts.payments ?? [],
        collection_reminders: opts.reminders ?? [],
        v_armateur_recouvrement: opts.recouvrement ?? null,
        owner_agent_mappings: opts.mappings ?? [],
    };
    const db = {
        from: (table: string) => {
            if (!(table in tables)) throw new Error(`dbWith: table non gérée "${table}"`);
            return chain(tables[table]);
        },
    };
    return db as never;
}

describe('getArmateurDetail — échéance, statut de recouvrement et totaux (mock)', () => {
    it('remonte échéance, statut de recouvrement et totaux de compte', async () => {
        // due_date et collections_status existent depuis la mig 022 mais
        // n'étaient jamais lus — c'est la régression que ce test verrouille.
        const detail = await getArmateurDetail(dbWith({
            shipowner: { id: 'own-1', name: 'ACME', account_state: 'ACTIVE', billing_cc_emails: ['f@x.com'] },
            transactions: [{
                id: 'tx1', invoice_ref: 'INV-1', created_at: '2026-07-01T00:00:00Z',
                tax_amount_usd: '500', partial_paid_usd: '100', status: 'OVERDUE',
                due_date: '2026-07-31T00:00:00Z', collections_status: 'OVERDUE',
            }],
            recouvrement: {
                total_invoiced_usd: '500', total_paid_usd: '100', total_outstanding_usd: '400',
                overdue_count: '1', next_due_date: '2026-07-31T00:00:00Z',
            },
        }), 'own-1', true);
        expect(detail?.proformas[0].due_date).toBe('2026-07-31T00:00:00Z');
        expect(detail?.proformas[0].collections_status).toBe('OVERDUE');
        expect(detail?.totals).toMatchObject({ outstandingUsd: 400, overdueCount: 1 });
        expect(detail?.billing_cc_emails).toEqual(['f@x.com']);
    });

    it('retombe sur des totaux neutres quand la vue ne renvoie aucune ligne', async () => {
        const detail = await getArmateurDetail(dbWith({
            shipowner: { id: 'own-2', name: 'BETA', account_state: 'GHOST' },
            recouvrement: null,
        }), 'own-2', false);
        expect(detail?.totals).toEqual({
            invoicedUsd: 0, paidUsd: 0, outstandingUsd: 0, overdueCount: 0, nextDueDate: null,
        });
        expect(detail?.billing_cc_emails).toEqual([]);
    });
});

describe('getArmateurDetail — représentants (mock)', () => {
    it('remonte les représentants actifs par priorité croissante', async () => {
        const detail = await getArmateurDetail(dbWith({
            shipowner: { id: 'own-1', name: 'ACME', account_state: 'ACTIVE' },
            mappings: [
                { id: 'm2', agent_profile_id: 'p2', priority: 200, active: true,
                  valid_from: '2026-01-01', valid_until: null,
                  profiles: { full_name: 'Second', email: 'b@x.com' } },
                { id: 'm1', agent_profile_id: 'p1', priority: 100, active: true,
                  valid_from: '2026-01-01', valid_until: null,
                  profiles: { full_name: 'Premier', email: 'a@x.com' } },
            ],
        }), 'own-1', true);
        // La priorité la plus basse est le contact principal : c'est lui qui part
        // en copie des factures via la cascade d'envoi.
        expect(detail?.representatives.map((r) => r.full_name)).toEqual(['Premier', 'Second']);
        expect(detail?.representatives[0].email).toBe('a@x.com');
    });

    it('normalise profiles en tableau (cardinalité PostgREST) sans planter', () => {
        // Le patron `Array.isArray(...)` d'escalateCollection.ts:84 doit tenir
        // même quand PostgREST choisit de renvoyer la relation jointe comme
        // tableau à un seul élément plutôt que comme objet — un typage naïf
        // (objet seul) compile mais casse à l'exécution sur cette forme.
        return getArmateurDetail(dbWith({
            shipowner: { id: 'own-1', name: 'ACME', account_state: 'ACTIVE' },
            mappings: [
                { id: 'm1', agent_profile_id: 'p1', priority: 100, active: true,
                  valid_from: '2026-01-01', valid_until: null,
                  profiles: [{ full_name: 'Premier', email: 'a@x.com' }] },
            ],
        }), 'own-1', true).then((detail) => {
            expect(detail?.representatives[0].full_name).toBe('Premier');
            expect(detail?.representatives[0].email).toBe('a@x.com');
        });
    });

    it('inclut les représentants révoqués (historique) avec active: false', async () => {
        const detail = await getArmateurDetail(dbWith({
            shipowner: { id: 'own-1', name: 'ACME', account_state: 'ACTIVE' },
            mappings: [
                { id: 'm1', agent_profile_id: 'p1', priority: 100, active: false,
                  valid_from: '2026-01-01', valid_until: '2026-06-01',
                  profiles: { full_name: 'Ancien', email: 'old@x.com' } },
            ],
        }), 'own-1', true);
        expect(detail?.representatives).toEqual([{
            id: 'm1', profile_id: 'p1', full_name: 'Ancien', email: 'old@x.com',
            priority: 100, active: false, valid_from: '2026-01-01', valid_until: '2026-06-01',
        }]);
    });

    it('retombe sur un tableau vide quand l_armateur n_a aucun représentant', async () => {
        const detail = await getArmateurDetail(dbWith({
            shipowner: { id: 'own-1', name: 'ACME', account_state: 'ACTIVE' },
        }), 'own-1', true);
        expect(detail?.representatives).toEqual([]);
    });
});

describe.skipIf(!ENV_OK)('getArmateurDetail', () => {
    let admin: SupabaseClient;
    const armId = '55555555-5555-4555-8555-555555555555';
    let vId: string;
    let txId: string;

    beforeAll(async () => {
        admin = createClient(URL!, KEY!);
        await admin.from('shipowners').insert({ id: armId, name: 'ARM Detail', iata_code: null, official_email: 'x@arm.test', imo_company_no: 'IMO-DET-1' });
        const { data: v } = await admin.from('vessels').insert({
            imo_number: 'DET-VESSEL-1', mmsi: null, name: 'MV DETAIL', call_sign: null,
            flag_code: 'SO', category: 'CARGO', gross_tonnage_dwt: 12000, shipowner_id: armId,
        }).select('id').single();
        vId = v!.id;
        const { data: t } = await admin.from('transactions').insert({
            shipowner_id: armId, vessel_name: 'MV DETAIL', vessel_imo: 'DET-VESSEL-1',
            transaction_type: 'ENTRY_TAX', emissions_tco2: 5, tax_amount_usd: 800,
            partial_paid_usd: 0, status: 'PENDING', collections_status: 'CURRENT',
            document_type: 'PROFORMA', mode: 'MARITIME', invoice_ref: 'PRO-DET-0001',
        }).select('id').single();
        txId = t!.id;
    });
    afterAll(async () => {
        await admin.from('transactions').delete().eq('shipowner_id', armId);
        await admin.from('vessels').delete().eq('id', vId);
        await admin.from('shipowners').delete().eq('id', armId);
    });

    it('agrège identité + navires + proformas', async () => {
        const d = await getArmateurDetail(admin, armId, true);
        expect(d).not.toBeNull();
        expect(d!.name).toBe('ARM Detail');
        expect(d!.iban_masked).toBeNull();
        expect(d!.vessels.map((v) => v.imo_number)).toContain('DET-VESSEL-1');
        expect(d!.proformas.find((p) => p.id === txId)?.invoice_ref).toBe('PRO-DET-0001');
        expect(d!.proformas.find((p) => p.id === txId)?.content_hash).toBeNull();
    });

    it('renvoie null pour un id inconnu', async () => {
        expect(await getArmateurDetail(admin, '00000000-0000-4000-8000-000000000000', true)).toBeNull();
    });

    it('renvoie null pour une compagnie aviation (iata_code non nul)', async () => {
        const aviId = '66666666-6666-4666-8666-666666666666';
        await admin.from('shipowners').insert({ id: aviId, name: 'AVI Detail', iata_code: 'ZZ' });
        try {
            expect(await getArmateurDetail(admin, aviId, true)).toBeNull();
        } finally {
            await admin.from('shipowners').delete().eq('id', aviId);
        }
    });
});
