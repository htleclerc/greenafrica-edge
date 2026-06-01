/**
 * E2E Scenario 02 — Wire-transfer payment happy path
 *
 * Two roles, two browser contexts:
 *
 *   Owner half
 *     1. Seed an ACTIVE shipowner + vessel + PROFORMA transaction (PENDING).
 *     2. Create a SHIPOWNER auth user linked to that shipowner (auto-ACTIVE).
 *     3. Open /owner/invoices with the owner cookie set.
 *     4. Click "Pay" → PayDialog 3-step wizard:
 *        - Step 1: pick "Bank wire (SWIFT)"
 *        - Step 2: fill bank reference → Next
 *        - Step 3: Submit → initiatePayment inserts a payments row
 *          with status=INITIATED, rail=WIRE_TRANSFER.
 *
 *   Admin half
 *     5. Create a FINANCE_ADMIN auth user.
 *     6. Open /admin/payments with the admin cookie set.
 *     7. The INITIATED row appears in the table (default filter includes it).
 *     8. Click the row → PaymentReviewDrawer opens.
 *     9. Click "Confirm" → confirmPayment flips status to CONFIRMED,
 *        sets confirmed_by, generates a receipt (Plan 7C-4), and emits a
 *        PAYMENT_RECEIVED owner_notifications row (Plan 7F).
 *
 *   Asserts (service-role reads): payments.status='CONFIRMED', payments.
 *   confirmed_by set, owner_notifications has a PAYMENT_RECEIVED kind for
 *   the shipowner.
 *
 * Cleanup is registered LIFO (children before parents) so FK constraints
 * stay happy:  payments → owner_notifications → transaction → vessel →
 * shipowner → 2 auth users.
 */

import { test, expect } from '@playwright/test';
import {
    seedShipowner,
    seedVessel,
    seedProforma,
    ensurePortalEnabled,
    deleteShipowner,
    deleteVessel,
    deleteTransaction,
    uniqueTag,
    getAdminClient,
} from '../helpers/fixtures';
import { createTestUser, deleteTestUser, setSessionCookies } from '../helpers/auth';
import { registerCleanup, runCleanup } from '../helpers/cleanup';

test.afterEach(async () => {
    await runCleanup();
});

