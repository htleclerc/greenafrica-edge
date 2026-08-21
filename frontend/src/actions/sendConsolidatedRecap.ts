'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { resolveInvoiceRecipients } from '@/services/invoiceIssuanceService';
import { fetchJurisdictionBillingCc, fetchJurisdictionName } from '@/lib/jurisdictionName';
import { sendCollectionRecapEmail } from '@/services/emailService';
import { composeOwnerStatement, currentMonthBounds } from '@/services/statementService';
import { generateStatementPdf } from '@/services/invoiceService';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

const inputSchema = z.object({
    shipownerId: z.string().uuid(),
});

/**
 * Envoie à la demande, à un armateur, le récapitulatif consolidé de TOUTES ses
 * pro-formas ouvertes — un geste ponctuel de recouvrement, PAS le relevé
 * mensuel officiel (chantier C / cron monthly-statements).
 *
 * Réutilise le moteur du relevé (composeOwnerStatement + generateStatementPdf)
 * pour composer le PDF, mais n'écrit RIEN dans owner_statements et ne dépose
 * RIEN dans le bucket statements/ : owner_statements porte une contrainte
 * UNIQUE (shipowner_id, period_month) et le PDF mensuel vit sous
 * statements/<id>/<YYYY-MM>.pdf — un envoi manuel dans le mois écraserait le
 * relevé mensuel officiel que l'armateur consulte dans son portail. Le PDF ici
 * est généré et joint en mémoire, jamais persisté.
 *
 * Bornes du mois EN COURS (currentMonthBounds), pas du mois écoulé
 * (periodBounds, réservé au cron) : un récap à la demande reflète l'état
 * présent du compte.
 */
