import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { verifyWebhookSignature, captureOrder, getOrder } from '@/services/paypalService';
import {
    confirmPaypalPayment,
    rejectPaypalPayment,
    cancelPaypalPayment,
} from '@/services/paypalConfirmation';
import { scopedLogger } from '@/lib/logger';

/**
 * POST /api/webhooks/paypal
 *
 * Filet du rail PAYPAL. Le chemin nominal est la route de retour navigateur
 * (/api/payments/paypal/return) ; ce webhook couvre l'armateur qui approuve puis
 * ferme son onglet, et la capture réussie dont l'UPDATE local a échoué.
 *
 * PayPal retente la livraison pendant environ 3 jours — largement dans la
 * fenêtre de capture de 6 h. C'est le vrai filet ; le cron n'est qu'un janitor.
 *
 * Événements traités :
 *   CHECKOUT.ORDER.APPROVED    → capture puis confirmation (onglet fermé)
 *   PAYMENT.CAPTURE.COMPLETED  → confirmation (capture déjà faite)
 *   PAYMENT.CAPTURE.DENIED     → rejet
 *   PAYMENT.CAPTURE.DECLINED   → rejet
 *   CHECKOUT.ORDER.VOIDED      → annulation
 *
 * L'identifiant d'ordre PayPal (= payments.external_reference) se lit :
 *   - directement dans `resource.id` pour les événements CHECKOUT.ORDER.*
 *   - dans `resource.supplementary_data.related_ids.order_id` pour les
 *     événements PAYMENT.CAPTURE.* (dont `resource.id` est l'id de capture)
 *
 * Codes de retour, alignés sur le webhook Stripe :
 *   400 signature absente / invalide, ou corps illisible
 *   200 succès, événement ignoré volontairement, ET erreur interne (loguée) —
 *       jamais de 500, qui déclencherait une tempête de retry.
 *
 * Client Supabase : plateforme (non scopé). Un webhook n'a aucun contexte
 * tenant ; le lookup se fait par identifiant PayPal, et jurisdiction_id est déjà
 * porté par la ligne payments créée à l'initiation. Même politique que le
 * webhook Stripe.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = scopedLogger('paypal-webhook');

const SIG_HEADERS = [
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-sig',
    'paypal-transmission-time',
] as const;

function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Résout l'identifiant d'ordre PayPal selon la famille d'événement. */
function extractOrderId(eventType: string, resource: Record<string, unknown>): string | null {
    if (eventType.startsWith('CHECKOUT.ORDER.')) {
        return typeof resource.id === 'string' ? resource.id : null;
    }
    const related = asRecord(asRecord(resource.supplementary_data).related_ids);
    return typeof related.order_id === 'string' ? related.order_id : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const headers: Record<string, string | null> = {};
    for (const h of SIG_HEADERS) headers[h] = req.headers.get(h);
    if (SIG_HEADERS.some((h) => !headers[h])) {
        log.warn('webhook_missing_signature_headers', {});
        return NextResponse.json({ error: 'missing signature headers' }, { status: 400 });
    }

    const rawBody = await req.text();

    let event: Record<string, unknown>;
    try {
        event = asRecord(JSON.parse(rawBody));
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!(await verifyWebhookSignature(headers, rawBody))) {
        log.warn('webhook_signature_invalid', { eventId: String(event.id ?? '(none)') });
        return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
    }

    const eventId = String(event.id ?? '(none)');
    const eventType = String(event.event_type ?? '');
    const resource = asRecord(event.resource);

    log.info('webhook_event_received', { eventId, eventType });

    const admin = createPlatformClient();

    try {
        switch (eventType) {
            case 'CHECKOUT.ORDER.APPROVED':
                return await handleApproved(admin, resource, eventId);
            case 'PAYMENT.CAPTURE.COMPLETED':
                return await handleCaptureCompleted(admin, resource, eventId);
            case 'PAYMENT.CAPTURE.DENIED':
            case 'PAYMENT.CAPTURE.DECLINED':
                return await handleCaptureFailed(admin, resource, eventId, eventType);
            case 'CHECKOUT.ORDER.VOIDED':
                return await handleVoided(admin, resource, eventId);
            default:
                log.warn('webhook_unhandled_event', { eventId, eventType });
                return NextResponse.json({ received: true, action: 'unhandled_event' });
        }
    } catch (e) {
        log.error('webhook_handler_error', {
            eventId,
            eventType,
            error: e instanceof Error ? e.message : String(e),
        });
        // 200 volontaire — l'erreur est loguée, on ne veut pas de retry en boucle.
        return NextResponse.json({ received: true, error: true });
    }
}

