import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyWebhookSignature } from '@/services/stripeService';
import { resolveSystemActor } from '@/lib/system-actor';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('stripe-webhook');

/**
 * POST /api/webhooks/stripe
 *
 * Dedicated Stripe webhook handler. Verifies HMAC via stripeService.
 * Dispatches on event type; idempotent on terminal payment statuses.
 *
 * Handled events (v1):
 *   - payment_intent.succeeded      → UPDATE payments → CONFIRMED + capture
 *     stripe_charge_id, payment_method_type, fx_rate_source='STRIPE_SETTLE'
 *     into rail_details; trigger Plan 7C-4 receipt + email hook.
 *   - payment_intent.payment_failed → UPDATE payments → REJECTED + reason.
 *   - checkout.session.expired      → UPDATE payments → CANCELLED.
 *
 * Status codes:
 *   - 400 on missing / invalid signature (Stripe retries briefly then stops)
 *   - 200 on success OR intentionally-skipped events (idempotent / unhandled)
 *   - 200 even on internal handler errors (logged) — avoids retry storms.
 *
 * System actor handling: Plan 7A mig 048 `payments_confirmed_audit`
 * CHECK constraint requires `confirmed_by NOT NULL` when status='CONFIRMED'.
 * Webhooks have no human actor, so we mirror Plan 7C-1 mig 059's stopgap:
 * pick the oldest active SUPERADMIN/FINANCE_ADMIN profile.
 * TECH_DEBT: same long-term fixes as mig 059 apply here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TERMINAL_STATUSES = new Set(['CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED']);

function serviceClient(): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    return createClient(url, key);
}

interface PaymentRow {
    id: string;
    status: string;
    transaction_id: string | null;
    shipowner_id: string;
    amount_usd_minor: number;
    currency: string;
    rail_details: Record<string, unknown> | null;
}

async function findStripePayment(
    admin: SupabaseClient,
    paymentIntentId: string,
): Promise<PaymentRow | null> {
    const { data, error } = await admin
        .from('payments')
        .select('id, status, transaction_id, shipowner_id, amount_usd_minor, currency, rail_details')
        .eq('external_reference', paymentIntentId)
        .eq('rail', 'STRIPE')
        .maybeSingle();
    if (error) throw error;
    return data as PaymentRow | null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const sig = req.headers.get('stripe-signature');
    if (!sig) {
        return NextResponse.json({ error: 'missing signature' }, { status: 400 });
    }

    const rawBody = await req.text();
    let event: ReturnType<typeof verifyWebhookSignature>;
    try {
        event = verifyWebhookSignature(rawBody, sig);
    } catch (e) {
        log.warn('webhook_signature_invalid', {
            error: e instanceof Error ? e.message : 'invalid signature',
        });
        return NextResponse.json(
            { error: e instanceof Error ? e.message : 'invalid signature' },
            { status: 400 },
        );
    }

    log.info('webhook_event_received', { eventId: event.id, eventType: event.type });

    const admin = serviceClient();

    try {
        switch (event.type) {
            case 'payment_intent.succeeded': {
                await handlePaymentSucceeded(
                    admin,
                    event.data.object as unknown as Record<string, unknown>,
                );
                break;
            }
            case 'payment_intent.payment_failed': {
                await handlePaymentFailed(
                    admin,
                    event.data.object as unknown as Record<string, unknown>,
                );
                break;
            }
            case 'checkout.session.expired': {
                await handleCheckoutExpired(
                    admin,
                    event.data.object as unknown as Record<string, unknown>,
                );
                break;
            }
            default:
                log.warn('webhook_unhandled_event', { eventId: event.id, eventType: event.type });
        }
        return NextResponse.json({ received: true });
    } catch (e) {
        log.error('webhook_handler_error', {
            eventId: event.id,
            eventType: event.type,
            error: e instanceof Error ? e.message : String(e),
        });
        // 200 to acknowledge — avoid retry storms on persistent bugs. Errors are logged.
        return NextResponse.json({ received: true, error: true });
    }
}

async function handlePaymentSucceeded(
    admin: SupabaseClient,
    pi: Record<string, unknown>,
): Promise<void> {
    const piId = pi.id as string;
    const payment = await findStripePayment(admin, piId);
    if (!payment) {
        log.warn('webhook_payment_not_found', { stripePiId: piId });
        return;
    }
    if (TERMINAL_STATUSES.has(payment.status)) {
        log.info('webhook_idempotent_skip', {
            stripePiId: piId,
            paymentId: payment.id,
            currentStatus: payment.status,
        });
        return;
    }

    const chargeId = (pi.latest_charge as string | null) ?? null;
    const paymentMethodTypes = pi.payment_method_types as string[] | undefined;
    const mergedRailDetails: Record<string, unknown> = {
        ...(payment.rail_details ?? {}),
        stripe_charge_id: chargeId,
        payment_method_type: paymentMethodTypes?.[0] ?? null,
        fx_rate_source: 'STRIPE_SETTLE',
    };

    const systemActorId = await resolveSystemActor(admin);
    if (!systemActorId) {
        throw new Error(
            'No active system actor (SUPERADMIN/FINANCE_ADMIN) found to satisfy payments_confirmed_audit',
        );
    }

    const confirmedAt = new Date().toISOString();
    const { error: updErr } = await admin
        .from('payments')
        .update({
            status: 'CONFIRMED',
            confirmed_at: confirmedAt,
            confirmed_by: systemActorId,
            rail_details: mergedRailDetails,
        })
        .eq('id', payment.id);
    if (updErr) throw updErr;

    if (payment.transaction_id) {
        await admin.rpc('recompute_transaction_status', {
            p_transaction_id: payment.transaction_id,
        });
    }

    log.info('webhook_payment_succeeded', {
        stripePiId: piId,
        paymentId: payment.id,
        transactionId: payment.transaction_id,
        amountUsdMinor: payment.amount_usd_minor,
    });

    // Plan 7C-4 receipt + email hook (fail-soft — payment stays CONFIRMED on error)
    let receiptRefForNotif: string | undefined;
    let receiptBufferForNotif: Uint8Array | undefined;
    let txForNotif: { invoice_ref: string | null; vessel_name: string | null } | null = null;
    try {
        const { generatePaymentReceipt } = await import('@/services/receiptService');
        const receipt = await generatePaymentReceipt(admin, payment.id);
        receiptRefForNotif = receipt.receiptRef;
        receiptBufferForNotif = receipt.pdfBuffer;

        const { sendPaymentConfirmationEmail } = await import('@/services/emailService');

        const { data: owner } = await admin
            .from('shipowners')
            .select('name, official_email')
            .eq('id', payment.shipowner_id)
            .single();

        const { data: tx } = payment.transaction_id
            ? await admin
                .from('transactions')
                .select('invoice_ref, vessel_name')
                .eq('id', payment.transaction_id)
                .single()
            : { data: null as { invoice_ref: string | null; vessel_name: string | null } | null };
        txForNotif = tx
            ? { invoice_ref: tx.invoice_ref as string | null, vessel_name: tx.vessel_name as string | null }
            : null;

        const ownerEmail = (owner as { official_email?: string } | null)?.official_email;
        if (ownerEmail) {
            await sendPaymentConfirmationEmail({
                to: ownerEmail,
                recipientName: ((owner as { name?: string } | null)?.name) ?? 'Shipowner',
                vesselName: (tx?.vessel_name as string | null) ?? '—',
                invoiceRef: (tx?.invoice_ref as string | null) ?? '—',
                amountUsd: (payment.amount_usd_minor ?? 0) / 100,
                paidAt: new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }),
                receiptRef: receipt.receiptRef,
                receiptPdfBuffer: receipt.pdfBuffer,
            });
        }
    } catch (e) {
        log.warn('receipt_email_failed', {
            paymentId: payment.id,
            error: e instanceof Error ? e.message : String(e),
        });
    }

    // Plan 7F: in-app notification (email already sent above for PAYMENT_RECEIVED;
    // WALLET_TOPPED_UP — Stripe top-ups have transaction_id=null — dispatches its own
    // topup email via notifyOwner). Fail-soft.
    try {
        const { notifyOwner } = await import('@/services/notificationService');
        const isTopup = payment.transaction_id === null;
        if (isTopup) {
            const { data: wallet } = await admin
                .from('wallets')
                .select('balance_usd_minor')
                .eq('shipowner_id', payment.shipowner_id)
                .maybeSingle();
            await notifyOwner(admin, {
                shipownerId: payment.shipowner_id,
                kind: 'WALLET_TOPPED_UP',
                params: {
                    amount_usd: (payment.amount_usd_minor ?? 0) / 100,
                    new_balance_usd: ((wallet?.balance_usd_minor as number | undefined) ?? 0) / 100,
                },
                deepLink: '/owner/wallet',
            });
        } else {
            await notifyOwner(admin, {
                shipownerId: payment.shipowner_id,
                kind: 'PAYMENT_RECEIVED',
                params: {
                    vessel_name: txForNotif?.vessel_name ?? '—',
                    invoice_ref: txForNotif?.invoice_ref ?? '—',
                    amount_usd: (payment.amount_usd_minor ?? 0) / 100,
                    paid_at: confirmedAt,
                    receipt_ref: receiptRefForNotif,
                },
                deepLink: `/owner/invoices?ref=${encodeURIComponent(txForNotif?.invoice_ref ?? '')}`,
                skipEmail: true,
                ...(receiptBufferForNotif
                    ? { attachments: { pdfBuffer: receiptBufferForNotif, filename: `${receiptRefForNotif}.pdf` } }
                    : {}),
            });
        }
    } catch (notifyErr) {
        log.warn('notification_dispatch_failed', {
            paymentId: payment.id,
            error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        });
    }
}

async function handlePaymentFailed(
    admin: SupabaseClient,
    pi: Record<string, unknown>,
): Promise<void> {
    const piId = pi.id as string;
    const reason =
        (pi.last_payment_error as { message?: string } | undefined)?.message ?? 'unknown';

    const payment = await findStripePayment(admin, piId);
    if (!payment) return;
    if (TERMINAL_STATUSES.has(payment.status)) return;

    const { error } = await admin
        .from('payments')
        .update({
            status: 'REJECTED',
            rejected_reason: `Stripe: ${reason}`,
        })
        .eq('id', payment.id);
    if (error) throw error;

    // Match rejectPayment convention: log reason LENGTH, not the text. The
    // text is already persisted in payments.rejected_reason. Final-review fix.
    log.info('webhook_payment_failed', {
        stripePiId: piId,
        paymentId: payment.id,
        transactionId: payment.transaction_id,
        reasonLen: reason.length,
    });

    // Notify owner of the failed payment (fail-soft). Closes the UX gap
    // where admin-rejected payments produce a notification but Stripe-
    // failed payments did not.
    try {
        const { notifyOwner } = await import('@/services/notificationService');
        let invoiceRef: string | undefined;
        if (payment.transaction_id) {
            const { data: tx } = await admin
                .from('transactions')
                .select('invoice_ref')
                .eq('id', payment.transaction_id)
                .single();
            invoiceRef = (tx as { invoice_ref?: string } | null)?.invoice_ref;
        }
        await notifyOwner(admin, {
            shipownerId: payment.shipowner_id,
            kind: 'PAYMENT_REJECTED',
            params: {
                invoice_ref: invoiceRef ?? '—',
                reason: `Stripe: ${reason}`,
            },
            deepLink: invoiceRef
                ? `/owner/invoices?ref=${encodeURIComponent(invoiceRef)}`
                : '/owner/invoices',
        });
    } catch (notifyErr) {
        log.warn('notification_dispatch_failed', {
            paymentId: payment.id,
            stage: 'payment_failed',
            error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        });
    }
}

async function handleCheckoutExpired(
    admin: SupabaseClient,
    session: Record<string, unknown>,
): Promise<void> {
    const piId = session.payment_intent as string | null;
    if (!piId) return;

    const payment = await findStripePayment(admin, piId);
    if (!payment) return;
    if (TERMINAL_STATUSES.has(payment.status)) return;

    const { error } = await admin
        .from('payments')
        .update({ status: 'CANCELLED' })
        .eq('id', payment.id);
    if (error) throw error;

    log.info('webhook_checkout_expired', {
        stripePiId: piId,
        paymentId: payment.id,
    });
}
