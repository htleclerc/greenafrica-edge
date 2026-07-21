import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOverdueAlertEmail } from '@/services/emailService';
import { buildVerifyUrl } from '@/services/invoiceService';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * GET /api/cron/overdue-alerts
 *
 * Cron job — finds OVERDUE transactions and emails their shipping agents.
 * Designed to run daily via Vercel Cron or any external cron service.
 *
 * Auth: protected by `CRON_SECRET` header (Bearer token).
 *
 * Vercel cron config (vercel.json):
 *   {
 *     "crons": [
 *       { "path": "/api/cron/overdue-alerts", "schedule": "0 9 * * *" }
 *     ]
 *   }
 *
 * Vercel automatically adds `Authorization: Bearer <CRON_SECRET>` to cron requests.
 *
 * Returns: JSON summary of how many alerts were sent.
 */
export async function GET(request: NextRequest) {
    // ── Auth: only Vercel Cron or trusted callers ──
    const authHeader = request.headers.get('Authorization');
    const expected = process.env.CRON_SECRET;
    if (!expected || authHeader !== `Bearer ${expected}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Daily cron iterating OVERDUE transactions across ALL jurisdictions —
    // legitimately cross-tenant, so the UNSCOPED platform client is correct.
    let admin: SupabaseClient;
    try {
        admin = createPlatformClient();
    } catch {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // ── Find all OVERDUE transactions ──
    const { data: overdueTxs, error: txErr } = await admin
        .from('transactions')
        .select('id, vessel_id, vessel_name, vessel_imo, tax_amount_usd, created_at, jurisdiction_id')
        .eq('status', 'OVERDUE');

    if (txErr) {
        return NextResponse.json({ error: txErr.message }, { status: 500 });
    }

    if (!overdueTxs || overdueTxs.length === 0) {
        return NextResponse.json({ success: true, sent: 0, skipped: 0, message: 'No overdue transactions' });
    }

    let sent = 0;
    let skipped = 0;
    const failures: Array<{ ref: string; reason: string }> = [];

    for (const tx of overdueTxs) {
        // Look up the vessel owner profile
        const { data: vessel } = await admin
            .from('vessels')
            .select('owner_id')
            .eq('id', tx.vessel_id)
            .single();

        if (!vessel?.owner_id) {
            skipped++;
            continue;
        }

        const { data: ownerProfile } = await admin
            .from('profiles')
            .select('email, full_name')
            .eq('id', vessel.owner_id)
            .single();

        if (!ownerProfile?.email) {
            skipped++;
            continue;
        }

        // Compute days overdue from created_at + 30-day grace period
        const createdAt = new Date(tx.created_at);
        const dueDate = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
        const daysOverdue = Math.max(1, Math.floor((Date.now() - dueDate.getTime()) / (24 * 60 * 60 * 1000)));

        const invoiceRef = `INV-${createdAt.getFullYear()}-${tx.id.split('-')[1].toUpperCase()}`;
        const verifyUrl = buildVerifyUrl(invoiceRef);

        const result = await sendOverdueAlertEmail({
            to: ownerProfile.email,
            recipientName: ownerProfile.full_name || 'Shipping Agent',
            vesselName: tx.vessel_name,
            invoiceRef,
            amountUsd: Number(tx.tax_amount_usd),
            daysOverdue,
            verifyUrl,
        });

        if (result.success) {
            sent++;
            // Audit log
            await admin.from('audit_logs').insert({
                user_id: '00000000-0000-0000-0000-000000000000',
                user_full_name: 'System Cron',
                action: 'TRANSACTION_UPDATED',
                severity: 'WARNING',
                entity_type: 'Transaction',
                entity_id: tx.id,
                jurisdiction_id: (tx as { jurisdiction_id?: string | null }).jurisdiction_id ?? null,
                details_json: {
                    vesselName: tx.vessel_name,
                    invoiceRef,
                    daysOverdue,
                    emailSentTo: ownerProfile.email,
                },
            });
        } else {
            failures.push({ ref: invoiceRef, reason: result.error || 'unknown' });
        }
    }

    return NextResponse.json({
        success: true,
        total: overdueTxs.length,
        sent,
        skipped,
        failures,
    });
}
