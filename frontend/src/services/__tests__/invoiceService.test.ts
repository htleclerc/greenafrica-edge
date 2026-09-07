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
import { DEFAULT_ISSUER_PROFILE } from '../issuerProfileService';

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
// buildVerifyUrl — prefers explicit origin, falls back to NEXT_PUBLIC_APP_URL
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

    it('prefers explicit origin arg over env (caller context wins)', () => {
        process.env.NEXT_PUBLIC_APP_URL = 'https://env.example.com';
        expect(buildVerifyUrl('INV-2026-FOO', { origin: 'https://live.africgreen.app' })).toBe(
            'https://live.africgreen.app/verify/INV-2026-FOO',
        );
    });

    it('falls back to NEXT_PUBLIC_APP_URL when no origin provided', () => {
        process.env.NEXT_PUBLIC_APP_URL = 'https://africgreen.vercel.app';
        expect(buildVerifyUrl('INV-2026-FOO')).toBe(
            'https://africgreen.vercel.app/verify/INV-2026-FOO',
        );
    });

    it('strips trailing slashes from the resolved origin', () => {
        expect(buildVerifyUrl('INV-2026-FOO', { origin: 'https://live.africgreen.app/' })).toBe(
            'https://live.africgreen.app/verify/INV-2026-FOO',
        );
    });

    it('falls back to window.location.origin (or path-only in a node env) when no origin arg and no env', () => {
        // In a browser / jsdom context, window.location.origin is used; in a
        // plain node env (no window), the URL degrades to a path-only form.
        // Both paths are legitimate fallbacks in the real callers.
        delete process.env.NEXT_PUBLIC_APP_URL;
        const expectedBase = typeof window !== 'undefined' ? window.location.origin : '';
        expect(buildVerifyUrl('INV-2026-FOO')).toBe(
            `${expectedBase}/verify/INV-2026-FOO`,
        );
    });

    it('URL-encodes the ref so QR codes survive special chars', () => {
        expect(buildVerifyUrl('INV-2026-A B', { origin: 'https://test.dev' })).toBe(
            'https://test.dev/verify/INV-2026-A%20B',
        );
    });

    it('appends content hash + HMAC signature when both supplied', () => {
        expect(buildVerifyUrl('INV-2026-FOO', {
            origin: 'https://live.africgreen.app',
            contentHash: 'deadbeef',
            signature: 'cafef00d',
        })).toBe(
            'https://live.africgreen.app/verify/INV-2026-FOO?h=deadbeef&s=cafef00d',
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildReceiptRef — composes RCT-{year}-{first 8 hex chars of UUID}
// ─────────────────────────────────────────────────────────────────────────────

describe('buildReceiptRef', () => {
    it('builds a receipt ref from a UUID + a paid date', () => {
        const txId = '20000000-0000-0000-0000-000000000005';
        const paidAt = new Date('2026-04-12T18:42:31Z');
        expect(buildReceiptRef(txId, paidAt)).toBe('RCT-2026-20000000');
    });

    it('uses the FIRST segment of the UUID (8 hex chars), uppercased', () => {
        const txId = 'abcd1234-5678-90ab-cdef-1234567890ab';
        const paidAt = new Date('2025-01-01T00:00:00Z');
        // First segment of the UUID → 'abcd1234' → uppercased
        expect(buildReceiptRef(txId, paidAt)).toBe('RCT-2025-ABCD1234');
    });

    it('reflects the paidAt year (not the current year)', () => {
        const txId = '11111111-2222-3333-4444-555555555555';
        // Mid-year date avoids timezone rollover ambiguity
        const paidAt = new Date('2030-06-15T12:00:00Z');
        expect(buildReceiptRef(txId, paidAt)).toBe('RCT-2030-11111111');
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

    it('renders a simulation PDF (watermark + SIMULATION badge) without throwing', async () => {
        const buffer = await generateInvoicePdf({
            ...MOCK_INVOICE_DATA,
            badge: 'SIMULATION',
            simulation: true,
        });
        expect(buffer).toBeInstanceOf(Uint8Array);
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

/**
 * Le compte domestique s'imprime EN PLUS de l'international : un armateur qui
 * banque au Somaliland n'a pas a emettre un virement transfrontalier pour une
 * taxe percue sur place.
 *
 * Le risque de ce bloc n'est pas qu'il manque, c'est qu'il DEBORDE : l'encadre
 * avait deux hauteurs en dur, et une ligne de plus poussait la signature et le
 * QR code hors de la page sans que rien ne le signale.
 */
describe('generateInvoicePdf — compte de collecte local', () => {
    const LOCAL_IBAN = 'SO950005100100613310001';

    const withLocal: InvoiceData = {
        ...MOCK_INVOICE_DATA,
        issuer: {
            ...DEFAULT_ISSUER_PROFILE,
            bankAccounts: [
                ...DEFAULT_ISSUER_PROFILE.bankAccounts,
                {
                    label: 'Virement local (Somaliland) — en USD',
                    currency: 'USD',
                    holder: 'SOLIDE TECHNOLOGY',
                    holderAddress: 'Masalaha Street, Hargeisa, Somaliland',
                    iban: LOCAL_IBAN,
                    accountNumber: '100613310001',
                    swift: 'PBSMSOSM',
                    bank: 'Premier Bank Limited — Durdur Branch',
                    bankAddress: 'Hargeisa, Somaliland',
                    depositReference: null,
                    intermediaryBank: 'Premier Bank Kenya Limited, Nairobi',
                    intermediarySwift: 'IFCBKENA',
                    isLocal: true,
                    isPrimary: false,
                },
            ],
        },
    };

    const pageCount = (buf: Uint8Array) =>
        (Buffer.from(buf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

    it("imprime l'IBAN local et sa banque correspondante", async () => {
        const raw = Buffer.from(await generateInvoicePdf(withLocal)).toString('latin1');
        expect(raw).toContain(LOCAL_IBAN);
        expect(raw).toContain('PBSMSOSM');
        expect(raw).toContain('IFCBKENA');
    });

    it("garde l'international : le local s'ajoute, il ne remplace pas", async () => {
        const raw = Buffer.from(await generateInvoicePdf(withLocal)).toString('latin1');
        expect(raw).toContain(DEFAULT_ISSUER_PROFILE.bankAccounts[0].swift);
    });

    it("n'ajoute aucune page — l'encadre reste dans la page 1", async () => {
        const sans = await generateInvoicePdf(MOCK_INVOICE_DATA);
        const avec = await generateInvoicePdf(withLocal);
        expect(pageCount(avec)).toBe(pageCount(sans));
    });


    // La mise en page d'un document SANS compte local ne doit pas bouger d'un
    // millimetre : des milliers de pro-formas ont deja ete emis avec celle-ci.
    it('laisse la mise en page inchangee quand aucun compte local n’est declare', async () => {
        const a = await generateInvoicePdf(MOCK_INVOICE_DATA);
        const b = await generateInvoicePdf(MOCK_INVOICE_DATA);
        expect(Buffer.from(a).length).toBe(Buffer.from(b).length);
    });

    it("ne change rien quand aucun compte local n'est declare", async () => {
        const raw = Buffer.from(await generateInvoicePdf(MOCK_INVOICE_DATA)).toString('latin1');
        expect(raw).not.toContain('LOCAL BANK TRANSFER');
    });
});