function unknownReference(eventId: string, eventType: string): NextResponse {
    log.warn('webhook_missing_order_id', { eventId, eventType });
    return NextResponse.json({ received: true, action: 'unknown_reference' });
}

async function handleApproved(
    admin: SupabaseClient,
    resource: Record<string, unknown>,
    eventId: string,
): Promise<NextResponse> {
    const orderId = extractOrderId('CHECKOUT.ORDER.APPROVED', resource);
    if (!orderId) return unknownReference(eventId, 'CHECKOUT.ORDER.APPROVED');

    // L'armateur a approuvé mais n'est peut-être jamais revenu : c'est à nous de
    // capturer. Si la route de retour a déjà capturé, PayPal renvoie
    // ORDER_ALREADY_CAPTURED — on relit alors l'ordre et on laisse
    // confirmPaypalPayment décider (il sortira en IDEMPOTENT_SKIP).
    let capture;
    try {
        capture = await captureOrder(orderId);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!message.includes('ORDER_ALREADY_CAPTURED')) {
            log.error('webhook_capture_failed', { eventId, orderId, error: message });
            return NextResponse.json({ received: true, action: 'capture_failed' });
        }
        capture = await getOrder(orderId);
    }

    const { outcome } = await confirmPaypalPayment(admin, {
        orderId,
        captureId: capture.captureId,
        paidAmount: capture.paidAmount,
        paidCurrency: capture.paidCurrency,
        payerEmail: capture.payerEmail,
    });
    return NextResponse.json({ received: true, action: actionFor(outcome) });
}

async function handleCaptureCompleted(
    admin: SupabaseClient,
    resource: Record<string, unknown>,
    eventId: string,
): Promise<NextResponse> {
    const orderId = extractOrderId('PAYMENT.CAPTURE.COMPLETED', resource);
    if (!orderId) return unknownReference(eventId, 'PAYMENT.CAPTURE.COMPLETED');

    // La capture est déjà faite côté PayPal — ne jamais rappeler captureOrder.
    // Les montants du payload servent uniquement de contrôle ; la vérité reste
    // payments.amount_usd_minor.
    const amount = asRecord(resource.amount);
    const { outcome } = await confirmPaypalPayment(admin, {
        orderId,
        captureId: typeof resource.id === 'string' ? resource.id : null,
        paidAmount: amount.value != null ? String(amount.value) : null,
        paidCurrency: typeof amount.currency_code === 'string' ? amount.currency_code : null,
        payerEmail: null,
    });
    return NextResponse.json({ received: true, action: actionFor(outcome) });
}

async function handleCaptureFailed(
    admin: SupabaseClient,
    resource: Record<string, unknown>,
    eventId: string,
    eventType: string,
): Promise<NextResponse> {
    const orderId = extractOrderId(eventType, resource);
    if (!orderId) return unknownReference(eventId, eventType);

    const details = asRecord(resource.status_details);
    const reason = typeof details.reason === 'string' ? details.reason : eventType;
    const { outcome } = await rejectPaypalPayment(admin, orderId, reason);
    return NextResponse.json({ received: true, action: outcome.toLowerCase() });
}

async function handleVoided(
    admin: SupabaseClient,
    resource: Record<string, unknown>,
    eventId: string,
): Promise<NextResponse> {
    const orderId = extractOrderId('CHECKOUT.ORDER.VOIDED', resource);
    if (!orderId) return unknownReference(eventId, 'CHECKOUT.ORDER.VOIDED');

    const { outcome } = await cancelPaypalPayment(admin, orderId, 'order voided');
    return NextResponse.json({ received: true, action: outcome.toLowerCase() });
}

function actionFor(outcome: string): string {
    switch (outcome) {
        case 'CONFIRMED':
            return 'confirmed';
        case 'IDEMPOTENT_SKIP':
            return 'already_paid';
        case 'NOT_FOUND':
            return 'unknown_reference';
        case 'REJECTED_AMOUNT_MISMATCH':
            return 'rejected_amount_mismatch';
        default:
            return 'error_logged';
    }
}
