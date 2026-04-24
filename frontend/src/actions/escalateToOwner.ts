'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';
import { upsertShipownerEmail } from '@/services/shipownerService';
import { sendOwnerCascadeEmail } from '@/services/ownerCascadeEmailService';

const inputSchema = z.object({
    transactionId: z.string().uuid(),
    ownerEmail: z.string().email(),
    ownerEmailIsNew: z.boolean().optional(),
    locale: z.enum(['en', 'fr']).default('en'),
});

export async function escalateToOwner(
    raw: unknown,
): Promise<
    | { ok: true; resendId: string }
    | { ok: false; reason: string }
> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const { transactionId, ownerEmail, ownerEmailIsNew, locale } = parsed.data;

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return { ok: false, reason: 'service role not configured' };
    }
    const admin = createServiceRole(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
    });

    // Load transaction + related. FK alias disambiguation required because
    // arrival_alerts has 3 FKs into transactions.
    const { data: txn, error: txnErr } = await admin
        .from('transactions')
        .select(`
            id, ref, tax_amount_usd, shipowner_id, agent_profile_id, arrival_alert_id,
            invoice_pdf_url,
            vessel:vessels (name, imo_number),
            alert:arrival_alerts!transactions_arrival_alert_id_fkey (arrived_at),
            agent:profiles!transactions_agent_profile_id_fkey (full_name, email),
            shipowner:shipowners (name)
        `)
        .eq('id', transactionId)
        .single();
    if (txnErr || !txn) {
        return { ok: false, reason: `transaction not found: ${txnErr?.message ?? 'nil'}` };
    }

    if (ownerEmailIsNew && txn.shipowner_id) {
        await upsertShipownerEmail(admin, txn.shipowner_id, ownerEmail, 'PORT_OFFICER');
    }

    if (!txn.invoice_pdf_url) {
        return { ok: false, reason: 'transaction has no stored PDF — regenerate first' };
    }
    const { data: pdfBlob, error: dlErr } = await admin.storage
        .from('documents')
        .download(txn.invoice_pdf_url);
    if (dlErr || !pdfBlob) {
        return { ok: false, reason: `PDF download: ${dlErr?.message ?? 'nil'}` };
    }
    const pdfBuffer = new Uint8Array(await pdfBlob.arrayBuffer());

    const vessel = Array.isArray(txn.vessel) ? txn.vessel[0] : txn.vessel;
    const alert = Array.isArray(txn.alert) ? txn.alert[0] : txn.alert;
    const agent = Array.isArray(txn.agent) ? txn.agent[0] : txn.agent;
    const owner = Array.isArray(txn.shipowner) ? txn.shipowner[0] : txn.shipowner;

    const emailResult = await sendOwnerCascadeEmail({
        toEmail: ownerEmail,
        ownerName: owner?.name ?? 'Registered Owner',
        vesselName: vessel?.name ?? 'Unknown',
        vesselImo: vessel?.imo_number ?? '',
        invoiceRef: txn.ref ?? transactionId,
        amountUsd: Number(txn.tax_amount_usd),
        arrivalDate: alert?.arrived_at ?? new Date().toISOString(),
        agentName: agent?.full_name ?? agent?.email ?? '',
        agentEmail: agent?.email ?? '',
        pdfBuffer,
        locale,
    });

    if (!emailResult.ok) return emailResult;

    await admin
        .from('transactions')
        .update({
            escalated_to_owner_at: new Date().toISOString(),
            escalated_to_owner_email: ownerEmail,
            escalated_by: auth.user.id,
        })
        .eq('id', transactionId);

    return { ok: true, resendId: emailResult.resendId };
}
