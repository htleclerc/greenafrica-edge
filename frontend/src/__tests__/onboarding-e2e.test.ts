import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// E2E: requires a live Supabase. Skipped in CI (no env). Run locally with:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx vitest run
const ENV_OK = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

describe.skipIf(!ENV_OK)('Onboarding E2E', () => {
    let supabase: SupabaseClient;
    beforeAll(() => {
        supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );
    });

    const cleanupTestData = async () => {
        // Delete in reverse dependency order: vessels first (FK to shipowners),
        // then wallets (FK to shipowners), then shipowners.
        const { data: testShipowners } = await supabase
            .from('shipowners')
            .select('id')
            .like('imo_company_no', '999%');

        const testIds = testShipowners?.map(s => s.id) || [];
        if (testIds.length > 0) {
            await supabase.from('vessels').delete().in('shipowner_id', testIds);
            await supabase.from('wallets').delete().in('shipowner_id', testIds);
        }

        // Also delete orphan vessels (no shipowner)
        await supabase.from('vessels').delete().like('imo_number', '999%');
        // Finally delete the shipowners
        await supabase.from('shipowners').delete().like('imo_company_no', '999%');
    };

    beforeEach(async () => {
        await cleanupTestData();
    });

    afterAll(async () => {
        await cleanupTestData();
    });

    it('Auto-claim happy path: vessel + GHOST + matching imo_company → ACTIVE', async () => {
        const { data: ghost, error: ghostErr } = await supabase.from('shipowners').insert({
            name: 'Pre-existing Ghost',
            imo_company_no: '9991111',
            account_state: 'GHOST',
            preferred_language: 'en',
        }).select().single();

        if (ghostErr || !ghost) throw new Error(`Failed to create ghost: ${ghostErr?.message}`);

        const { error: vesselErr } = await supabase.from('vessels').insert({
            imo_number: '9990001',
            mmsi: '999000001',
            name: 'TestVessel',
            call_sign: 'ZZZ1',
            flag_code: 'SO',
            category: 'CONTAINER',
            gross_tonnage_dwt: 1000,
            engine_power_kw: 500,
            design_speed_knots: 10,
            shipowner_id: ghost.id,
        });

        if (vesselErr) throw new Error(`Failed to create vessel: ${vesselErr.message}`);

        const { registerShipowner } = await import('../actions/registerShipowner');
        const r = await registerShipowner({
            email: 'autoclaim-e2e@test.com',
            name: 'Updated Ghost Co',
            imo_company_no: '9991111',
            country_code: 'SO',
            address: '123 St',
            proof_imo_vessel_imo: '9990001',
            proof_doc_storage_path: 'pending/x.pdf',
            proof_doc_type: 'TRADE_REGISTER',
            preferred_language: 'en',
            recaptcha_token: 'tok',
        }, '127.0.0.1');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBe(ghost.id);

        const { data: now } = await supabase.from('shipowners')
            .select('account_state, name')
            .eq('id', ghost.id).single();
        expect(now?.account_state).toBe('ACTIVE');
        expect(now?.name).toBe('Updated Ghost Co');

        // Cleanup auth user (best effort)
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const authUser = users.find((u: any) => u.email === 'autoclaim-e2e@test.com');
        if (authUser) await supabase.auth.admin.deleteUser(authUser.id);
    });

    it('PENDING_REVIEW path: vessel exists, no GHOST → INSERT pending', async () => {
        const { error: vesselErr } = await supabase.from('vessels').insert({
            imo_number: '9990002',
            mmsi: '999000002',
            name: 'OrphanVessel',
            call_sign: 'ZZZ2',
            flag_code: 'SO',
            category: 'CONTAINER',
            gross_tonnage_dwt: 1000,
            engine_power_kw: 500,
            design_speed_knots: 10,
            shipowner_id: null,
        });

        if (vesselErr) throw new Error(`Failed to create vessel: ${vesselErr.message}`);

        const { registerShipowner } = await import('../actions/registerShipowner');
        const r = await registerShipowner({
            email: 'orphan-e2e@test.com',
            name: 'New Co',
            imo_company_no: '9992222',
            country_code: 'SO',
            address: '123 St',
            proof_imo_vessel_imo: '9990002',
            proof_doc_storage_path: 'pending/y.pdf',
            proof_doc_type: 'OTHER',
            preferred_language: 'en',
            recaptcha_token: 'tok',
        }, '127.0.0.1');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBeUndefined();

        const { data } = await supabase.from('shipowners')
            .select('account_state').eq('imo_company_no', '9992222').single();
        expect(data?.account_state).toBe('PENDING_REVIEW');
    });

    it('Reject flow: PENDING_REVIEW → REJECTED with rejection_reason', async () => {
        const { data: pending, error: insertErr } = await supabase.from('shipowners').insert({
            name: 'Reject Me Ltd',
            imo_company_no: '9993333',
            country_code: 'SO',
            address: '1 St',
            official_email: 'reject-e2e@test.com',
            account_state: 'PENDING_REVIEW',
            preferred_language: 'en',
        }).select().single();

        if (insertErr || !pending) throw new Error(`Failed to create pending shipowner: ${insertErr?.message}`);

        const { error: updateErr } = await supabase.from('shipowners')
            .update({ account_state: 'REJECTED', rejection_reason: 'Bad documents' })
            .eq('id', pending.id);

        if (updateErr) throw new Error(`Failed to update shipowner: ${updateErr.message}`);

        const { data: now } = await supabase.from('shipowners')
            .select('account_state, rejection_reason')
            .eq('id', pending.id).single();
        expect(now?.account_state).toBe('REJECTED');
        expect(now?.rejection_reason).toBe('Bad documents');
    });
});
