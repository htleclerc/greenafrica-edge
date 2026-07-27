// Builds the HMAC-signed link the owner portal uses to fetch a fiscal document.
// Server-only: signInvoiceRef reads the signing secret.

import { signInvoiceRef } from './invoiceService';

export interface InvoiceDocumentColumns {
    invoice_ref: string | null;
    content_hash: string | null;
    /** Storage path inside the private `documents` bucket, NULL until the PDF is rendered. */
    invoice_pdf_url: string | null;
}

/**
 * Returns the signed download URL for a transaction's document, or null when
 * no document exists yet.
 *
 * All three columns are required. `invoice_pdf_url` in particular is what
 * /api/invoices/[ref]/download resolves the storage object from — a row that
 * carries a ref and a hash but no stored PDF (e.g. seeded directly into the
 * DB, or signed before the render failed) would otherwise yield a link that
 * always 404s. Better to surface "not issued" than a dead link.
 */
export function buildInvoiceDownloadUrl(txn: InvoiceDocumentColumns): string | null {
    const { invoice_ref: ref, content_hash: hash, invoice_pdf_url: pdfPath } = txn;
    if (!ref || !hash || !pdfPath) return null;
    const sig = signInvoiceRef(ref, hash);
    return `/api/invoices/${encodeURIComponent(ref)}/download?h=${hash}&s=${sig}`;
}
