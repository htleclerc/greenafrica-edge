import { describe, it, expect } from 'vitest';
import { buildInvoiceDownloadUrl } from './invoiceDownloadLink';

const SIGNED = {
    invoice_ref: 'PRO-2026-abcd1234',
    content_hash: 'f'.repeat(64),
    invoice_pdf_url: 'invoices/proforma-PRO-2026-abcd1234.pdf',
};

describe('buildInvoiceDownloadUrl', () => {
    it('builds a signed download URL when ref, hash and stored PDF are all present', () => {
        const url = buildInvoiceDownloadUrl(SIGNED);
        expect(url).toMatch(/^\/api\/invoices\/PRO-2026-abcd1234\/download\?h=f{64}&s=[0-9a-f]{64}$/);
    });

    // REGRESSION GUARD (2026-07-24) — the owner portal used to build a link from
    // ref + hash alone. Rows whose PDF was never rendered (seeded transactions)
    // got a link that always 404s at /api/invoices/[ref]/download, which checks
    // invoice_pdf_url. No stored document → no link.
    it('returns null when the PDF was never uploaded', () => {
        expect(buildInvoiceDownloadUrl({ ...SIGNED, invoice_pdf_url: null })).toBeNull();
    });

    it('returns null when the transaction has no invoice ref', () => {
        expect(buildInvoiceDownloadUrl({ ...SIGNED, invoice_ref: null })).toBeNull();
    });

    it('returns null when the transaction was never content-hashed', () => {
        expect(buildInvoiceDownloadUrl({ ...SIGNED, content_hash: null })).toBeNull();
    });

    it('percent-encodes the ref so a slash in it cannot escape the route segment', () => {
        const url = buildInvoiceDownloadUrl({ ...SIGNED, invoice_ref: 'PRO/2026' });
        expect(url).toContain('/api/invoices/PRO%2F2026/download');
    });
});
