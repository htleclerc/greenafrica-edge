import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/services/invoiceService', async () => {
    const actual = await vi.importActual<typeof import('@/services/invoiceService')>('@/services/invoiceService');
    return {
        ...actual,
        generateReceiptPdf: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])), // "%PDF" magic bytes
        buildReceiptRef: vi.fn().mockReturnValue('RCT-2026-ABCD'),
    };
});

import { generatePaymentReceipt } from './receiptService';
import { generateReceiptPdf, buildReceiptRef } from '@/services/invoiceService';

function makeClient(opts: {
    payment: Record<string, unknown> | null;
    transaction: Record<string, unknown> | null;
    shipowner: Record<string, unknown> | null;
    confirmer?: Record<string, unknown> | null;
    updateError?: { message: string } | null;
    uploadError?: { message: string } | null;
}) {
    const single = (data: unknown) => vi.fn().mockResolvedValue({ data, error: null });
    const eq = (data: unknown) => vi.fn(() => ({ single: single(data), maybeSingle: single(data) }));
    const select = (data: unknown) => vi.fn(() => ({ eq: eq(data) }));
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: opts.updateError ?? null }) }));

    const upload = vi.fn().mockResolvedValue({ data: { path: 'receipts/RCT-2026-ABCD.pdf' }, error: opts.uploadError ?? null });
    const storage = {
        from: vi.fn(() => ({ upload })),
    };

    const client = {
        from: vi.fn((table: string) => {
            if (table === 'payments')     return { select: select(opts.payment), update };
            if (table === 'transactions') return { select: select(opts.transaction) };
            if (table === 'shipowners')   return { select: select(opts.shipowner) };
            if (table === 'profiles')     return { select: select(opts.confirmer ?? null) };
            return { select: select(null) };
        }),
        storage,
    } as unknown as SupabaseClient;

    return { client, upload, storage };
}

describe('generatePaymentReceipt', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('builds RCT ref, stores PDF, and updates payments row idempotently', async () => {
        const { client, upload, storage } = makeClient({
            payment: {
                id: 'pay-1', transaction_id: 'tx-1', shipowner_id: 'own-1',
                amount_usd_minor: 50000, currency: 'USD', rail: 'WIRE_TRANSFER',
                external_reference: 'SWIFT-123', confirmed_at: '2026-05-10T10:00:00Z',
                confirmed_by: 'admin-1', receipt_generated_at: null,
            },
            transaction: {
                id: 'tx-1', invoice_ref: 'INV-2026-ABCD',
                vessel_name: 'TEST VESSEL', vessel_imo: '9999999', vessel_mmsi: '0',
            },
            shipowner: { id: 'own-1', name: 'Acme Shipping', jurisdiction_country: 'KE' },
            confirmer: { id: 'admin-1', full_name: 'Jane Admin' },
        });

        const result = await generatePaymentReceipt(client, 'pay-1');

        expect(result.receiptRef).toBe('RCT-2026-ABCD');
        expect(buildReceiptRef).toHaveBeenCalledWith('tx-1', expect.any(Date));
        // PDF generated EXACTLY ONCE (no double-PDF via generateAndStoreReceipt)
        expect(generateReceiptPdf).toHaveBeenCalledTimes(1);
        // Direct storage upload happened
        expect(storage.from).toHaveBeenCalledWith('documents');
        expect(upload).toHaveBeenCalledWith(
            'receipts/RCT-2026-ABCD.pdf',
            expect.any(Uint8Array),
            expect.objectContaining({ contentType: 'application/pdf', upsert: true }),
        );
        expect(result.storagePath).toBe('receipts/RCT-2026-ABCD.pdf');
        expect(result.pdfBuffer).toBeInstanceOf(Uint8Array);
        expect(result.pdfBuffer![0]).toBe(0x25); // %PDF magic
    });

    it('returns null + reason when receipt already generated (idempotent)', async () => {
        const { client } = makeClient({
            payment: {
                id: 'pay-1', transaction_id: 'tx-1', shipowner_id: 'own-1',
                amount_usd_minor: 50000, currency: 'USD', rail: 'WIRE_TRANSFER',
                receipt_ref: 'RCT-2026-EXIST', receipt_generated_at: '2026-05-10T11:00:00Z',
            },
            transaction: null, shipowner: null,
        });
        const result = await generatePaymentReceipt(client, 'pay-1');
        expect(result.receiptRef).toBe('RCT-2026-EXIST');
        expect(result.pdfBuffer).toBeUndefined();
        expect(result.alreadyGenerated).toBe(true);
        expect(generateReceiptPdf).not.toHaveBeenCalled();
    });

    it('throws when payment not found', async () => {
        const { client } = makeClient({ payment: null, transaction: null, shipowner: null });
        await expect(generatePaymentReceipt(client, 'pay-missing')).rejects.toThrow(/not found/i);
    });

    it('throws when transaction is null but payment.transaction_id is set', async () => {
        const { client } = makeClient({
            payment: {
                id: 'pay-1', transaction_id: 'tx-1', shipowner_id: 'own-1',
                amount_usd_minor: 50000, currency: 'USD', rail: 'WIRE_TRANSFER',
                receipt_generated_at: null,
            },
            transaction: null, shipowner: { id: 'own-1', name: 'X' },
        });
        await expect(generatePaymentReceipt(client, 'pay-1')).rejects.toThrow(/transaction/i);
    });

    it('throws when storage upload fails (no payments row updated)', async () => {
        const { client } = makeClient({
            payment: {
                id: 'pay-1', transaction_id: 'tx-1', shipowner_id: 'own-1',
                amount_usd_minor: 50000, currency: 'USD', rail: 'WIRE_TRANSFER',
                confirmed_at: '2026-05-10T10:00:00Z', confirmed_by: 'admin-1',
                receipt_generated_at: null,
            },
            transaction: {
                id: 'tx-1', invoice_ref: 'INV-2026-ABCD',
                vessel_name: 'TEST', vessel_imo: '9999999', vessel_mmsi: '0',
            },
            shipowner: { id: 'own-1', name: 'Acme', jurisdiction_country: 'KE' },
            confirmer: { id: 'admin-1', full_name: 'Jane' },
            uploadError: { message: 'bucket not found' },
        });
        await expect(generatePaymentReceipt(client, 'pay-1')).rejects.toThrow(/Storage upload failed/);
    });
});
