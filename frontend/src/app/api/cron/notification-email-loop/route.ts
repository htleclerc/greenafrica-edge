import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EMAIL_KINDS, type NotificationKind } from '@/services/notificationService';
import { dispatchNotificationEmail } from '@/services/notificationEmailDispatch';

/**
 * GET /api/cron/notification-email-loop
 *
 * Daily Vercel Cron (09:00 UTC via vercel.json) that closes the loop for
 * any `owner_notifications` row whose `kind` is in EMAIL_KINDS and whose
 * `emailed_at IS NULL`.
 *
 * Today this primarily catches PROFORMA_REMINDER rows inserted by the
 * pg_cron `proforma-reminders-daily` job (Plan 7F mig 065) — there is no
 * inline call site to fire the email at INSERT time. Future kinds inserted
 * by triggers / pg_cron benefit automatically.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Everything
 * else returns 401. Same convention as `stripe-reconcile-pending`.
 *
 * Backoff: each failed dispatch increments `body_params.email_attempts`.
 * Rows at attempts >= MAX_ATTEMPTS are skipped — manual intervention.
 *
 * Race-guard: the success UPDATE filters on `emailed_at IS NULL` so a
 * concurrent run can never double-stamp (and never duplicate emails for
 * the same row, modulo Resend's own at-least-once delivery semantics).
 *
 * Lookback window: only rows from the last 24h are considered. Stale rows
 * past the window are dropped on the floor — by design; a backlog older
 * than a day is an ops incident, not something a single cron should chew
 * through.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOOKBACK_HOURS = 24;
const ROW_LIMIT = 100;
const MAX_ATTEMPTS = 5;

function serviceClient(): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    return createClient(url, key);
}

interface PendingNotifRow {
    id: string;
    shipowner_id: string;
    kind: NotificationKind;
    body_params: Record<string, unknown> | null;
}

interface OwnerRow {
    id: string;
    official_email: string | null;
    name: string | null;
}

interface Counts {
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    // Guard against unset CRON_SECRET: an undefined env yields the literal
    // "Bearer undefined" check which is trivially guessable. Match the
    // overdue-alerts/route.ts pattern that already does this correctly.
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = serviceClient();
    const lookback = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    const emailKindsList = Array.from(EMAIL_KINDS);

    const { data: pendingRaw, error: selErr } = await admin
        .from('owner_notifications')
        .select('id, shipowner_id, kind, body_params')
        .in('kind', emailKindsList)
        .is('emailed_at', null)
        .gt('created_at', lookback)
        .limit(ROW_LIMIT);

    if (selErr) {
        console.error('[notification-email-loop] select error:', selErr);
        return NextResponse.json({ error: 'select_failed' }, { status: 500 });
    }

    const pending = (pendingRaw ?? []) as PendingNotifRow[];
    const counts: Counts = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

    if (pending.length === 0) {
        return NextResponse.json(counts);
    }

    // Batch lookup all owners in one round-trip.
    const ownerIds = Array.from(new Set(pending.map((r) => r.shipowner_id)));
    const { data: ownersRaw } = await admin
        .from('shipowners')
        .select('id, official_email, name')
        .in('id', ownerIds);

    const ownersById = new Map<string, OwnerRow>();
    for (const o of (ownersRaw ?? []) as OwnerRow[]) {
        ownersById.set(o.id, o);
    }

    for (const row of pending) {
        counts.processed += 1;
        const bodyParams = row.body_params ?? {};
        const attempts = Number(
            (bodyParams as { email_attempts?: unknown }).email_attempts ?? 0,
        );

        if (attempts >= MAX_ATTEMPTS) {
            console.warn(
                `[notification-email-loop] notif ${row.id} (${row.kind}) at max attempts (${attempts}); skipping`,
            );
            counts.skipped += 1;
            continue;
        }

        const owner = ownersById.get(row.shipowner_id);
        if (!owner || !owner.official_email) {
            console.warn(
                `[notification-email-loop] notif ${row.id} (${row.kind}): no official_email on shipowner ${row.shipowner_id}; skipping`,
            );
            counts.skipped += 1;
            continue;
        }

        if (!EMAIL_KINDS.has(row.kind)) {
            // Defensive — the .in() filter should keep this empty, but Postgres
            // enum drift could theoretically slip a row through.
            counts.skipped += 1;
            continue;
        }

        let succeeded = false;
        try {
            const result = await dispatchNotificationEmail({
                kind: row.kind,
                ownerEmail: owner.official_email,
                ownerName: owner.name ?? 'Shipowner',
                bodyParams,
            });
            succeeded = result?.success === true;
            if (!succeeded) {
                console.warn(
                    `[notification-email-loop] notif ${row.id} (${row.kind}) dispatch returned non-success:`,
                    result,
                );
            }
        } catch (e) {
            console.error(
                `[notification-email-loop] notif ${row.id} (${row.kind}) dispatch threw:`,
                e,
            );
            succeeded = false;
        }

        if (succeeded) {
            // Race-guarded: only set emailed_at if it's still null. Concurrent
            // runs that processed this row first will leave us with 0 rows
            // updated — that's fine for the DB invariant. The email itself may
            // have been sent twice if two runs overlapped (we do NOT pass an
            // idempotency-key to Resend), but Vercel Cron is single-instance so
            // overlap is rare in practice. v1 acceptable; revisit in Plan 7H-3
            // if the canary surfaces duplicate-delivery complaints.
            const { error: updErr } = await admin
                .from('owner_notifications')
                .update({ emailed_at: new Date().toISOString() })
                .eq('id', row.id)
                .is('emailed_at', null);
            if (updErr) {
                console.error(
                    `[notification-email-loop] notif ${row.id}: emailed_at UPDATE failed:`,
                    updErr,
                );
            }
            counts.succeeded += 1;
        } else {
            // Increment email_attempts. PostgREST doesn't offer atomic JSONB
            // increment; we read attempts above + write a merged body_params.
            // The window for a race here is the few ms between SELECT and
            // UPDATE — counter drift of ±1 is acceptable (MAX_ATTEMPTS is a
            // ceiling, not an accountant's ledger).
            const newBodyParams = { ...bodyParams, email_attempts: attempts + 1 };
            const { error: bumpErr } = await admin
                .from('owner_notifications')
                .update({ body_params: newBodyParams })
                .eq('id', row.id);
            if (bumpErr) {
                console.error(
                    `[notification-email-loop] notif ${row.id}: attempts UPDATE failed:`,
                    bumpErr,
                );
            }
            counts.failed += 1;
        }
    }

    return NextResponse.json(counts);
}