test('wire payment: owner declares wire, admin confirms, status flips to CONFIRMED', async ({ browser }) => {
    await ensurePortalEnabled();
    const admin = getAdminClient();

    // ─── Seed: shipowner + vessel + PROFORMA ───────────────────────────────
    const shipowner = await seedShipowner({ state: 'ACTIVE' });
    registerCleanup(async () => {
        await deleteShipowner(shipowner.id);
    });

    const vessel = await seedVessel({ shipownerId: shipowner.id });
    registerCleanup(async () => {
        await deleteVessel(vessel.id);
    });

    const amountUsd = 30_000;
    const proforma = await seedProforma({
        shipownerId: shipowner.id,
        vesselId: vessel.id,
        vesselImo: vessel.imoNumber,
        vesselName: vessel.name,
        amountUsd,
        emissionsTco2: 100,
    });
    registerCleanup(async () => {
        await deleteTransaction(proforma.id);
    });

    // ─── Auth: 2 users (owner + admin) ─────────────────────────────────────
    const tag = uniqueTag();
    const ownerEmail = `${tag}-owner@e2e.test`;
    const adminEmail = `${tag}-admin@e2e.test`;

    const ownerSession = await createTestUser({
        email: ownerEmail,
        role: 'SHIPOWNER',
        shipownerId: shipowner.id,
    });
    registerCleanup(async () => {
        await deleteTestUser(ownerSession.userId);
    });

    const adminSession = await createTestUser({
        email: adminEmail,
        role: 'FINANCE_ADMIN',
    });
    registerCleanup(async () => {
        await deleteTestUser(adminSession.userId);
    });

    // ─── Owner half ────────────────────────────────────────────────────────
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setSessionCookies(ownerPage, ownerSession);

    await ownerPage.goto('/owner/invoices');

    // Wait for the proforma row to render, then click the "Pay" CTA on that row.
    // The Pay button only appears when document_type='PROFORMA' && status='PENDING'.
    // The InvoicesTable renders one button per payable row; if we have only the
    // seeded proforma in scope for this shipowner there's exactly one match.
    const payButton = ownerPage.getByRole('button', { name: /^Pay$/i });
    await expect(payButton).toBeVisible({ timeout: 15_000 });
    await payButton.first().click();

    // Step 1: pick WIRE_TRANSFER. The rail buttons render the i18n label
    // "Bank wire (SWIFT)" (OwnerPortal.payDialog.rail.wire.label).
    await ownerPage.getByRole('button', { name: /Bank wire/i }).click();

    // Step 2: fill bank reference. The OsInput's `value` is controlled; no
    // `name=` attribute exists, so we target via the OsInput's parent label.
    // The label is rendered as a <label> sibling above the input, both inside
    // a flex container. Use a placeholder match instead — StepRailParams
    // ships placeholder="SWIFT-MT103-…" for bankReference.
    await ownerPage.fill('input[placeholder*="SWIFT"]', 'SWIFT-MT103-E2E-001');
    await ownerPage.getByRole('button', { name: /^Next$/i }).click();

    // Step 3: confirm. Click "Submit payment".
    await ownerPage.getByRole('button', { name: /Submit payment/i }).click();

    // After submit the dialog closes; wait until a payments row exists for
    // this transaction (RLS bypassed via admin client).
    let paymentId: string | null = null;
    for (let i = 0; i < 20 && !paymentId; i++) {
        const { data } = await admin
            .from('payments')
            .select('id, status, rail')
            .eq('transaction_id', proforma.id)
            .maybeSingle();
        if (data) {
            paymentId = data.id as string;
            expect(data.status).toBe('INITIATED');
            expect(data.rail).toBe('WIRE_TRANSFER');
            break;
        }
        await ownerPage.waitForTimeout(500);
    }
    expect(paymentId).not.toBeNull();

    // Register the payment cleanup as soon as we know the id — before the
    // admin half (which may fail) — so we don't leak the row on error.
    registerCleanup(async () => {
        if (paymentId) {
            await admin.from('payments').delete().eq('id', paymentId);
        }
    });

    await ownerCtx.close();

    // ─── Admin half ────────────────────────────────────────────────────────
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await setSessionCookies(adminPage, adminSession);

    await adminPage.goto('/admin/payments');

    // The INITIATED + PROCESSING filters are on by default. Find the row by
    // matching the short id prefix the PaymentRow renders.
    const shortId = paymentId!.slice(0, 8);
    const row = adminPage.locator('tr', { hasText: shortId });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // Drawer opens — click "Confirm". The button label is i18n key
    // AdminPayments.reviewDrawer.confirm = "Confirm".
    const confirmBtn = adminPage.getByRole('button', { name: /^Confirm$/ });
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // ─── Assert: payment is CONFIRMED + notification dispatched ────────────
    let confirmed = false;
    for (let i = 0; i < 20 && !confirmed; i++) {
        const { data } = await admin
            .from('payments')
            .select('status, confirmed_by, confirmed_at')
            .eq('id', paymentId!)
            .maybeSingle();
        if (data?.status === 'CONFIRMED') {
            expect(data.confirmed_by).toBeTruthy();
            expect(data.confirmed_at).toBeTruthy();
            confirmed = true;
            break;
        }
        await adminPage.waitForTimeout(500);
    }
    expect(confirmed).toBe(true);

    // Plan 7F: confirmPayment triggers notificationService.notifyOwner with
    // kind=PAYMENT_RECEIVED. INSERT happens before any (potential) email
    // dispatch, so the row should exist immediately after confirmation.
    const { data: notes } = await admin
        .from('owner_notifications')
        .select('kind, shipowner_id')
        .eq('shipowner_id', shipowner.id)
        .eq('kind', 'PAYMENT_RECEIVED');
    expect((notes ?? []).length).toBeGreaterThanOrEqual(1);

    // Best-effort cleanup of the notification rows we just created.
    registerCleanup(async () => {
        await admin.from('owner_notifications').delete().eq('shipowner_id', shipowner.id);
    });

    await adminCtx.close();
});
