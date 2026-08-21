'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { resolveInvoiceRecipients } from '@/services/invoiceIssuanceService';
import { fetchJurisdictionBillingCc } from '@/lib/jurisdictionName';
import { sendProformaReminderEmail } from '@/services/emailService';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

// Statuts pour lesquels une créance reste ouverte. Contrairement à
// escalateCollection, il n'y a pas de rampe à respecter ici : le palier
// MANUAL est un geste humain hors procédure, envoyable à tout moment sur une
// facture ouverte, sans consommer ni faire avancer J3…J45.
const REMINDABLE_STATUSES = ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'];

const inputSchema = z.object({
    transactionId: z.string().uuid(),
});

export async function sendManualReminder(
    raw: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    const { transactionId } = parsed.data;

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
            status, document_type, mode, created_at,
            shipowner:shipowners (name, official_email, billing_cc_emails),
            agent:profiles!transactions_agent_profile_id_fkey (email)
        `)
        .eq('id', transactionId)
        .single();
    if (txnErr || !txn) return { ok: false, reason: `transaction not found: ${txnErr?.message ?? 'nil'}` };

    const t = txn as unknown as {
        jurisdiction_id: string | null; invoice_ref: string | null; tax_amount_usd: number;
        shipowner_id: string | null; invoice_pdf_url: string | null;
        status: string; document_type: string; mode: string; created_at: string;
        shipowner: { name: string; official_email: string | null; billing_cc_emails: string[] | null } | { name: string; official_email: string | null; billing_cc_emails: string[] | null }[] | null;
        agent: { email: string | null } | { email: string | null }[] | null;
    };
    const jurisdictionId = t.jurisdiction_id;

    // 3. Isolation explicite.
    if (profile.role !== 'SUPERADMIN') {
        const staffJur = await getServerJurisdictionId();
        if (jurisdictionId !== staffJur) return { ok: false, reason: 'forbidden' };
    }

    // 4. Éligibilité — créance encore ouverte, pro-forma maritime. Pas de
    // contrôle de rampe : voir REMINDABLE_STATUSES ci-dessus.
    if (!REMINDABLE_STATUSES.includes(t.status)) {
        return { ok: false, reason: `status ${t.status} is not reminder-eligible` };
    }
    if (t.document_type !== 'PROFORMA') return { ok: false, reason: 'not a pro-forma document' };
    if (t.mode !== 'MARITIME') return { ok: false, reason: 'not a maritime transaction' };

    // 5. PDF optionnel — un rappel de courtoisie n'est pas une notice légale :
    // absence d'URL stockée ou échec de téléchargement n'empêchent pas
    // l'envoi, contrairement à escalateCollection où le PDF est requis.
    let pdfBuffer: Uint8Array | undefined;
    if (t.invoice_pdf_url) {
        const { data: pdfBlob } = await platform.storage.from('documents').download(t.invoice_pdf_url);
        if (pdfBlob) pdfBuffer = new Uint8Array(await pdfBlob.arrayBuffer());
    }

    // 6. Destinataires (cascade + CC facturation de la juridiction). Pas de CC
    // huissier ici : ce n'est pas une escalade légale.
    const owner = Array.isArray(t.shipowner) ? t.shipowner[0] : t.shipowner;
    const agent = Array.isArray(t.agent) ? t.agent[0] : t.agent;
    const billingCc = await fetchJurisdictionBillingCc(platform, jurisdictionId);
    const recipients = resolveInvoiceRecipients({
        shipownerBillingEmail: owner?.official_email ?? null,
        agentEmail: agent?.email ?? null,
        vesselOwnerEmail: null,
        ownerCcEmails: owner?.billing_cc_emails ?? [],
        jurisdictionCcEmails: billingCc,
        platformCcEmail: process.env.PLATFORM_BILLING_CC ?? null,
    });
    if (!recipients) return { ok: false, reason: 'no reachable recipient' };

    // 7. Envoi (échec = abandon, pas d'insert). Pas de `tier` : la fonction
    // retombe sur son ton courtois générique — le registre voulu pour un
    // geste humain hors procédure.
    const invoiceRef = t.invoice_ref ?? transactionId;
    const ageDays = Math.max(0, Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86_400_000));
    const emailResult = await sendProformaReminderEmail({
        to: recipients.to, cc: recipients.cc, recipientName: owner?.name ?? 'Registered Owner',
        invoiceRef, amountUsd: Number(t.tax_amount_usd), ageDays, pdfBuffer,
    });
    if (!emailResult.success) return { ok: false, reason: `email failed: ${emailResult.error ?? 'unknown'}` };

    // 8. Audit — geste tracé mais informatif : aucune procédure n'est engagée.
    await platform.from('audit_logs').insert({
        user_id: auth.user.id, user_full_name: profile.full_name ?? auth.user.email ?? 'Staff',
        action: 'TRANSACTION_UPDATED', severity: 'INFO',
        entity_type: 'Transaction', entity_id: transactionId, jurisdiction_id: jurisdictionId,
        details_json: { event: 'MANUAL_REMINDER_SENT', recipient: recipients.to, cc: recipients.cc },
    });

    // 9. Registre. Aucune contrainte d'unicité ne porte sur MANUAL (mig 126 —
    // index partiel WHERE tier <> 'MANUAL') : plusieurs relances manuelles
    // sur la même facture s'accumulent normalement, sans jamais heurter de
    // conflit 23505.
    const { error: insErr } = await platform.from('collection_reminders').insert({
        transaction_id: transactionId, tier: 'MANUAL', sent_at: new Date().toISOString(),
        sent_email: recipients.to, cc_emails: recipients.cc,
        template_used: 'manual_reminder', escalated_bailiff: false, debtor_response_type: 'SILENT',
    });
    if (insErr) return { ok: false, reason: `reminder sent but ledger write failed: ${insErr.message}` };

    revalidatePath('/admin/collections');
    return { ok: true };
}
