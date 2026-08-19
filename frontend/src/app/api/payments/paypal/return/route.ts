import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';
import { captureOrder, getOrder, type PaypalCapture } from '@/services/paypalService';
import { confirmPaypalPayment } from '@/services/paypalConfirmation';
import { scopedLogger } from '@/lib/logger';

/**
 * GET /api/payments/paypal/return
 *
 * URL de retour déclarée à PayPal dans `experienceContext.returnUrl`. PayPal y
 * renvoie l'armateur après approbation, avec `?token=<orderId>&PayerID=<payerId>`.
 *
 * C'est le chemin NOMINAL de capture : PayPal Orders v2 n'encaisse rien tant que
 * `captureOrder` n'a pas été appelé (fenêtre de 6 h). Capturer ici permet à
 * l'armateur de voir sa facture PAYÉE dès l'affichage de la page.
 *
 * Le webhook (/api/webhooks/paypal) et le cron de réconciliation couvrent les
 * cas où l'armateur ne revient jamais.
 *
 * Sécurité :
 *   - `requireOwner()` — session armateur authentifiée obligatoire.
 *   - la ligne `payments` doit appartenir au shipowner de la session. Un `token`
 *     appartenant à un autre armateur redirige vers `failed` sans jamais révéler
 *     que la ligne existe, et sans capturer.
 *
 * Toutes les issues sont des redirections vers /dashboard/invoices — la page que
 * l'armateur attend. Aucune réponse JSON : c'est une navigation, pas une API.
 *   ?paypal=success  paiement confirmé (par nous ou par un filet)
 *   ?paypal=pending  approuvé mais capture ou confirmation incomplète
 *   ?paypal=failed   token invalide, ligne étrangère, ou montant rejeté
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVOICES_PATH = '/dashboard/invoices';

const log = scopedLogger('paypal-return');

function redirectTo(req: NextRequest, outcome: 'success' | 'pending' | 'failed') {
    return NextResponse.redirect(new URL(`${INVOICES_PATH}?paypal=${outcome}`, req.url));
}

interface OwnedPaymentRow {
    id: string;
    shipowner_id: string;
    status: string;
}

export async function GET(req: NextRequest): Promise<Response> {
    // requireOwner redirige (throw NEXT_REDIRECT) si la session n'est pas une
    // session armateur active — c'est le comportement voulu ici aussi.
    const ctx = await requireOwner();

    const orderId = new URL(req.url).searchParams.get('token');
    if (!orderId) {
        log.warn('paypal_return_missing_token', { userId: ctx.userId });
        return redirectTo(req, 'failed');
    }

    const admin = createTenantClient(ctx.jurisdictionId);

    // Vérifier l'appartenance AVANT tout appel sortant : on ne capture jamais
    // pour le compte d'un autre armateur.
    const { data } = await admin
        .from('payments')
        .select('id, shipowner_id, status')
        .eq('external_reference', orderId)
        .eq('rail', 'PAYPAL')
        .maybeSingle();

    const payment = (data as OwnedPaymentRow | null) ?? null;
    if (!payment) {
        log.warn('paypal_return_unknown_order', { userId: ctx.userId, orderId });
        return redirectTo(req, 'failed');
    }
    if (payment.shipowner_id !== ctx.shipowner.id) {
        log.error('paypal_return_ownership_mismatch', {
            userId: ctx.userId,
            orderId,
            paymentId: payment.id,
        });
        return redirectTo(req, 'failed');
    }

    // Un filet a pu confirmer avant le retour (webhook très rapide). Rien à
    // faire : afficher le succès.
    if (payment.status === 'CONFIRMED') {
        return redirectTo(req, 'success');
    }
    if (payment.status === 'REJECTED' || payment.status === 'CANCELLED') {
        return redirectTo(req, 'failed');
    }

    // ── Capture ──────────────────────────────────────────────────────────────
    // PayPal refuse une double capture (ORDER_ALREADY_CAPTURED). Dans ce cas la
    // capture existe déjà : on relit l'ordre pour récupérer ses montants au lieu
    // de traiter l'erreur comme un échec.
    let capture: PaypalCapture;
    try {
        capture = await captureOrder(orderId);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!message.includes('ORDER_ALREADY_CAPTURED')) {
            log.error('paypal_return_capture_failed', { orderId, error: message });
            return redirectTo(req, 'pending');
        }
        try {
            capture = await getOrder(orderId);
        } catch (readErr) {
            log.error('paypal_return_reread_failed', {
                orderId,
                error: readErr instanceof Error ? readErr.message : String(readErr),
            });
            return redirectTo(req, 'pending');
        }
    }

    const { outcome } = await confirmPaypalPayment(admin, {
        orderId,
        captureId: capture.captureId,
        paidAmount: capture.paidAmount,
        paidCurrency: capture.paidCurrency,
        payerEmail: capture.payerEmail,
    });

    switch (outcome) {
        case 'CONFIRMED':
        case 'IDEMPOTENT_SKIP':
            return redirectTo(req, 'success');
        case 'REJECTED_AMOUNT_MISMATCH':
        case 'NOT_FOUND':
            return redirectTo(req, 'failed');
        default:
            return redirectTo(req, 'pending');
    }
}
