import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { resolveInvoiceRecipients } from '@/services/invoiceIssuanceService';
import { fetchJurisdictionBillingCc, fetchJurisdictionBailiffCc } from '@/lib/jurisdictionName';
import { notifyOwner } from '@/services/notificationService';
import { sendProformaReminderEmail } from '@/services/emailService';
import { confirmedPaidUsdByTransaction } from '@/services/confirmedPayments';
import { outstandingUsd } from '@/lib/outstanding';
import {
    dueTier, reminderTemplate, type ReminderTier, type DebtorResponseType,
} from '@/services/collectionReminderService';
import { scopedLogger } from '@/lib/logger';

/**
 * GET /api/cron/collection-reminders
 *
 * Vercel Cron quotidien (08:00 UTC) — moteur de relance B1. Remplace le pg_cron
 * proforma-reminders-daily (mig 065, désactivé par mig 110). Pour chaque
 * pro-forma PENDING/OVERDUE dont un palier (J3→J45) est dû : envoie l'e-mail de
 * relance INLINE (comme le chantier A pour les documents fiscaux — la cascade
 * de destinataires + copies n'est disponible qu'ici, pas dans le
 * notification-email-loop générique), insère la notif PROFORMA_REMINDER
 * (skipEmail: true pour ne pas la faire doubler par ce même loop) en estampant
 * emailed_at si l'envoi a réussi, PUIS une ligne collection_reminders (registre
 * durable).
 *
 * Auth : Authorization: Bearer ${CRON_SECRET}. Sinon 401.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = scopedLogger('cron.collection-reminders');
const ROW_LIMIT = 200;

// Injection de client pour les tests — la prod utilise createPlatformClient().
let clientOverride: SupabaseClient | null = null;
export function __setClientForTest(c: SupabaseClient | null): void { clientOverride = c; }
function serviceClient(): SupabaseClient { return clientOverride ?? createPlatformClient(); }

interface ProformaRow {
    id: string;
    invoice_ref: string | null;
    tax_amount_usd: number;
    partial_paid_usd: number | null;
    vessel_name: string;
    status: string;
    created_at: string;
    shipowner_id: string | null;
    agent_profile_id: string | null;
    jurisdiction_id: string | null;
}

function ageInDays(createdAtIso: string, now: Date): number {
    return Math.floor((now.getTime() - new Date(createdAtIso).getTime()) / 86_400_000);
}

export async function GET(req: NextRequest | Request): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = serviceClient();
    const now = new Date();
    const counts = { scanned: 0, sent: 0, skipped: 0, failed: 0 };

    const { data: proformasRaw, error: selErr } = await admin
        .from('transactions')
        .select('id, invoice_ref, tax_amount_usd, partial_paid_usd, vessel_name, status, created_at, shipowner_id, agent_profile_id, jurisdiction_id')
        .eq('document_type', 'PROFORMA')
        .in('status', ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'])
        .not('shipowner_id', 'is', null)
        .limit(ROW_LIMIT);

    if (selErr) {
        log.error('select_failed', { error: selErr.message });
        return NextResponse.json({ error: 'select_failed' }, { status: 500 });
    }

    const proformas = (proformasRaw ?? []) as ProformaRow[];

    // Ce qui reste du, lu dans les paiements CONFIRMED. Relancer sur
    // `tax_amount_usd` reclamait le montant plein d'une facture deja reglee en
    // partie — et `partial_paid_usd`, gelee par la mig 089, n'aurait rien
    // corrige. Une lettre de recouvrement qui annonce un montant faux se
    // retourne contre celui qui l'envoie.
    let paidByTxn = new Map<string, number>();
    try {
        paidByTxn = await confirmedPaidUsdByTransaction(admin, proformas.map((p) => p.id));
    } catch (e) {
        // Sans cette lecture, tout montant annonce serait suspect : on ne
        // relance pas plutot que de relancer a tort.
        log.error('paid_amounts_unavailable', { error: e instanceof Error ? e.message : String(e) });
        return NextResponse.json({ error: 'paid_amounts_unavailable' }, { status: 500 });
    }

    for (const p of proformas) {
        counts.scanned += 1;
        try {
            // sentTiers + dernière réponse débiteur (ordre desc pour la dernière).
            const { data: remRaw } = await admin
                .from('collection_reminders')
                .select('tier, debtor_response_type, debtor_response_at')
                .eq('transaction_id', p.id)
                .order('sent_at', { ascending: false })
                .limit(20);
            const reminders = (remRaw ?? []) as {
                tier: string; debtor_response_type: DebtorResponseType | null; debtor_response_at: string | null;
            }[];
            const sentTiers = reminders.map((r) => r.tier).filter((t): t is ReminderTier =>
                (['J3', 'J7', 'J15', 'J30', 'J45'] as string[]).includes(t)) as ReminderTier[];
            const latest = reminders.find((r) => r.debtor_response_type && r.debtor_response_type !== 'SILENT');

            const tier = dueTier({
                status: p.status,
                ageDays: ageInDays(p.created_at, now),
                sentTiers,
                latestResponse: latest?.debtor_response_type ?? null,
                latestResponseAt: latest?.debtor_response_at ? new Date(latest.debtor_response_at) : null,
                now,
            });
            if (!tier) { counts.skipped += 1; continue; }

            // Creance eteinte par les paiements alors que le statut n'a pas
            // suivi (recompute rate, encaissement hors rail) : ne pas relancer.
            if (outstandingUsd(p as never, paidByTxn.get(p.id) ?? 0) <= 0.005) {
                log.info('reminder_skipped_settled', { txnId: p.id, tier });
                counts.skipped += 1;
                continue;
            }

            // Destinataires : cascade armateur + copies juridiction/plateforme + huissier dès J45.
            const { data: owner } = p.shipowner_id
                ? await admin.from('shipowners').select('official_email, name, billing_cc_emails').eq('id', p.shipowner_id).maybeSingle()
                : { data: null };
            const { data: agent } = p.agent_profile_id
                ? await admin.from('profiles').select('email').eq('id', p.agent_profile_id).maybeSingle()
                : { data: null };
            const jurisdictionCc = await fetchJurisdictionBillingCc(admin, p.jurisdiction_id);
            // Cabinet huissier en copie seulement au palier pré-huissier J45.
            const bailiffCc = tier === 'J45'
                ? await fetchJurisdictionBailiffCc(admin, p.jurisdiction_id)
                : [];

            const recipients = resolveInvoiceRecipients({
                shipownerBillingEmail: (owner?.official_email as string | null) ?? null,
                agentEmail: (agent?.email as string | null) ?? null,
                vesselOwnerEmail: null,
                ownerCcEmails: (owner?.billing_cc_emails as string[] | null) ?? [],
                jurisdictionCcEmails: [...jurisdictionCc, ...bailiffCc],
                platformCcEmail: process.env.PLATFORM_BILLING_CC ?? null,
            });
            if (!recipients) {
                log.warn('reminder_skipped_no_recipient', { txnId: p.id, tier });
                counts.skipped += 1;
                continue;
            }

            const { templateId } = reminderTemplate(tier);
            const ageDays = ageInDays(p.created_at, now);
            const remainingUsd = outstandingUsd(p as never, paidByTxn.get(p.id) ?? 0);
            const bodyParams = {
                transaction_id: p.id,
                invoice_ref: p.invoice_ref,
                amount_usd: remainingUsd,
                vessel_name: p.vessel_name,
                tier,
                age_days: ageDays,
            };
            const recipientName = (owner?.name as string | null) ?? 'Shipowner';

            // 1) Envoi inline (comme le chantier A) : seule cette route connaît la
            //    cascade + copies résolues ci-dessus. Best-effort — un échec ne doit
            //    ni interrompre la notif ni le registre, une créance a droit à sa
            //    trace même sans e-mail livré.
            const emailResult = await sendProformaReminderEmail({
                to: recipients.to,
                cc: recipients.cc,
                recipientName,
                invoiceRef: p.invoice_ref ?? '—',
                amountUsd: remainingUsd,
                ageDays,
                tier,
            });
            if (!emailResult.success) {
                log.warn('reminder_email_failed', { txnId: p.id, tier, error: emailResult.error });
            }

            // 2) Notif in-app. skipEmail: true — l'envoi a déjà eu lieu ci-dessus,
            //    le notification-email-loop ne doit pas le redoubler.
            const { id: notifId } = await notifyOwner(admin, {
                shipownerId: p.shipowner_id!,
                kind: 'PROFORMA_REMINDER',
                params: bodyParams,
                deepLink: `/owner/invoices?focus=${p.id}`,
                skipEmail: true,
            });

            // 3) Si l'envoi a réussi, estampiller emailed_at pour que le loop
            //    saute cette ligne. Sinon on la laisse null : le loop reste le
            //    filet de rattrapage.
            if (emailResult.success) {
                const { error: emailedAtErr } = await admin
                    .from('owner_notifications')
                    .update({ emailed_at: now.toISOString() })
                    .eq('id', notifId);
                if (emailedAtErr) {
                    log.warn('reminder_emailed_at_update_failed', { txnId: p.id, notifId, error: emailedAtErr.message });
                }
            }

            // 4) Puis le registre durable — SEULEMENT si l'envoi a réussi.
            //
            //    L'inscrire malgré un échec scellait un mensonge : `dueTier`
            //    s'arrête dès que le palier figure dans `sentTiers`, et
            //    l'unicité (transaction_id, tier) interdit toute reprise. Le
            //    palier était donc brûlé, la rampe avançait, et un débiteur
            //    pouvait atteindre « dernier avis avant huissier » sans avoir
            //    jamais reçu une seule lettre — avec un registre affirmant le
            //    contraire. Sur une créance portée au contentieux, c'est la
            //    preuve elle-même qui devient fausse.
            //
            //    Laisser la ligne absente rend le palier à nouveau dû au
            //    prochain passage : la relance repart tant qu'elle n'est pas
            //    réellement partie.
            if (!emailResult.success) {
                counts.failed += 1;
                log.error('reminder_not_recorded_send_failed', {
                    txnId: p.id, tier, error: emailResult.error,
                });
                continue;
            }

            const { error: insErr } = await admin.from('collection_reminders').insert({
                transaction_id: p.id,
                tier,
                sent_at: now.toISOString(),
                sent_email: recipients.to,
                cc_emails: recipients.cc,
                template_used: templateId,
                debtor_response_type: 'SILENT',
            });
            if (insErr) {
                // Conflit (txn,tier) = déjà tracé, bénin. Autre = incident ops.
                log.warn('reminder_ledger_insert_failed', { txnId: p.id, tier, error: insErr.message });
            }
            counts.sent += 1;
        } catch (e) {
            counts.failed += 1;
            log.warn('reminder_failed', { txnId: p.id, error: e instanceof Error ? e.message : String(e) });
        }
    }

    log.info('cron_run_complete', { ...counts });
    return NextResponse.json(counts);
}
