import { NextResponse, type NextRequest } from 'next/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getOrder, captureOrder } from '@/services/paypalService';
import { confirmPaypalPayment, cancelPaypalPayment } from '@/services/paypalConfirmation';
import { scopedLogger } from '@/lib/logger';

/**
 * GET /api/cron/paypal-reconcile-pending
 *
 * Janitor du rail PAYPAL : rattrape les lignes `payments` bloquées en
 * PROCESSING — webhook perdu ET armateur jamais revenu.
 *
 * CADENCE — c'est un janitor QUOTIDIEN, pas un filet temps réel. Le plan Vercel
 * refuse les crons sub-quotidiens (voir payments-reconcile-all). Ce n'est pas un
 * problème : la fenêtre de capture de 6 h est couverte par le webhook, que PayPal
 * retente pendant ~3 jours. Ce cron nettoie les traînards et ferme les ordres
 * expirés.
 *
 * Décisions par ligne (rail=PAYPAL, status=PROCESSING, âge > 10 min) :
 *   COMPLETED           → confirmation (la capture existe déjà chez PayPal)
 *   APPROVED            → capture puis confirmation
 *   VOIDED              → annulation
 *   autre, âge > 6 h    → annulation (l'ordre a expiré, PayPal ne l'honorera plus)
 *   autre, âge < 6 h    → laissé en attente
 *
 * Contrairement à stripe-reconcile-pending, la confirmation passe par
 * confirmPaypalPayment et déclenche donc reçu + e-mail + notification. C'est
 * volontaire : si le webhook a été perdu, personne d'autre ne les émettra, et la
 * garde de course interdit le doublon.
 *
 * Auth : `Authorization: Bearer ${CRON_SECRET}`. La garde vérifie aussi que le
 * secret est défini — sans ça, un env absent produirait la comparaison
 * « Bearer undefined », trivialement devinable.
 *
 * Limite de 100 lignes par exécution pour tenir dans le timeout de la fonction.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Âge minimum pour être éligible : laisse le chemin nominal finir. */
const RECONCILE_THRESHOLD_MS = 10 * 60 * 1000;
/** Un ordre PayPal non capturé expire au bout de 6 h. */
const ORDER_EXPIRY_MS = 6 * 60 * 60 * 1000;

const log = scopedLogger('paypal-reconcile');

interface PendingRow {
    id: string;
    external_reference: string | null;
    created_at: string;
    transaction_id: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = createPlatformClient();
    const cutoff = new Date(Date.now() - RECONCILE_THRESHOLD_MS).toISOString();
    const expiryCutoffMs = Date.now() - ORDER_EXPIRY_MS;

    const { data: pending, error: selErr } = await admin
        .from('payments')
        .select('id, external_reference, created_at, transaction_id')
        .eq('rail', 'PAYPAL')
        .eq('status', 'PROCESSING')
        .lt('created_at', cutoff)
        .limit(100);

    if (selErr) {
        log.error('paypal_reconcile_select_failed', { error: selErr.message });
        return NextResponse.json({ error: 'select_failed' }, { status: 500 });
    }

    const rows = (pending ?? []) as PendingRow[];
    const results: { id: string; outcome: string }[] = [];

    for (const row of rows) {
        results.push({ id: row.id, outcome: await reconcileRow(admin, row, expiryCutoffMs) });
    }

    log.info('paypal_reconcile_done', { reconciled: results.length });
    return NextResponse.json({ reconciled: results.length, results });
}

async function reconcileRow(
    admin: ReturnType<typeof createPlatformClient>,
    row: PendingRow,
    expiryCutoffMs: number,
): Promise<string> {
    const orderId = row.external_reference;
    if (!orderId) return 'SKIPPED_NO_ORDER';

    try {
        const order = await getOrder(orderId);

        if (order.orderStatus === 'COMPLETED') {
            const { outcome } = await confirmPaypalPayment(admin, {
                orderId,
                captureId: order.captureId,
                paidAmount: order.paidAmount,
                paidCurrency: order.paidCurrency,
                payerEmail: order.payerEmail,
            });
            return outcome;
        }

        if (order.orderStatus === 'APPROVED') {
            // Approuvé mais jamais capturé : c'est précisément le trou que ce
            // cron existe pour boucher.
            const capture = await captureOrder(orderId);
            const { outcome } = await confirmPaypalPayment(admin, {
                orderId,
                captureId: capture.captureId,
                paidAmount: capture.paidAmount,
                paidCurrency: capture.paidCurrency,
                payerEmail: capture.payerEmail,
            });
            return outcome;
        }

        if (order.orderStatus === 'VOIDED') {
            await cancelPaypalPayment(admin, orderId, 'order voided');
            return 'CANCELLED';
        }

        if (new Date(row.created_at).getTime() < expiryCutoffMs) {
            await cancelPaypalPayment(admin, orderId, 'order expired (6h)');
            return 'CANCELLED_EXPIRED';
        }

        return 'STILL_PENDING';
    } catch (e) {
        log.error('paypal_reconcile_row_failed', {
            paymentId: row.id,
            orderId,
            error: e instanceof Error ? e.message : String(e),
        });
        return 'ERROR';
    }
}
