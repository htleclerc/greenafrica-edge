'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { getRefundById } from '@/services/refundService';
import { createRefund as stripeCreateRefund } from '@/services/stripeService';
import { notifyOwner } from '@/services/notificationService';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 6: executeRefund
//
// The centerpiece refund action. Transitions a refund row from REQUESTED|
// APPROVED → EXECUTED with rail-specific side effects:
//
//   - WALLET: 1-click execute path (from REQUESTED) OR 2-step (from APPROVED).
//             INSERTs a wallet_ledger REFUND_CREDIT row; mig 050 trigger
//             auto-increments wallets.balance_usd_minor.
//   - WIRE_TRANSFER: no auto side effect. Optional proofPath stored in
//                    rail_details.proof_storage_path for the receipt trail.
//   - STRIPE: looks up the original CONFIRMED Stripe payment row to get the
//             PaymentIntent id, then calls stripeService.createRefund(). On
//             API failure the refund stays in APPROVED — the admin can retry
//             once Stripe is reachable again. Webhook (Task 8) is the
//             idempotent safety net for race conditions / lost responses.
//   - Other rails (CASH/CHEQUE/MOBILE_MONEY/THIRD_PARTY/NETTING/LC/BANK_GUARANTEE):
//             state transition only; admin records execution out-of-band.
//
// All state writes happen AFTER the side effect succeeds — so a half-executed
// orphan row should not exist. The one residual hazard is the WALLET case
// where wallet_ledger INSERT succeeds but the refunds UPDATE race-guard
// trips: we log a warning and surface the inconsistency. The ledger row
// will reflect a +REFUND_CREDIT against a refund whose status didn't advance,
// which an admin can reconcile manually. (Avoiding this entirely requires a
// stored procedure / single transaction — deferred to a future cleanup.)
//
// Notifications + audit log are fail-soft: a notify failure cannot roll back
// the canonical state.
// ─────────────────────────────────────────────────────────────────────────────

const RAIL_VALUES = [
    'WALLET',
    'WIRE_TRANSFER',
    'STRIPE',
    'CASH',
    'CHEQUE',
    'MOBILE_MONEY',
    'THIRD_PARTY',
    'BANK_GUARANTEE',
    'NETTING',
    'LETTER_OF_CREDIT',
] as const;

type RefundRail = (typeof RAIL_VALUES)[number];

const schema = z.object({
    refundId: z.string().uuid(),
    refundRail: z.enum(RAIL_VALUES).optional(),
    railDetails: z.record(z.string(), z.unknown()).optional(),
    proofPath: z.string().optional(),
});

export type ExecuteRefundResult =
    | { ok: true; refundId: string; rail: RefundRail }
    | { ok: false; error: string };

