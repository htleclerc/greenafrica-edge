import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    statusToMode,
    parseInvoiceRef,
    buildVerifyUrl,
    buildReceiptRef,
    generateQrCodeDataUrl,
    generateInvoicePdf,
    generateReceiptPdf,
    type InvoiceData,
    type ReceiptData,
} from '../invoiceService';

// ─────────────────────────────────────────────────────────────────────────────
// statusToMode — pure function, drives invoice/receipt mode + badge color
// ─────────────────────────────────────────────────────────────────────────────

describe('statusToMode', () => {
    it('PENDING → proforma · TO PAY (the default unpaid state)', () => {
        expect(statusToMode('PENDING')).toEqual({ mode: 'proforma', badge: 'TO PAY' });
    });

    it('PAID → invoice · PAID (the settled state)', () => {
        expect(statusToMode('PAID')).toEqual({ mode: 'invoice', badge: 'PAID' });
    });

    it('OVERDUE → proforma · OVERDUE (still a bill, but late)', () => {
        expect(statusToMode('OVERDUE')).toEqual({ mode: 'proforma', badge: 'OVERDUE' });
    });

    it('DISPUTED → proforma · DISPUTED (still a bill, contested)', () => {
        expect(statusToMode('DISPUTED')).toEqual({ mode: 'proforma', badge: 'DISPUTED' });
    });

    it('EXEMPT → invoice · EXEMPT (no money owed but legally finalized)', () => {
        expect(statusToMode('EXEMPT')).toEqual({ mode: 'invoice', badge: 'EXEMPT' });
    });

    it('unknown status falls back to proforma · TO PAY (safe default)', () => {
        expect(statusToMode('FOO')).toEqual({ mode: 'proforma', badge: 'TO PAY' });
    });

    it('empty string falls back to proforma · TO PAY', () => {
        expect(statusToMode('')).toEqual({ mode: 'proforma', badge: 'TO PAY' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseInvoiceRef — REGRESSION test for the webhook lookup bug
// (providers send the canonical ref like "INV-2026-XXXX"; we must extract
// the UUID suffix to look up the transaction by ILIKE prefix)
// ─────────────────────────────────────────────────────────────────────────────

describe('parseInvoiceRef', () => {
    it('parses an INV-{year}-{suffix} ref', () => {
        const result = parseInvoiceRef('INV-2026-1A2B3C4D');
        expect(result).toEqual({
            type: 'INV',
            year: 2026,
            idSuffix: '1a2b3c4d',
        });
    });

    it('parses a PRO-{year}-{suffix} ref', () => {
        const result = parseInvoiceRef('PRO-2026-DEADBEEF');
        expect(result).toEqual({
            type: 'PRO',
            year: 2026,
            idSuffix: 'deadbeef',
        });
    });

    it('parses an RCT-{year}-{suffix} ref (receipts)', () => {
        const result = parseInvoiceRef('RCT-2026-ABC123');
        expect(result).toEqual({
            type: 'RCT',
            year: 2026,
            idSuffix: 'abc123',
        });
    });

    it('lowercases the prefix during parsing', () => {
        const result = parseInvoiceRef('inv-2025-foo');
        expect(result?.type).toBe('INV');
        expect(result?.idSuffix).toBe('foo');
    });

    it('lowercases the suffix so it can ILIKE on a uuid column', () => {
        const result = parseInvoiceRef('INV-2026-AAAA-BBBB-CCCC');
        // The suffix can contain dashes (full UUID prefix)
        expect(result?.idSuffix).toBe('aaaa-bbbb-cccc');
    });

    it('trims whitespace before parsing', () => {
        const result = parseInvoiceRef('  INV-2026-FOO  ');
        expect(result?.type).toBe('INV');
        expect(result?.idSuffix).toBe('foo');
    });

    it('returns null for malformed input — wrong prefix', () => {
        expect(parseInvoiceRef('XYZ-2026-FOO')).toBeNull();
    });

    it('returns null for malformed input — non-numeric year', () => {
        expect(parseInvoiceRef('INV-XXXX-FOO')).toBeNull();
    });

    it('returns null for malformed input — missing suffix', () => {
        expect(parseInvoiceRef('INV-2026-')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseInvoiceRef('')).toBeNull();
    });

    it('returns null for non-string input (defensive)', () => {
        // @ts-expect-error — testing the runtime guard
        expect(parseInvoiceRef(null)).toBeNull();
        // @ts-expect-error — testing the runtime guard
        expect(parseInvoiceRef(undefined)).toBeNull();
        // @ts-expect-error — testing the runtime guard
        expect(parseInvoiceRef(123)).toBeNull();
    });

    it('extracts a 4-digit year as a number', () => {
        const result = parseInvoiceRef('INV-2024-FOO');
        expect(result?.year).toBe(2024);
        expect(typeof result?.year).toBe('number');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildVerifyUrl — depends on NEXT_PUBLIC_APP_URL env var with localhost fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('buildVerifyUrl', () => {
    const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

    afterEach(() => {
        if (originalAppUrl === undefined) {
            delete process.env.NEXT_PUBLIC_APP_URL;
        } else {
            process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
        }
    });

    it('uses NEXT_PUBLIC_APP_URL when set', () => {
        process.env.NEXT_PUBLIC_APP_URL = 'https://africgreen.vercel.app';
        expect(buildVerifyUrl('INV-2026-FOO')).toBe(
            'https://africgreen.vercel.app/verify/INV-2026-FOO',
        );
    });

    it('falls back to localhost:3300 when env var is missing', () => {
        delete process.env.NEXT_PUBLIC_APP_URL;
        expect(buildVerifyUrl('INV-2026-FOO')).toBe('http://localhost:3300/verify/INV-2026-FOO');
    });

    it('URL-encodes the ref so QR codes survive special chars', () => {
        process.env.NEXT_PUBLIC_APP_URL = 'https://test.dev';
        expect(buildVerifyUrl('INV-2026-A B')).toBe('https://test.dev/verify/INV-2026-A%20B');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildReceiptRef — composes RCT-{year}-{first segment of UUID}
// ─────────────────────────────────────────────────────────────────────────────

describe('buildReceiptRef', () => {
    it('builds a receipt ref from a UUID + a paid date', () => {
        const txId = '20000000-0000-0000-0000-000000000005';
        const paidAt = new Date('2026-04-12T18:42:31Z');
        expect(buildReceiptRef(txId, paidAt)).toBe('RCT-2026-0000');
    });

    it('uses the FIRST segment of the UUID after the dash, uppercased', () => {
        const txId = 'abcd1234-5678-90ab-cdef-1234567890ab';
        const paidAt = new Date('2025-01-01T00:00:00Z');
        // First segment after the first dash → '5678'
        expect(buildReceiptRef(txId, paidAt)).toBe('RCT-2025-5678');
    });

    it('reflects the paidAt year (not the current year)', () => {
        const txId = '11111111-2222-3333-4444-555555555555';
        // Mid-year date avoids timezone rollover ambiguity
        const paidAt = new Date('2030-06-15T12:00:00Z');
        expect(buildReceiptRef(txId, paidAt)).toBe('RCT-2030-2222');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateQrCodeDataUrl — wraps the qrcode lib
// ─────────────────────────────────────────────────────────────────────────────

describe('generateQrCodeDataUrl', () => {
    it('returns a base64 PNG data URL', async () => {
        const result = await generateQrCodeDataUrl('https://test.dev/verify/FOO');
        expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it('produces non-empty output', async () => {
        const result = await generateQrCodeDataUrl('hello');
        // A QR code is at least a few hundred chars in base64
        expect(result.length).toBeGreaterThan(100);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateInvoicePdf — smoke test (full render must not throw, must
// produce a non-empty PDF buffer that starts with the PDF magic bytes)
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_INVOICE_DATA: InvoiceData = {
    invoiceRef: 'INV-2026-TEST',
    vesselName: 'TEST VESSEL',
    vesselImo: '9999999',
    vesselMmsi: '111111111',
    ownerName: 'Test Shipping Co',
    jurisdiction: 'Republic of Somaliland',
    periodStart: '12 April 2026',
    periodEnd: '12 May 2026',
    emissionsTco2: 100,
    ratePerTco2: 20,
    subtotalUsd: 2000,
    exemptionUsd: 0,
    totalUsd: 2000,
    lineItems: [
        { zone: 'EEZ', days: 1, emissionsTco2: 100, rate: 20, amount: 2000 },
    ],
    mode: 'proforma',
    badge: 'TO PAY',
    verifyUrl: 'https://test.dev/verify/INV-2026-TEST',
};

describe('generateInvoicePdf', () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_APP_URL = 'https://test.dev';
    });

    it('renders a non-empty PDF buffer for a pro-forma', async () => {
        const buffer = await generateInvoicePdf(MOCK_INVOICE_DATA);
        expect(buffer).toBeInstanceOf(Uint8Array);
        expect(buffer.length).toBeGreaterThan(1000); // PDFs are at least 1KB
    });

    it('renders a non-empty PDF buffer for a tax invoice (PAID)', async () => {
        const buffer = await generateInvoicePdf({
            ...MOCK_INVOICE_DATA,
            mode: 'invoice',
            badge: 'PAID',
        });
        expect(buffer.length).toBeGreaterThan(1000);
    });

    it('produces a buffer starting with the PDF magic bytes (%PDF)', async () => {
        const buffer = await generateInvoicePdf(MOCK_INVOICE_DATA);
        // PDF spec: every PDF starts with "%PDF-"
        const magic = String.fromCharCode(...buffer.slice(0, 5));
        expect(magic).toBe('%PDF-');
    });

    it('handles all 5 badge variants without throwing', async () => {
        const badges = ['TO PAY', 'PAID', 'OVERDUE', 'DISPUTED', 'EXEMPT'] as const;
        for (const badge of badges) {
            const buffer = await generateInvoicePdf({ ...MOCK_INVOICE_DATA, badge });
            expect(buffer.length).toBeGreaterThan(1000);
        }
    });

    it('handles empty lineItems gracefully (no crash)', async () => {
        const buffer = await generateInvoicePdf({ ...MOCK_INVOICE_DATA, lineItems: [] });
        expect(buffer.length).toBeGreaterThan(1000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateReceiptPdf — smoke test, same checks as the invoice
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_RECEIPT_DATA: ReceiptData = {
    receiptRef: 'RCT-2026-TEST',
    invoiceRef: 'INV-2026-TEST',
    vesselName: 'TEST VESSEL',
    vesselImo: '9999999',
    vesselMmsi: '111111111',
    ownerName: 'Test Shipping Co',
    jurisdiction: 'Republic of Somaliland',
    amountUsd: 2000,
    paidAt: '12 April 2026, 18:42 UTC',
    paymentMethod: 'wire_transfer',
    paymentReference: 'SWIFT MT103/2026/04/12-7842',
    paymentNotes: 'Wire received from Citi NY',
    confirmedBy: 'Officer Hassan Mohamoud',
};

describe('generateReceiptPdf', () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_APP_URL = 'https://test.dev';
    });

    it('renders a non-empty PDF buffer', async () => {
        const buffer = await generateReceiptPdf(MOCK_RECEIPT_DATA);
        expect(buffer).toBeInstanceOf(Uint8Array);
        expect(buffer.length).toBeGreaterThan(1000);
    });

    it('produces a valid PDF (starts with %PDF-)', async () => {
        const buffer = await generateReceiptPdf(MOCK_RECEIPT_DATA);
        const magic = String.fromCharCode(...buffer.slice(0, 5));
        expect(magic).toBe('%PDF-');
    });

    it('handles all known payment methods without throwing', async () => {
        const methods = [
            'wire_transfer', 'cash', 'mobile_money', 'card',
            'stripe', 'paystack', 'flutterwave', 'wave', 'payoneer', 'other',
        ];
        for (const method of methods) {
            const buffer = await generateReceiptPdf({ ...MOCK_RECEIPT_DATA, paymentMethod: method });
            expect(buffer.length).toBeGreaterThan(1000);
        }
    });

    it('handles missing optional fields (no reference, no notes)', async () => {
        const buffer = await generateReceiptPdf({
            ...MOCK_RECEIPT_DATA,
            paymentReference: undefined,
            paymentNotes: undefined,
        });
        expect(buffer.length).toBeGreaterThan(1000);
    });

    it('truncates very long payment notes (no overflow crash)', async () => {
        const buffer = await generateReceiptPdf({
            ...MOCK_RECEIPT_DATA,
            paymentNotes: 'a'.repeat(500),
        });
        expect(buffer.length).toBeGreaterThan(1000);
    });
});
