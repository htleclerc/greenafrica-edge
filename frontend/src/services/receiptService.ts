import type { SupabaseClient } from '@supabase/supabase-js';
import {
    buildReceiptRef,
    generateReceiptPdf,
    type ReceiptData,
} from '@/services/invoiceService';

const RAIL_DISPLAY: Record<string, string> = {
    STRIPE:           'Card Payment (Stripe)',
    WIRE_TRANSFER:    'Wire Transfer (SWIFT)',
    CASH:             'Cash Deposit',
    CHEQUE:           'Cheque',
    LETTER_OF_CREDIT: 'Letter of Credit',
    NETTING:          'Netting Settlement',
    THIRD_PARTY:      'Third-Party Payer',
    MOBILE_MONEY:     'Mobile Money',
    BANK_GUARANTEE:   'Bank Guarantee',
    WALLET:           'Wallet Credit',
};

export interface PaymentReceiptResult {
    receiptRef: string;
    storagePath?: string;
    pdfBuffer?: Uint8Array;
    alreadyGenerated?: boolean;
}

/**
 * Generate (or fetch) the receipt for a CONFIRMED payment.
 * Idempotent: if `payments.receipt_generated_at` is set, returns the existing
 * ref without re-generating.
 *
 * Steps when generating:
 *   1. Load payment + transaction + shipowner + confirmer profile.
 *   2. Build `ReceiptData` shape expected by invoiceService.generateReceiptPdf.
 *   3. Build `receipt_ref` via buildReceiptRef(transaction_id, paid_at).
 *   4. Generate PDF buffer ONCE and upload directly to Storage `documents`
 *      bucket (avoids the double-PDF-generation cost of going through
 *      invoiceService.generateAndStoreReceipt).
 *   5. UPDATE payments with receipt_ref + storage_path + generated_at.
 *   6. Return ref + PDF buffer (caller may attach to email).
 */
export async function generatePaymentReceipt(
    client: SupabaseClient,
    paymentId: string,
): Promise<PaymentReceiptResult> {
    // 1. Load payment row
    const { data: payment, error: payErr } = await client
        .from('payments')
        .select('id, transaction_id, shipowner_id, amount_usd_minor, amount_minor, currency, rail, external_reference, confirmed_at, confirmed_by, receipt_ref, receipt_storage_path, receipt_generated_at, rail_details')
        .eq('id', paymentId)
        .single();
    if (payErr || !payment) {
        throw new Error(`Payment ${paymentId} not found: ${payErr ? JSON.stringify(payErr) : 'no row returned'}`);
    }

    // Idempotency
    if (payment.receipt_generated_at) {
        return {
            receiptRef: payment.receipt_ref as string,
            storagePath: (payment.receipt_storage_path as string | null) ?? undefined,
            alreadyGenerated: true,
        };
    }

    if (!payment.transaction_id) {
        throw new Error(`Payment ${paymentId} has no transaction_id — receipts only generated for invoice-linked payments`);
    }

    // 2. Load related rows
    const [txRes, ownerRes, confirmerRes] = await Promise.all([
        client.from('transactions').select('id, invoice_ref, vessel_name, vessel_imo, vessel_id').eq('id', payment.transaction_id).single(),
        client.from('shipowners').select('id, name, country_code').eq('id', payment.shipowner_id).single(),
        payment.confirmed_by
            ? client.from('profiles').select('id, full_name').eq('id', payment.confirmed_by).single()
            : Promise.resolve({ data: null, error: null }),
    ]);
    if (txRes.error) {
        console.error(`[receiptService] tx lookup error:`, txRes.error);
    }
    if (ownerRes.error) {
        console.error(`[receiptService] owner lookup error:`, ownerRes.error);
    }
    if (confirmerRes.error) {
        console.error(`[receiptService] confirmer lookup error:`, confirmerRes.error);
    }
    const tx = txRes.data;
    const owner = ownerRes.data;
    const confirmer = confirmerRes.data;

    if (!tx) throw new Error(`Transaction ${payment.transaction_id} not found for payment ${paymentId} (error: ${JSON.stringify(txRes.error)})`);
    if (!owner) throw new Error(`Shipowner ${payment.shipowner_id} not found for payment ${paymentId} (error: ${JSON.stringify(ownerRes.error)})`);

    let vesselMmsi = '0';
    if (tx.vessel_id) {
        const { data: vessel, error: vesErr } = await client
            .from('vessels')
            .select('mmsi')
            .eq('id', tx.vessel_id)
            .maybeSingle();
        if (vesErr) {
            console.error(`[receiptService] vessel lookup error:`, vesErr);
        }
        if (vessel?.mmsi) {
            vesselMmsi = vessel.mmsi;
        }
    }

    // 3. Build refs and timestamps
    const paidAt = payment.confirmed_at ? new Date(payment.confirmed_at as string) : new Date();
    const receiptRef = buildReceiptRef(payment.transaction_id as string, paidAt);

    // 4. Build ReceiptData
    const data: ReceiptData = {
        receiptRef,
        invoiceRef: tx.invoice_ref ?? `TX-${(tx.id as string).slice(0, 8)}`,
        vesselName: tx.vessel_name as string,
        vesselImo: tx.vessel_imo as string,
        vesselMmsi,
        ownerName: owner.name as string,
        jurisdiction: (owner.country_code as string | null) ?? '—',
        amountUsd: (payment.amount_usd_minor as number) / 100,
        paidAt: paidAt.toLocaleString('en-US', { year: 'numeric', month: 'long', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }),
        paymentMethod: RAIL_DISPLAY[payment.rail as string] ?? (payment.rail as string),
        paymentReference: (payment.external_reference as string | null) ?? undefined,
        confirmedBy: (confirmer?.full_name as string | null) ?? 'Solid Technology Finance',
    };

    // 5. Generate PDF buffer + upload to Storage directly (no double-PDF)
    const pdfBuffer = await generateReceiptPdf(data);
    const storagePath = `receipts/${receiptRef}.pdf`;
    const { error: uploadError } = await client.storage
        .from('documents')
        .upload(storagePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
        });
    if (uploadError) {
        console.error(`[receiptService] Storage upload failed for ${receiptRef}: ${uploadError.message}`);
        // Fail-hard here — no point UPDATEing the row with no PDF behind it.
        throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // 6. UPDATE payments idempotently
    const { error: updErr } = await client
        .from('payments')
        .update({
            receipt_ref: receiptRef,
            receipt_storage_path: storagePath,
            receipt_generated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);
    if (updErr) {
        // PDF already uploaded — log but don't throw. Caller can retry.
        console.error(`[receiptService] payments UPDATE failed for ${paymentId}: ${updErr.message}`);
    }

    return { receiptRef, storagePath, pdfBuffer };
}
