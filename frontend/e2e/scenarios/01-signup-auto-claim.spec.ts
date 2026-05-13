/**
 * E2E Scenario 01 — Signup auto-claim
 *
 * Flow:
 *   1. Seed a GHOST shipowner with a known imo_company_no + a vessel attached.
 *   2. Anonymous browser visits /owner/register, fills the form with the
 *      same imo_company_no AND the proof_imo_vessel_imo pointing at the
 *      seeded vessel.
 *   3. registerShipowner (action via /api/auth/register-shipowner) hits the
 *      auto-claim branch: shipowner flips GHOST → ACTIVE, an auth user is
 *      created via inviteUserByEmail, profiles.profile_id is linked,
 *      a wallets row is inserted, an audit_logs row is written.
 *   4. We assert the DB side-effects via the service-role client.
 *
 * Cleanup (LIFO): audit_logs → wallets → auth user (cascades profile) →
 * shipowner → vessel.
 *
 * Real-world UI selectors used here come from
 * `src/app/owner/register/RegisterForm.tsx` (which renders OsInput
 * children whose `name` attribute matches the API contract); the recaptcha
 * step is short-circuited in non-production by registerShipowner via
 * `process.env.NODE_ENV !== 'production'` so RECAPTCHA_SECRET_KEY does not
 * need to be set.
 */

import { test, expect } from '@playwright/test';
import {
    seedShipowner,
    seedVessel,
    ensurePortalEnabled,
    ensureSelfServiceEnabled,
    deleteShipowner,
    deleteVessel,
    uniqueTag,
    fakeImo,
    getAdminClient,
    findUserIdByEmail,
} from '../helpers/fixtures';
import { deleteTestUser } from '../helpers/auth';
import { registerCleanup, runCleanup } from '../helpers/cleanup';

test.afterEach(async () => {
    await runCleanup();
});

test('signup auto-claim: matching IMO company flips GHOST shipowner to ACTIVE', async ({ page }) => {
    await ensurePortalEnabled();
    await ensureSelfServiceEnabled();

    const admin = getAdminClient();

    // ─── Seed GHOST shipowner + vessel ─────────────────────────────────────
    const imoCompanyNo = fakeImo('9');           // 7-digit, prefixed 9 to avoid collision
    const vesselImoNo = fakeImo('9');            // distinct 7-digit IMO for the vessel itself

    const shipowner = await seedShipowner({
        state: 'GHOST',
        imoCompanyNo,
    });
    registerCleanup(async () => {
        await deleteShipowner(shipowner.id);
    });

    const vessel = await seedVessel({
        shipownerId: shipowner.id,
        imoNumber: vesselImoNo,
    });
    registerCleanup(async () => {
        await deleteVessel(vessel.id);
    });

    // ─── Anonymous signup form ─────────────────────────────────────────────
    const tag = uniqueTag();
    const testEmail = `${tag}@e2e.test`;
    const testCompany = `${tag}-Co`;

    // Capture the auth user id (and any side-effect rows) for cleanup before
    // we trigger creation, so they fire even if assertions fail.
    registerCleanup(async () => {
        const userId = await findUserIdByEmail(testEmail);
        if (userId) {
            await deleteTestUser(userId);
        }
    });

    // Final-review fix: wallets.shipowner_id FK has NO ON DELETE CASCADE
    // (mig 050). The auto-claim path inserts a wallets row; without an
    // explicit DELETE before deleteShipowner runs (LIFO last), the FK
    // blocks the shipowner delete and orphans both rows. wallet_ledger
    // is empty at this point (no ledger entries from auto-claim itself),
    // so the prevent_ledger_mutation trigger isn't a concern here.
    // Registered LAST → runs FIRST in LIFO order.
    registerCleanup(async () => {
        const adminClient = getAdminClient();
        const { error } = await adminClient
            .from('wallets')
            .delete()
            .eq('shipowner_id', shipowner.id);
        if (error) {
            // eslint-disable-next-line no-console
            console.warn(`[e2e/scenario-01] wallet cleanup failed for ${shipowner.id}:`, error.message);
        }
    });

    await page.goto('/owner/register');

    // OsInput labels aren't associated with the underlying input via htmlFor,
    // so we target the inputs by their `name` attribute — that's the public
    // API the registerShipowner action consumes.
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="name"]', testCompany);
    await page.fill('input[name="imo_company_no"]', imoCompanyNo);
    await page.fill('input[name="country_code"]', 'SO');
    await page.fill('input[name="address"]', '12 Test Quay, Mogadishu Port');
    await page.fill('input[name="proof_imo_vessel_imo"]', vesselImoNo);

    // Proof document upload — a tiny placeholder PDF lives under e2e/fixtures/.
    // The registerShipowner action only stores the storage path; the file
    // bytes go to Supabase Storage via the form's client-side upload.
    await page.setInputFiles('input[name="proof_doc"]', 'e2e/fixtures/test-proof.pdf');
    await page.selectOption('select[name="proof_doc_type"]', 'TRADE_REGISTER');
    await page.selectOption('select[name="preferred_language"]', 'en');

    // Submit. Watch for the thanks_title banner OR a non-OK toast.
    await page.click('button[type="submit"]');

    // The success branch renders a "Thank you" card with i18n key OwnerRegister.thanks_title.
    // (See RegisterForm.tsx line 82-89; result.ok rerenders the whole form.)
    await expect(page.getByText(/thank you|merci/i)).toBeVisible({ timeout: 15_000 });

    // ─── Assert DB side-effects ────────────────────────────────────────────
    const { data: claimed, error: claimErr } = await admin
        .from('shipowners')
        .select('id, account_state, profile_id, imo_company_no_verified_at, kyc_level_b_completed_at')
        .eq('id', shipowner.id)
        .single();
    expect(claimErr).toBeNull();
    expect(claimed?.account_state).toBe('ACTIVE');
    expect(claimed?.profile_id).toBeTruthy();
    expect(claimed?.imo_company_no_verified_at).toBeTruthy();
    expect(claimed?.kyc_level_b_completed_at).toBeTruthy();

    // The autoClaim path also seeds a wallets row.
    const { data: wallet } = await admin
        .from('wallets')
        .select('shipowner_id, balance_usd_minor')
        .eq('shipowner_id', shipowner.id)
        .maybeSingle();
    expect(wallet).not.toBeNull();
    expect(Number(wallet?.balance_usd_minor ?? -1)).toBe(0);

    // And an audit_logs row tagged SHIPOWNER_AUTO_CLAIM.
    const { data: audits } = await admin
        .from('audit_logs')
        .select('action, entity_type, entity_id, details_json')
        .eq('entity_type', 'Shipowner')
        .eq('entity_id', shipowner.id);
    const claimAudit = (audits ?? []).find(
        (a: { details_json: { event?: string } }) =>
            a.details_json?.event === 'SHIPOWNER_AUTO_CLAIM',
    );
    expect(claimAudit).toBeDefined();
});
