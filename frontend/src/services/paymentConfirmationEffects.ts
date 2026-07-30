import type { SupabaseClient } from '@supabase/supabase-js';
import { scopedLogger } from '@/lib/logger';

/**
 * Effets de bord déclenchés après qu'un paiement en ligne passe à CONFIRMED :
 * reçu PDF, e-mail de confirmation, notification in-app.
 *
 * Extrait du webhook Stripe (Plan 7C-4 / 7F) pour être partagé avec le rail
 * PAYPAL. Comportement identique — même ordre, mêmes imports dynamiques, même
 * politique fail-soft.
 *
 * FAIL-SOFT : cette fonction ne throw jamais. Un paiement CONFIRMED le reste
 * même si le reçu ou l'e-mail échoue ; l'échec est logué. Le paiement est la
 * vérité comptable, la notification n'est qu'un service rendu.
 *
 * APPEL UNIQUE : l'appelant doit l'invoquer seulement après avoir *gagné* la
 * transition vers CONFIRMED (UPDATE gardé par `.eq('status', …)` renvoyant une
 * ligne). Sinon on émettrait plusieurs reçus pour un même paiement.
 *
 * Les imports de receiptService / emailService / notificationService restent
 * dynamiques : ils tirent jspdf et le client Resend, inutiles sur les chemins
 * qui n'atteignent pas la confirmation.
 */

const log = scopedLogger('payment-confirmation-effects');

export interface ConfirmedPaymentContext {
    id: string;
    shipowner_id: string;
    /** null = top-up wallet (pas de facture rattachée). */
    transaction_id: string | null;
    amount_usd_minor: number;
}

export async function applyPaymentConfirmationEffects(
    admin: SupabaseClient,
    payment: ConfirmedPaymentContext,
    confirmedAt: string,
): Promise<void> {
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
            ? {
                invoice_ref: tx.invoice_ref as string | null,
                vessel_name: tx.vessel_name as string | null,
            }
            : null;

        const ownerEmail = (owner as { official_email?: string } | null)?.official_email;
        if (ownerEmail) {
            await sendPaymentConfirmationEmail({
                to: ownerEmail,
                recipientName: ((owner as { name?: string } | null)?.name) ?? 'Shipowner',
                vesselName: (tx?.vessel_name as string | null) ?? '—',
                invoiceRef: (tx?.invoice_ref as string | null) ?? '—',
                amountUsd: (payment.amount_usd_minor ?? 0) / 100,
                paidAt: new Date(confirmedAt).toLocaleString('en-US', {
                    dateStyle: 'long',
                    timeStyle: 'short',
                }),
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

    // Notification in-app. Pour une facture, l'e-mail est déjà parti ci-dessus
    // (skipEmail). Pour un top-up, notifyOwner envoie son propre e-mail.
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
                    ? {
                        attachments: {
                            pdfBuffer: receiptBufferForNotif,
                            filename: `${receiptRefForNotif}.pdf`,
                        },
                    }
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
