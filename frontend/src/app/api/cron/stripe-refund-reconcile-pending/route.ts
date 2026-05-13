import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { retrieveRefund } from '@/services/stripeService';
import { resolveSystemActor } from '@/lib/system-actor';
import { notifyOwner } from '@/services/notificationService';

/**
 * GET /api/cron/stripe-refund-reconcile-pending
 *
 * Plan 7H-1 — second-line safety net for Plan 7G's `executeRefund` STRIPE
 * branch. Symmetric to Plan 7D's `stripe-reconcile-pending` (payments).
 *
 * Polls `refunds WHERE refund_rail='STRIPE' AND status='APPROVED' AND
 *   updated_at < NOW() - INTERVAL '15 minutes'`.
 *
 * Per row, calls `stripe.refunds.retrieve()` and:
 *   - succeeded            → race-guarded UPDATE → EXECUTED + notify owner
 *                            (REFUND_ISSUED, fail-soft) + audit log.
 *   - failed / canceled    → race-guarded UPDATE → REJECTED + audit log.
 *                            No owner notification (rejection convention
 *                            per Plan 7G — we don't owe a refund we never
 *                            actually executed).
 *   - pending / unknown    → skip (still in flight).
 *
 * On Stripe API throw we increment `rail_details.reconcile_attempts` and
 * cap at MAX_RECONCILE_ATTEMPTS (10). Rows past the cap are skipped — ops
 * intervention required.
 *
 * Missing `rail_details.stripe_refund_id` ⇒ skip (the action threw before
 * persisting; the row is effectively orphaned and needs human review).
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Same
 * convention as the sibling `stripe-reconcile-pending` cron.
 *
 * System actor: the EXECUTED flip needs `executed_by NOT NULL` per Plan
 * 7G's `refunds_executed_audit` CHECK constraint. We borrow the same
 * stopgap as Plan 7C-1 mig 059: oldest active SUPERADMIN/FINANCE_ADMIN.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STALE_MINUTES = 15;
const ROW_LIMIT = 50;
const MAX_RECONCILE_ATTEMPTS = 10;

function serviceClient(): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    return createClient(url, key);
}

interface RefundRow {
    id: string;
    transaction_id: string;
    shipowner_id: string;
    amount_usd_minor: number;
    refund_rail: string;
    status: string;
    rail_details: Record<string, unknown> | null;
}

interface Counts {
    checked: number;
    reconciled: number;
    skipped: number;
    errored: number;
}

async function writeAuditLog(
    admin: SupabaseClient,
    params: {
        actorId: string;
        actorName: string;
        refundId: string;
        event: 'REFUND_RECONCILED_BY_CRON';
        details: Record<string, unknown>;
    },
): Promise<void> {
    const { error } = await admin.from('audit_logs').insert({
        user_id: params.actorId,
        user_full_name: params.actorName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Refund',
        entity_id: params.refundId,
        details_json: { event: params.event, ...params.details },
    });
    if (error) {
        console.error(
            `[stripe-refund-reconcile] audit log failed for refund ${params.refundId}:`,
            error,
        );
    }
}

async function bumpReconcileAttempts(
    admin: SupabaseClient,
    row: RefundRow,
): Promise<void> {
    const railDetails = row.rail_details ?? {};
    const attempts = Number(
        (railDetails as { reconcile_attempts?: unknown }).reconcile_attempts ?? 0,
    );
    const newRailDetails = { ...railDetails, reconcile_attempts: attempts + 1 };
    const { error } = await admin
        .from('refunds')
        .update({ rail_details: newRailDetails })
        .eq('id', row.id)
        .eq('status', 'APPROVED');
    if (error) {
        console.error(
            `[stripe-refund-reconcile] failed to bump attempts on refund ${row.id}:`,
            error,
        );
    }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    // Guard against unset CRON_SECRET — see overdue-alerts/route.ts precedent.
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = serviceClient();
    const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();

    const { data: pendingRaw, error: selErr } = await admin
        .from('refunds')
        .select('id, transaction_id, shipowner_id, amount_usd_minor, refund_rail, status, rail_details')
        .eq('refund_rail', 'STRIPE')
        .eq('status', 'APPROVED')
        .lt('updated_at', cutoff)
        .limit(ROW_LIMIT);

    if (selErr) {
        console.error('[stripe-refund-reconcile] select error:', selErr);
        return NextResponse.json({ error: 'select_failed' }, { status: 500 });
    }

    const pending = (pendingRaw ?? []) as RefundRow[];
    const counts: Counts = { checked: 0, reconciled: 0, skipped: 0, errored: 0 };

    if (pending.length === 0) {
        return NextResponse.json(counts);
    }

    // Resolve a single system actor up-front + cache its display name.
    let systemActorId: string | null = null;
    let systemActorName = 'System (Stripe Refund Reconcile)';

    for (const row of pending) {
        counts.checked += 1;
        const railDetails = row.rail_details ?? {};
        const stripeRefundId = (railDetails as { stripe_refund_id?: unknown })
            .stripe_refund_id;
        const reconcileAttempts = Number(
            (railDetails as { reconcile_attempts?: unknown }).reconcile_attempts ?? 0,
        );

        if (reconcileAttempts >= MAX_RECONCILE_ATTEMPTS) {
            console.warn(
                `[stripe-refund-reconcile] refund ${row.id} at max attempts (${reconcileAttempts}); skipping`,
            );
            counts.skipped += 1;
            continue;
        }

        if (typeof stripeRefundId !== 'string' || stripeRefundId.length === 0) {
            console.warn(
                `[stripe-refund-reconcile] refund ${row.id}: rail_details.stripe_refund_id missing; skipping (manual review required)`,
            );
            counts.skipped += 1;
            continue;
        }

        let stripeResult: { id: string; status: string; failure_reason: string | null };
        try {
            stripeResult = await retrieveRefund(stripeRefundId);
        } catch (e) {
            console.error(
                `[stripe-refund-reconcile] retrieveRefund(${stripeRefundId}) threw:`,
                e,
            );
            await bumpReconcileAttempts(admin, row);
            counts.errored += 1;
            continue;
        }

        if (stripeResult.status === 'succeeded') {
            // Resolve actor lazily — only when we actually need it.
            if (!systemActorId) {
                systemActorId = await resolveSystemActor(admin);
                if (systemActorId) {
                    const { data: profile } = await admin
                        .from('profiles')
                        .select('full_name')
                        .eq('id', systemActorId)
                        .maybeSingle();
                    if (profile && (profile as { full_name?: string }).full_name) {
                        systemActorName = (profile as { full_name: string }).full_name;
                    }
                }
            }
            if (!systemActorId) {
                console.error(
                    `[stripe-refund-reconcile] no active system actor for refund ${row.id}; cannot satisfy refunds_executed_audit`,
                );
                counts.errored += 1;
                continue;
            }

            const executedAt = new Date().toISOString();
            const newRailDetails = {
                ...(row.rail_details ?? {}),
                reconciled_by_cron: true,
                reconciled_at: executedAt,
            };

            const { error: updErr, count } = await admin
                .from('refunds')
                .update({
                    status: 'EXECUTED',
                    executed_by: systemActorId,
                    executed_at: executedAt,
                    rail_details: newRailDetails,
                })
                .eq('id', row.id)
                .eq('status', 'APPROVED');

            if (updErr) {
                console.error(
                    `[stripe-refund-reconcile] EXECUTED UPDATE failed for refund ${row.id}:`,
                    updErr,
                );
                counts.errored += 1;
                continue;
            }

            // Race-guard: another path (webhook, manual admin) won. Idempotent no-op.
            if (count === 0) {
                console.log(
                    `[stripe-refund-reconcile] refund ${row.id}: race lost — already non-APPROVED, no-op`,
                );
                counts.skipped += 1;
                continue;
            }

            // Owner notification — fail-soft per memory convention.
            try {
                await notifyOwner(admin, {
                    shipownerId: row.shipowner_id,
                    kind: 'REFUND_ISSUED',
                    params: {
                        refund_id: row.id,
                        transaction_id: row.transaction_id,
                        amount_usd: row.amount_usd_minor / 100,
                        reconciled_by: 'stripe_refund_reconcile_cron',
                    },
                });
            } catch (e) {
                console.error(
                    `[stripe-refund-reconcile] notifyOwner failed for refund ${row.id}:`,
                    e,
                );
            }

            await writeAuditLog(admin, {
                actorId: systemActorId,
                actorName: systemActorName,
                refundId: row.id,
                event: 'REFUND_RECONCILED_BY_CRON',
                details: {
                    new_status: 'EXECUTED',
                    stripe_refund_id: stripeRefundId,
                    executed_at: executedAt,
                },
            });

            counts.reconciled += 1;
            continue;
        }

        if (stripeResult.status === 'failed' || stripeResult.status === 'canceled') {
            const rejectionReason = `Stripe refund ${stripeResult.status}: ${
                stripeResult.failure_reason ?? 'no reason provided'
            }`;

            if (!systemActorId) {
                systemActorId = await resolveSystemActor(admin);
                if (systemActorId) {
                    const { data: profile } = await admin
                        .from('profiles')
                        .select('full_name')
                        .eq('id', systemActorId)
                        .maybeSingle();
                    if (profile && (profile as { full_name?: string }).full_name) {
                        systemActorName = (profile as { full_name: string }).full_name;
                    }
                }
            }

            const { error: updErr, count } = await admin
                .from('refunds')
                .update({
                    status: 'REJECTED',
                    rejection_reason: rejectionReason,
                })
                .eq('id', row.id)
                .eq('status', 'APPROVED');

            if (updErr) {
                console.error(
                    `[stripe-refund-reconcile] REJECTED UPDATE failed for refund ${row.id}:`,
                    updErr,
                );
                counts.errored += 1;
                continue;
            }

            if (count === 0) {
                counts.skipped += 1;
                continue;
            }

            if (systemActorId) {
                await writeAuditLog(admin, {
                    actorId: systemActorId,
                    actorName: systemActorName,
                    refundId: row.id,
                    event: 'REFUND_RECONCILED_BY_CRON',
                    details: {
                        new_status: 'REJECTED',
                        stripe_refund_id: stripeRefundId,
                        rejection_reason: rejectionReason,
                    },
                });
            }

            counts.reconciled += 1;
            continue;
        }

        // pending / requires_action / unknown — still in flight.
        console.log(
            `[stripe-refund-reconcile] refund ${row.id} stripe status=${stripeResult.status}; skipping`,
        );
        counts.skipped += 1;
    }

    return NextResponse.json(counts);
}
