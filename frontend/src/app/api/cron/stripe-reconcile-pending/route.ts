import { NextRequest, NextResponse } from 'next/server';
import { type SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { retrieveCheckoutSession, retrievePaymentIntent } from '@/services/stripeService';
import { resolveSystemActor } from '@/lib/system-actor';

/**
 * GET /api/cron/stripe-reconcile-pending
 *
 * Safety-net cron (every 15 min via vercel.json) that reconciles
 * `payments` rows on rail STRIPE stuck in PROCESSING — typically because
 * a webhook was missed/misdelivered.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. We
 * verify the header exactly; everything else returns 401.
 *
 * Reference externe : `initiatePayment` ecrit l'id de Checkout Session
 * (`cs_...`) tant que Stripe n'a pas cree le PaymentIntent (API 2026-04-22).
 * On relit alors la session pour recuperer le `pi_...` (et on reindexe la
 * ligne au passage) ; une session `expired` sans PI vaut CANCELLED.
 *
 * Decision rules per row (rail=STRIPE, status=PROCESSING, age > 10 min):
 *   - pi.status === 'succeeded' → CONFIRMED (no receipt/email — the
 *     webhook handler is canonical and should have fired; re-firing here
 *     risks duplicates).
 *   - pi.status === 'canceled'  → CANCELLED.
 *   - row age > 1 h              → CANCELLED + rejected_reason='Timeout…'.
 *   - otherwise                  → leave PROCESSING (still pending).
 *
 * Limit 100 rows/run to keep within the Vercel function timeout.
 *
 * System actor: same `payments_confirmed_audit` constraint as Task 6
 * webhook — we use the shared resolveSystemActor helper.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 60 * 60 * 1000;             // 1 h — give up + cancel
const RECONCILE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min — eligible to reconcile

function serviceClient(): SupabaseClient {
    // Platform-level cron (reconciles payments keyed by external Stripe id).
    return createPlatformClient();
}

interface PendingRow {
    id: string;
    external_reference: string | null;
    created_at: string;
    transaction_id: string | null;
    shipowner_id: string;
    amount_usd_minor: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    // Guard against unset CRON_SECRET — match the overdue-alerts/route.ts pattern.
    // Without this guard, an undefined env yields "Bearer undefined" check
    // which is trivially guessable (Plan 7H-1 final-review fix; carried back
    // to this Plan 7D route for consistency).
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = serviceClient();
    const cutoff = new Date(Date.now() - RECONCILE_THRESHOLD_MS).toISOString();
    const timeoutCutoffMs = Date.now() - TIMEOUT_MS;

    const { data: pending, error: selErr } = await admin
        .from('payments')
        .select('id, external_reference, created_at, transaction_id, shipowner_id, amount_usd_minor')
        .eq('rail', 'STRIPE')
        .eq('status', 'PROCESSING')
        .lt('created_at', cutoff)
        .limit(100);

    if (selErr) {
        console.error('[stripe-reconcile] select error:', selErr);
        return NextResponse.json({ error: 'select_failed' }, { status: 500 });
    }

    const rows = (pending ?? []) as PendingRow[];
    const results: { id: string; outcome: string }[] = [];

    for (const row of rows) {
        const piId = row.external_reference;
        if (!piId) {
            results.push({ id: row.id, outcome: 'SKIPPED_NO_PI' });
            continue;
        }

        try {
            // `cs_...` : le PaymentIntent n'existait pas a l'ouverture de la
            // session. On le resout via la session, et on reindexe la ligne.
            let resolvedPiId = piId;
            if (piId.startsWith('cs_')) {
                const session = await retrieveCheckoutSession(piId);
                const sessionPi = typeof session.payment_intent === 'string'
                    ? session.payment_intent
                    : session.payment_intent?.id ?? null;

                if (!sessionPi) {
                    // Pas de PI : la session est soit encore ouverte, soit
                    // expiree sans paiement.
                    if (session.status === 'expired'
                        || new Date(row.created_at).getTime() < timeoutCutoffMs) {
                        const { error: updErr } = await admin
                            .from('payments')
                            .update({
                                status: 'CANCELLED',
                                rejected_reason: 'Timeout: Stripe Checkout not completed within 1h',
                            })
                            .eq('id', row.id)
                            .eq('status', 'PROCESSING');
                        if (updErr) throw updErr;
                        results.push({ id: row.id, outcome: 'CANCELLED_TIMEOUT' });
                    } else {
                        results.push({ id: row.id, outcome: 'STILL_PENDING' });
                    }
                    continue;
                }

                resolvedPiId = sessionPi;
                const { error: refErr } = await admin
                    .from('payments')
                    .update({ external_reference: sessionPi })
                    .eq('id', row.id)
                    .eq('status', 'PROCESSING');
                if (refErr) throw refErr;
            }

            const pi = await retrievePaymentIntent(resolvedPiId);

            if (pi.status === 'succeeded') {
                const systemActorId = await resolveSystemActor(admin);
                if (!systemActorId) {
                    console.error(
                        `[stripe-reconcile] no active system actor for payment ${row.id}`,
                    );
                    results.push({ id: row.id, outcome: 'ERROR_NO_ACTOR' });
                    continue;
                }
                const { error: updErr } = await admin
                    .from('payments')
                    .update({
                        status: 'CONFIRMED',
                        confirmed_at: new Date().toISOString(),
                        confirmed_by: systemActorId,
                    })
                    .eq('id', row.id)
                    .eq('status', 'PROCESSING');
                if (updErr) throw updErr;

                if (row.transaction_id) {
                    const { error: rpcErr } = await admin.rpc('recompute_transaction_status', {
                        p_txn_id: row.transaction_id,
                    });
                    if (rpcErr) {
                        // Payments trigger recomputes too — log, don't fail the run.
                        console.error(
                            `[stripe-reconcile] recompute_transaction_status failed for tx ${row.transaction_id}: ${rpcErr.message}`,
                        );
                    }
                }

                console.log(
                    `[stripe-reconcile] payment ${row.id} (PI ${piId}) → CONFIRMED`,
                );
                results.push({ id: row.id, outcome: 'CONFIRMED' });
            } else if (pi.status === 'canceled') {
                const { error: updErr } = await admin
                    .from('payments')
                    .update({ status: 'CANCELLED' })
                    .eq('id', row.id)
                    .eq('status', 'PROCESSING');
                if (updErr) throw updErr;
                console.log(
                    `[stripe-reconcile] payment ${row.id} (PI ${piId}) → CANCELLED`,
                );
                results.push({ id: row.id, outcome: 'CANCELLED' });
            } else if (new Date(row.created_at).getTime() < timeoutCutoffMs) {
                const { error: updErr } = await admin
                    .from('payments')
                    .update({
                        status: 'CANCELLED',
                        rejected_reason: 'Timeout: Stripe Checkout not completed within 1h',
                    })
                    .eq('id', row.id)
                    .eq('status', 'PROCESSING');
                if (updErr) throw updErr;
                console.log(
                    `[stripe-reconcile] payment ${row.id} (PI ${piId}) → CANCELLED (timeout)`,
                );
                results.push({ id: row.id, outcome: 'CANCELLED_TIMEOUT' });
            } else {
                results.push({ id: row.id, outcome: 'STILL_PENDING' });
            }
        } catch (e) {
            console.error(
                `[stripe-reconcile] error for payment ${row.id} (PI ${piId}):`,
                e,
            );
            results.push({ id: row.id, outcome: 'ERROR' });
        }
    }

    return NextResponse.json({ reconciled: results.length, results });
}
