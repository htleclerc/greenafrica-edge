import { NextRequest, NextResponse } from 'next/server';
import { GET as runPaymentReconcile } from '../stripe-reconcile-pending/route';
import { GET as runRefundReconcile } from '../stripe-refund-reconcile-pending/route';

/**
 * GET /api/cron/stripe-reconcile-all
 *
 * Vercel Hobby plan rejects any cron expression that runs more than
 * once per day. Plan 7D's stripe-reconcile-pending (payments) and
 * Plan 7H-1's stripe-refund-reconcile-pending (refunds) each shipped
 * with `*\/15 * * * *` — both fail Hobby deploy. This route chains
 * both reconcilers behind a single daily slot (`0 9 * * *`), which
 * deploys cleanly on Hobby.
 *
 * Cadence trade-off: the original 15-min cron was a near-real-time
 * safety net for Stripe webhook misses. Going daily means a missed
 * webhook leaves a `PROCESSING` payment / `APPROVED` refund stuck for
 * up to ~24h before reconciliation. Acceptable v1 (webhooks are
 * delivered reliably in normal operation; the cron is belt-and-braces).
 * Upgrade to Vercel Pro + restore `*\/15 * * * *` here if reactivity
 * becomes a constraint.
 *
 * Both downstream handlers keep their own auth gate, route export,
 * and test surface — they remain callable individually for manual
 * ops/debug (just not scheduled). This route is the only one wired
 * in vercel.json for the Stripe reconcile cadence.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`. Identical contract to
 * the downstream routes — Vercel sends one auth header per cron
 * request and we forward the same Request object straight through.
 *
 * Failure mode: payments reconcile and refunds reconcile run
 * sequentially, both fail-soft. If payments throws, refunds still
 * runs. The response includes whichever sub-results materialised; a
 * thrown handler surfaces as a sub-error string so ops can see
 * partial progress.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const payments = await safeRun(() => runPaymentReconcile(req));
    const refunds = await safeRun(() => runRefundReconcile(req));

    return NextResponse.json({ payments, refunds });
}

async function safeRun(
    fn: () => Promise<NextResponse>,
): Promise<{ status: number; body: unknown } | { error: string }> {
    try {
        const res = await fn();
        const body = await res.json().catch(() => null);
        return { status: res.status, body };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}
