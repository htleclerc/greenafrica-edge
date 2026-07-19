import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { listArmateursCockpit } from './armateurService';

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
