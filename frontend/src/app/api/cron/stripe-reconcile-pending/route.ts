import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { retrievePaymentIntent } from '@/services/stripeService';
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
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    return createClient(url, key);
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
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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
            const pi = await retrievePaymentIntent(piId);

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
                    .eq('id', row.id);
                if (updErr) throw updErr;

                if (row.transaction_id) {
                    await admin.rpc('recompute_transaction_status', {
                        p_transaction_id: row.transaction_id,
                    });
                }

                console.log(
                    `[stripe-reconcile] payment ${row.id} (PI ${piId}) → CONFIRMED`,
                );
                results.push({ id: row.id, outcome: 'CONFIRMED' });
            } else if (pi.status === 'canceled') {
                const { error: updErr } = await admin
                    .from('payments')
                    .update({ status: 'CANCELLED' })
                    .eq('id', row.id);
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
                    .eq('id', row.id);
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