export async function executeRefund(input: {
    refundId: string;
    refundRail?: RefundRail;
    railDetails?: Record<string, unknown>;
    proofPath?: string;
}): Promise<ExecuteRefundResult> {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error || !auth.user) throw new Error('Not authorized');
    const actorId = auth.user.id;
    const actorName = auth.user.fullName;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    // 1. Fetch refund with joined transaction + shipowner
    const refund = await getRefundById(admin, parsed.refundId);
    if (!refund) return { ok: false, error: `Refund not found: ${parsed.refundId}` };

    // 2. Determine execution path
    //    - REQUESTED + WALLET → 1-click combo (approve+execute)
    //    - APPROVED → standard execute (rail already set on the row)
    //    - everything else → illegal transition
    let isOneClick = false;
    let finalRail: RefundRail;
    if (refund.status === 'REQUESTED' && parsed.refundRail === 'WALLET') {
        isOneClick = true;
        finalRail = 'WALLET';
    } else if (refund.status === 'APPROVED' && refund.refund_rail) {
        finalRail = refund.refund_rail as RefundRail;
    } else {
        return {
            ok: false,
            error: `Invalid status transition: cannot execute from status=${refund.status}${
                refund.status === 'REQUESTED' ? ' without refundRail=WALLET (use approveRefund for other rails)' : ''
            }`,
        };
    }

    // 3. Rail-specific side effects (BEFORE marking EXECUTED — fail-fast so a
    //    failure leaves the refund in its pre-execution state for retry).
    const mergedRailDetails: Record<string, unknown> = {
        ...(refund.rail_details ?? {}),
        ...(parsed.railDetails ?? {}),
    };

    if (finalRail === 'WALLET') {
        // Look up wallet by shipowner_id
        const { data: wallet, error: walletErr } = await admin
            .from('wallets')
            .select('id')
            .eq('shipowner_id', refund.shipowner_id)
            .maybeSingle();
        if (walletErr) return { ok: false, error: `Wallet lookup failed: ${walletErr.message}` };
        if (!wallet) {
            return { ok: false, error: `Wallet not found for shipowner ${refund.shipowner_id}` };
        }
        const { error: ledgerErr } = await admin.from('wallet_ledger').insert({
            wallet_id: (wallet as { id: string }).id,
            kind: 'REFUND_CREDIT',
            amount_signed_usd_minor: refund.amount_usd_minor,
            refund_id: refund.id,
            created_by: actorId,
            justification: 'REFUND_EXECUTED',
        });
        if (ledgerErr) {
            return { ok: false, error: `Wallet ledger insert failed: ${ledgerErr.message}` };
        }
    } else if (finalRail === 'WIRE_TRANSFER') {
        if (parsed.proofPath) {
            mergedRailDetails.proof_storage_path = parsed.proofPath;
        }
    } else if (finalRail === 'STRIPE') {
        // Look up the original CONFIRMED Stripe payment for this transaction
        const { data: origPayment, error: payErr } = await admin
            .from('payments')
            .select('id, external_reference')
            .eq('transaction_id', refund.transaction_id)
            .eq('rail', 'STRIPE')
            .eq('status', 'CONFIRMED')
            .limit(1)
            .maybeSingle();
        if (payErr) {
            return { ok: false, error: `Original Stripe payment lookup failed: ${payErr.message}` };
        }
        if (!origPayment || !(origPayment as { external_reference: string | null }).external_reference) {
            return {
                ok: false,
                error: `No original Stripe payment found for transaction ${refund.transaction_id}`,
            };
        }
        const piId = (origPayment as { external_reference: string }).external_reference;

        try {
            const stripeResult = await stripeCreateRefund({
                paymentIntent: piId,
                amountMinor: refund.amount_usd_minor,
            });
            mergedRailDetails.stripe_refund_id = stripeResult.id;
            mergedRailDetails.stripe_refund_status = stripeResult.status;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Refund stays in APPROVED — admin can retry once Stripe is reachable.
            return { ok: false, error: `Stripe refund failed: ${msg}` };
        }
    }
    // Other rails: no side effect; mergedRailDetails already carries any
    // input.railDetails (e.g. bank_reference, justification).

    // 4. UPDATE refunds (race-guarded on the expected pre-state)
    const expectedStatus = isOneClick ? 'REQUESTED' : 'APPROVED';
    const updatePayload: Record<string, unknown> = {
        status: 'EXECUTED',
        executed_by: actorId,
        executed_at: new Date().toISOString(),
        rail_details: mergedRailDetails,
        updated_at: new Date().toISOString(),
    };
    if (isOneClick) {
        updatePayload.refund_rail = 'WALLET';
        updatePayload.approved_by = actorId;
    }

    const { data: updated, error: updErr } = await admin
        .from('refunds')
        .update(updatePayload)
        .eq('id', refund.id)
        .eq('status', expectedStatus)
        .select('id');
    if (updErr) {
        return { ok: false, error: `Refund UPDATE failed: ${updErr.message}` };
    }
    if (!updated || (updated as unknown[]).length === 0) {
        // Race: someone changed the status mid-flight. For WALLET, the ledger
        // INSERT already landed — log loudly. Manual reconciliation needed.
        if (finalRail === 'WALLET') {
            console.error(
                `[executeRefund] CRITICAL: wallet_ledger REFUND_CREDIT inserted but ` +
                    `refunds UPDATE race-guard tripped for refund ${refund.id}. ` +
                    `Manual reconciliation required.`,
            );
        }
        return {
            ok: false,
            error: `Refund ${refund.id} status changed concurrently; refresh and retry`,
        };
    }

    // 5. Notify owner (fail-soft)
    try {
        const invoiceRef = refund.transaction?.invoice_ref ?? null;
        await notifyOwner(admin, {
            shipownerId: refund.shipowner_id,
            kind: 'REFUND_ISSUED',
            params: {
                invoice_ref: invoiceRef ?? '—',
                amount_usd: refund.amount_usd_minor / 100,
                refund_rail: finalRail,
                executed_at: new Date().toISOString(),
            },
            deepLink: invoiceRef
                ? `/owner/invoices?ref=${encodeURIComponent(invoiceRef)}`
                : '/owner/invoices',
        });
    } catch (notifyErr) {
        console.error(`[executeRefund] notifyOwner failed for refund ${refund.id}:`, notifyErr);
    }

    // 6. Audit log
    const auditDetails: Record<string, unknown> = {
        event: 'REFUND_EXECUTED',
        rail: finalRail,
    };
    if (mergedRailDetails.stripe_refund_id) {
        auditDetails.stripe_refund_id = mergedRailDetails.stripe_refund_id;
    }
    await admin.from('audit_logs').insert({
        user_id: actorId,
        user_full_name: actorName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Refund',
        entity_id: refund.id,
        details_json: auditDetails,
    });

    return { ok: true, refundId: refund.id, rail: finalRail };
}
