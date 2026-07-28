'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { resolveInvoiceRecipients } from '@/services/invoiceIssuanceService';
import {
    fetchJurisdictionBillingCc, fetchJurisdictionBailiffCc, fetchJurisdictionName,
} from '@/lib/jurisdictionName';
import { sendCollectionEscalationEmail } from '@/services/emailService';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

const inputSchema = z.object({
    transactionId: z.string().uuid(),
    tier: z.enum(['BAILIFF', 'JUDICIAL']),
});

export async function escalateCollection(
    raw: unknown,
): Promise<{ ok: true; tier: 'BAILIFF' | 'JUDICIAL' } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    const { transactionId, tier } = parsed.data;

    // 1. Auth + rôle staff + is_active.
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };
    const { data: profile } = await supabase.from('profiles').select('role, full_name, is_active').eq('id', auth.user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return { ok: false, reason: 'insufficient role' };
    if (profile.is_active === false) return { ok: false, reason: 'account inactive' };

    const platform = createPlatformClient();

    // 2. Charge la transaction (regardless of tenant).
    const { data: txn, error: txnErr } = await platform
        .from('transactions')
        .select(`
            id, jurisdiction_id, invoice_ref, tax_amount_usd, shipowner_id, agent_profile_id, invoice_pdf_url,
            vessel:vessels (name, imo_number),
            shipowner:shipowners (name, official_email),
            agent:profiles!transactions_agent_profile_id_fkey (email)
        `)
        .eq('id', transactionId)
        .single();
    if (txnErr || !txn) return { ok: false, reason: `transaction not found: ${txnErr?.message ?? 'nil'}` };

    const t = txn as unknown as {
        jurisdiction_id: string | null; invoice_ref: string | null; tax_amount_usd: number;
        shipowner_id: string | null; invoice_pdf_url: string | null;
        vessel: { name: string } | { name: string }[] | null;
        shipowner: { name: string; official_email: string | null } | { name: string; official_email: string | null }[] | null;
        agent: { email: string | null } | { email: string | null }[] | null;
    };
    const jurisdictionId = t.jurisdiction_id;

    // 3. Isolation explicite.
    if (profile.role !== 'SUPERADMIN') {
        const staffJur = await getServerJurisdictionId();
        if (jurisdictionId !== staffJur) return { ok: false, reason: 'forbidden' };
    }

    // 4. Rampe + anti-doublon (relances existantes).
    const { data: remRows } = await platform
        .from('collection_reminders').select('tier').eq('transaction_id', transactionId);
    const sentTiers = ((remRows ?? []) as { tier: string }[]).map((r) => r.tier);
    if (sentTiers.includes(tier)) return { ok: false, reason: `already escalated to ${tier}` };
    if (tier === 'BAILIFF' && !sentTiers.includes('J45')) {
        return { ok: false, reason: 'ramp: a J45 (pre-bailiff) reminder must be sent first' };
    }
    if (tier === 'JUDICIAL' && !sentTiers.includes('BAILIFF')) {
        return { ok: false, reason: 'ramp: a bailiff notice must be issued first' };
    }

    // 5. PDF requis + téléchargement.
    if (!t.invoice_pdf_url) return { ok: false, reason: 'no stored PDF — regenerate first' };
    const { data: pdfBlob, error: dlErr } = await platform.storage.from('documents').download(t.invoice_pdf_url);
    if (dlErr || !pdfBlob) return { ok: false, reason: `PDF download: ${dlErr?.message ?? 'nil'}` };
    const pdfBuffer = new Uint8Array(await pdfBlob.arrayBuffer());

    // 6. Destinataires (cascade + CC facturation + CC huissier).
    const vessel = Array.isArray(t.vessel) ? t.vessel[0] : t.vessel;
    const owner = Array.isArray(t.shipowner) ? t.shipowner[0] : t.shipowner;
    const agent = Array.isArray(t.agent) ? t.agent[0] : t.agent;
    const [billingCc, bailiffCc] = await Promise.all([
        fetchJurisdictionBillingCc(platform, jurisdictionId),
        fetchJurisdictionBailiffCc(platform, jurisdictionId),
    ]);
    const recipients = resolveInvoiceRecipients({
        shipownerBillingEmail: owner?.official_email ?? null,
        agentEmail: agent?.email ?? null,
        vesselOwnerEmail: null,
        jurisdictionCcEmails: [...billingCc, ...bailiffCc],
        platformCcEmail: process.env.PLATFORM_BILLING_CC ?? null,
    });
    if (!recipients) return { ok: false, reason: 'no reachable recipient' };

    // 7. Envoi de la notice (échec = abandon, pas d'insert).
    const jurisdictionName = await fetchJurisdictionName(platform, jurisdictionId);
    const invoiceRef = t.invoice_ref ?? transactionId;
    const emailResult = await sendCollectionEscalationEmail({
        tier, to: recipients.to, cc: recipients.cc, recipientName: owner?.name ?? 'Registered Owner',
        invoiceRef, amountUsd: Number(t.tax_amount_usd), jurisdictionName, vesselName: vessel?.name, pdfBuffer,
    });
    if (!emailResult.success) return { ok: false, reason: `email failed: ${emailResult.error ?? 'unknown'}` };

    // 8. Audit — la notice a été dispatchée, cet événement légalement significatif
    // doit TOUJOURS être tracé, même si l'insert du registre échoue ensuite.
    await platform.from('audit_logs').insert({
        user_id: auth.user.id, user_full_name: profile.full_name ?? auth.user.email ?? 'Staff',
        action: 'TRANSACTION_UPDATED', severity: 'WARNING',
        entity_type: 'Transaction', entity_id: transactionId, jurisdiction_id: jurisdictionId,
        details_json: { event: `ESCALATED_${tier}`, tier, recipient: recipients.to, cc: recipients.cc },
    });

    // 9. Registre.
    const { error: insErr } = await platform.from('collection_reminders').insert({
        transaction_id: transactionId, tier, sent_at: new Date().toISOString(),
        sent_email: recipients.to, cc_emails: recipients.cc,
        template_used: `${tier.toLowerCase()}_notice`, escalated_bailiff: true, debtor_response_type: 'SILENT',
    });
    if (insErr) {
        // 23505 = course avec un autre escalade même tier → déjà tracé (attendu).
        // Toute autre erreur : la notice est partie mais le registre n'a pas pu
        // l'enregistrer — ne pas la maquiller en doublon.
        if (insErr.code === '23505') return { ok: false, reason: `already escalated to ${tier}` };
        return { ok: false, reason: `notice sent but ledger write failed: ${insErr.message}` };
    }

    revalidatePath('/admin/collections');
    return { ok: true, tier };
}
