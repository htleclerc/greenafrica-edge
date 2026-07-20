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

describe('maskIban', () => {
    it('masque tout sauf les 4 derniers', () => {
        expect(maskIban(null)).toBeNull();
        expect(maskIban('CY17002001280000001200527600')).toBe('•••• 7600');
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
        const d = await getArmateurDetail(admin, armId);
        expect(d).not.toBeNull();
        expect(d!.name).toBe('ARM Detail');
        expect(d!.vessels.map((v) => v.imo_number)).toContain('DET-VESSEL-1');
        expect(d!.proformas.find((p) => p.id === txId)?.invoice_ref).toBe('PRO-DET-0001');
    });

    it('renvoie null pour un id inconnu', async () => {
        expect(await getArmateurDetail(admin, '00000000-0000-4000-8000-000000000000')).toBeNull();
    });
});