export async function sendConsolidatedRecap(
    raw: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    const { shipownerId } = parsed.data;

    // 1. Auth + rôle staff + is_active.
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };
    const { data: profile } = await supabase.from('profiles').select('role, full_name, is_active').eq('id', auth.user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return { ok: false, reason: 'insufficient role' };
    if (profile.is_active === false) return { ok: false, reason: 'account inactive' };

    const platform = createPlatformClient();

    // 2. Charge l'armateur (regardless of tenant).
    const { data: ownerRow, error: ownerErr } = await platform
        .from('shipowners')
        .select('id, name, official_email, billing_cc_emails, jurisdiction_id')
        .eq('id', shipownerId)
        .single();
    if (ownerErr || !ownerRow) return { ok: false, reason: `shipowner not found: ${ownerErr?.message ?? 'nil'}` };

    const owner = ownerRow as {
        name: string; official_email: string | null;
        billing_cc_emails: string[] | null; jurisdiction_id: string;
    };
    const jurisdictionId = owner.jurisdiction_id;

    // 3. Isolation explicite.
    if (profile.role !== 'SUPERADMIN') {
        const staffJur = await getServerJurisdictionId();
        if (jurisdictionId !== staffJur) return { ok: false, reason: 'forbidden' };
    }

    // 4. Compose le relevé du mois EN COURS. Zéro facture ouverte ⇒ refus
    //    explicite : on n'envoie pas un récapitulatif vide.
    //
    //    Client scopé à la juridiction de l'armateur, PAS `platform` :
    //    transactions.jurisdiction_id vient de l'escale (pas de l'armateur), et
    //    vessels.imo_number / shipowners.imo_company_no sont UNIQUE global — un
    //    navire touchant plusieurs juridictions produit par construction un
    //    armateur avec des créances dans plusieurs juridictions. `transactions`
    //    et `payments` figurent tous deux dans TENANT_SCOPED_TABLES
    //    (lib/supabase/tenant.ts) : createTenantClient y injecte automatiquement
    //    `jurisdiction_id = jurisdictionId` sur chaque requête, ce que le
    //    service-role non scopé `platform` ne fait pas.
    const now = new Date();
    const { periodStart, periodEnd, label } = currentMonthBounds(now);
    const tenant = createTenantClient(jurisdictionId);
    const result = await composeOwnerStatement(tenant, { shipownerId, periodStart, periodEnd, now });
    if (result.openLines.length === 0) return { ok: false, reason: 'nothing outstanding' };

    // 5. PDF généré EN MÉMOIRE — jamais écrit dans owner_statements ni dans le
    //    bucket statements/ (voir commentaire d'en-tête).
    const jurisdictionName = await fetchJurisdictionName(platform, jurisdictionId);
    const pdfBuffer = await generateStatementPdf({
        ownerName: owner.name,
        jurisdiction: jurisdictionName,
        periodLabel: label,
        openLines: result.openLines,
        payments: result.payments,
        totalOutstandingUsd: result.totalOutstandingUsd,
        paymentsInMonthUsd: result.paymentsInMonthUsd,
    });

    // 6. Destinataires (cascade + CC facturation de la juridiction). Pas d'agent
    //    ni de propriétaire de navire uniques ici : un récapitulatif porte sur
    //    PLUSIEURS factures, potentiellement plusieurs agents — seule la
    //    coordonnée armateur fait foi. Aucun destinataire joignable ⇒ refus,
    //    aucune écriture (cas réel : armateur « À identifier », 83 pro-formas
    //    sans e-mail officiel).
    const billingCc = await fetchJurisdictionBillingCc(platform, jurisdictionId);
    const recipients = resolveInvoiceRecipients({
        shipownerBillingEmail: owner.official_email,
        agentEmail: null,
        vesselOwnerEmail: null,
        ownerCcEmails: owner.billing_cc_emails ?? [],
        jurisdictionCcEmails: billingCc,
        platformCcEmail: process.env.PLATFORM_BILLING_CC ?? null,
    });
    if (!recipients) return { ok: false, reason: 'no reachable recipient' };

    // 7. Envoi — ton recouvrement, PDF toujours joint. Échec ⇒ abandon, pas
    //    d'insert.
    const emailResult = await sendCollectionRecapEmail({
        to: recipients.to, cc: recipients.cc, recipientName: owner.name,
        lines: result.openLines, totalOutstandingUsd: result.totalOutstandingUsd,
        jurisdictionName, pdfBuffer,
    });
    if (!emailResult.success) return { ok: false, reason: `email failed: ${emailResult.error ?? 'unknown'}` };

    // 8. Audit — geste tracé mais informatif : aucune procédure n'est engagée.
    await platform.from('audit_logs').insert({
        user_id: auth.user.id, user_full_name: profile.full_name ?? auth.user.email ?? 'Staff',
        action: 'TRANSACTION_UPDATED', severity: 'INFO',
        entity_type: 'Shipowner', entity_id: shipownerId, jurisdiction_id: jurisdictionId,
        details_json: {
            event: 'CONSOLIDATED_RECAP_SENT', recipient: recipients.to, cc: recipients.cc,
            invoiceCount: result.openLines.length,
        },
    });

    // 9. Registre — UN SEUL insert groupé, une ligne par facture incluse,
    //    toutes avec le MÊME sent_at (calculé une seule fois) : c'est la clé de
    //    regroupement qui permet à l'affichage de replier un récapitulatif en
    //    une seule entrée plutôt qu'en N lignes. Aucun conflit possible :
    //    idx_creminders_txn_tier (mig 126) est partiel WHERE tier <> 'MANUAL'.
    const sentAt = new Date().toISOString();
    const rows = result.openLines.map((line) => ({
        transaction_id: line.transactionId, tier: 'MANUAL' as const, sent_at: sentAt,
        sent_email: recipients.to, cc_emails: recipients.cc,
        template_used: 'manual_recap', escalated_bailiff: false, debtor_response_type: 'SILENT' as const,
    }));
    const { error: insErr } = await platform.from('collection_reminders').insert(rows);
    if (insErr) return { ok: false, reason: `recap sent but ledger write failed: ${insErr.message}` };

    revalidatePath('/admin/collections');
    return { ok: true };
}
