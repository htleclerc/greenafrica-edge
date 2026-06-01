/**
 * E2E Scenario 03 — Refund happy path (WALLET rail) — SKIPPED
 *
 * Pending merge of Plan 7G (PR #28). When that lands, unskip the describe
 * block and flesh out the test body following the outline below.
 */

import { test } from '@playwright/test';

test.describe.skip('Refund WALLET happy path [pending Plan 7G PR #28 merge]', () => {
    test('admin executes WALLET refund, ledger credited, owner notified', async () => {
        // ─── Prerequisites (Plan 7G ships these) ───────────────────────────
        //   - mig 066: auto-INSERT into `refunds` table when a transactions
        //     row of document_type='REFUND' is inserted (idempotent on
        //     transaction_id).
        //   - Server actions: approveRefund, executeRefund, rejectRefund
        //     (under `src/actions/`, FINANCE_ADMIN-only via requireRole).
        //   - UI: /admin/refunds page + RefundDetailDrawer with rail picker
        //     (WALLET = 1-click execute since no external rail is involved).
        //
        // ─── Test outline ──────────────────────────────────────────────────
        // Setup (helpers/fixtures.ts extensions may be needed):
        //   1. seedShipowner({ state: 'ACTIVE' })
        //   2. seedVessel({ shipownerId })
        //   3. Direct admin INSERT: a CONFIRMED payments row (with a
        //      transaction_id FK to a FINAL or PROFORMA transaction).
        //   4. Direct admin INSERT: a transactions row with
        //      document_type='REFUND', tax_amount_usd > 0, breakdown_json
        //      including `refundDirection: 'OWED_TO_AGENT'`. Mig 066's
        //      trigger then auto-creates the refunds row in status=REQUESTED.
        //   5. createTestUser({ role: 'FINANCE_ADMIN' })
        //
        // Steps:
        //   1. setSessionCookies on adminPage; page.goto('/admin/refunds').
        //   2. Click on the REQUESTED tab if not default.
        //   3. Click the refund row → RefundDetailDrawer opens.
        //   4. Pick rail = WALLET (radio or button); WALLET is 1-click since
        //      no external transfer is involved — no proof upload required.
        //   5. Click "Refund to wallet" (button name TBD by Plan 7G UI).
        //
        // Asserts:
        //   - admin.from('refunds').select() shows
        //       status='EXECUTED', executed_by=adminSession.userId,
        //       executed_at not null, rail='WALLET'.
        //   - admin.from('wallet_ledger').select() has a new row with
        //       kind='REFUND_CREDIT', amount_signed_usd_minor>0,
        //       wallet_id matching the shipowner's wallet.
        //   - admin.from('wallets').select() balance_usd_minor increased
        //     by exactly the refund amount (mig 050 trigger invariant).
        //   - admin.from('owner_notifications').select() has a row with
        //       kind='REFUND_ISSUED' (or whatever Plan 7G's
        //       notificationService kind ends up being).
        //
        // Cleanup (LIFO):
        //   - owner_notifications row(s) for the shipowner
        //   - wallet_ledger row created by the refund (DO NOT mutate, just
        //     delete — wallet_ledger has a `prevent_ledger_mutation` BEFORE
        //     UPDATE/DELETE trigger; for test cleanup we'd have to disable
        //     it via service-role + raw SQL, OR rely on the parent
        //     shipowner cascade once Plan 7G confirms the FK
        //     CASCADE behaviour. Worth a follow-up question.)
        //   - refunds row
        //   - REFUND transactions row
        //   - the CONFIRMED payment + its transaction
        //   - vessel
        //   - shipowner
        //   - the FINANCE_ADMIN auth user
        //
        // Known gotcha: wallet_ledger is append-only by trigger. If the
        // straight DELETE fails during cleanup, switch to service-role
        // raw SQL with `SET LOCAL session_replication_role = replica` for
        // that one statement, or accept that test data accumulates and
        // the weekly orphan sweep handles it.
    });
});
