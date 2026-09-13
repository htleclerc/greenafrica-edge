import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { sendDailyOperationsDigestEmail } from '@/services/emailService';
import {
    buildDailyDigest,
    previousDayWindow,
    type PaymentRow,
    type ProformaRow,
} from '@/services/dailyDigestService';
import { scopedLogger } from '@/lib/logger';

/**
 * GET /api/cron/daily-operations-digest
 *
 * Cron quotidien — récapitulatif de la veille adressé à l'exploitation :
 * pro-formas RÉELLEMENT ENVOYÉES (maritime et aérien) et paiements reçus.
 *
 * Le destinataire est `DIRECTION_EMAIL`, déjà déclarée dans l'environnement.
 * Aucune adresse n'est écrite en dur : une adresse d'exploitation change, et
 * la retrouver dans six fichiers est le meilleur moyen d'en oublier un.
 *
 * Ce cron n'écrit rien et ne notifie aucun débiteur. Il rend compte.
 *
 * Auth : Authorization: Bearer ${CRON_SECRET}. Sinon 401.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = scopedLogger('cron.daily-operations-digest');

// Garde-fou : une journée normale compte quelques dizaines de lignes. Ce
// plafond protège d'un rattrapage massif qui ferait un message illisible ; le
// récapitulatif dit alors combien de lignes il n'affiche pas.
const ROW_LIMIT = 500;

let clientOverride: SupabaseClient | null = null;
export function __setClientForTest(c: SupabaseClient | null): void { clientOverride = c; }
function serviceClient(): SupabaseClient { return clientOverride ?? createPlatformClient(); }

export async function GET(req: NextRequest | Request): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const to = process.env.DIRECTION_EMAIL;
    if (!to) {
        // Pas d'adresse de repli : envoyer un état d'exploitation à une adresse
        // devinée serait pire que de ne pas l'envoyer.
        log.error('direction_email_missing');
        return NextResponse.json({ error: 'DIRECTION_EMAIL_missing' }, { status: 500 });
    }

    const admin = serviceClient();
    const window = previousDayWindow(new Date());

    // Envoyées, pas enregistrées : `proforma_sent_at` est le seul champ qui
    // atteste d'une notification au débiteur.
    const { data: proformas, error: pErr } = await admin
        .from('transactions')
        .select('invoice_ref, ref, mode, vessel_name, tax_amount_usd, proforma_sent_at')
        .eq('document_type', 'PROFORMA')
        .neq('status', 'VOID')
        .gte('proforma_sent_at', window.startIso)
        .lt('proforma_sent_at', window.endIso)
        .limit(ROW_LIMIT);
    if (pErr) {
        log.error('proformas_select_failed', { error: pErr.message });
        return NextResponse.json({ error: 'select_failed' }, { status: 500 });
    }

    // Les confirmés portent `confirmed_at`, les déclarations en attente non :
    // on prend la fenêtre sur `created_at` et on laisse l'agrégation trancher
    // par statut. Filtrer sur `confirmed_at` seul masquerait les déclarations
    // du jour, qui sont précisément ce que l'exploitation doit traiter.
    const { data: payments, error: payErr } = await admin
        .from('payments')
        .select('receipt_ref, amount_usd_minor, rail, status, confirmed_at, created_at')
        .or(
            `and(confirmed_at.gte.${window.startIso},confirmed_at.lt.${window.endIso}),` +
            `and(created_at.gte.${window.startIso},created_at.lt.${window.endIso})`,
        )
        .limit(ROW_LIMIT);
    if (payErr) {
        log.error('payments_select_failed', { error: payErr.message });
        return NextResponse.json({ error: 'select_failed' }, { status: 500 });
    }

    const digest = buildDailyDigest(
        window,
        (proformas ?? []) as ProformaRow[],
        (payments ?? []) as PaymentRow[],
    );

    const sent = await sendDailyOperationsDigestEmail({ to, digest });
    if (!sent.success) {
        log.error('digest_send_failed', { error: sent.error });
        return NextResponse.json({ error: 'send_failed', day: window.label }, { status: 500 });
    }

    const counts = {
        day: window.label,
        issued: digest.issuedCount,
        issued_usd: digest.issuedTotalUsd,
        maritime: digest.maritime.count,
        air: digest.air.count,
        payments: digest.payments.count,
        payments_usd: digest.payments.totalUsd,
        pending_payments: digest.pendingPayments.count,
    };
    log.info('cron_run_complete', counts);
    return NextResponse.json(counts);
}
