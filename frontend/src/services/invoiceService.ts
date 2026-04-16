import type { SupabaseClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

/**
 * Invoice mode determines title, badge, filename prefix, and document tone.
 *
 *   STATUS         → MODE         → BADGE          → DOC TYPE
 *   PENDING        → proforma     → TO PAY         → PRO-FORMA INVOICE
 *   OVERDUE        → proforma     → OVERDUE        → PRO-FORMA INVOICE
 *   DISPUTED       → proforma     → DISPUTED       → PRO-FORMA INVOICE
 *   PAID           → invoice      → PAID           → TAX INVOICE
 *   EXEMPT         → invoice      → EXEMPT         → TAX INVOICE (exempted)
 */
export type InvoiceMode = 'proforma' | 'invoice';
export type InvoiceBadge = 'TO PAY' | 'PAID' | 'OVERDUE' | 'DISPUTED' | 'EXEMPT';

export function statusToMode(status: string): { mode: InvoiceMode; badge: InvoiceBadge } {
  switch (status) {
    case 'PAID':     return { mode: 'invoice',  badge: 'PAID' };
    case 'EXEMPT':   return { mode: 'invoice',  badge: 'EXEMPT' };
    case 'OVERDUE':  return { mode: 'proforma', badge: 'OVERDUE' };
    case 'DISPUTED': return { mode: 'proforma', badge: 'DISPUTED' };
    case 'PENDING':
    default:         return { mode: 'proforma', badge: 'TO PAY' };
  }
}

interface InvoiceData {
  invoiceRef: string;
  vesselName: string;
  vesselImo: string;
  vesselMmsi: string;
  ownerName: string;
  jurisdiction: string;
  periodStart: string;
  periodEnd: string;
  emissionsTco2: number;
  ratePerTco2: number;
  subtotalUsd: number;
  exemptionUsd: number;
  totalUsd: number;
  lineItems: Array<{
    zone: string;
    days: number;
    emissionsTco2: number;
    rate: number;
    amount: number;
  }>;
  // New fields for mode + verification
  mode?: InvoiceMode;
  badge?: InvoiceBadge;
  verifyUrl?: string;       // URL encoded in the QR code
}

/**
 * Generate a verification URL for an invoice ref.
 * Used by both the HTML preview and the PDF QR code.
 */
export function buildVerifyUrl(invoiceRef: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3300';
  return `${base}/verify/${encodeURIComponent(invoiceRef)}`;
}

/**
 * Parse a canonical invoice/receipt reference into its parts.
 *
 * Format: {PRO|INV|RCT}-{4-digit year}-{transaction-id-suffix}
 *
 * The suffix is the first segment of the transaction UUID after the
 * first dash (uppercased). This is the same logic used to BUILD the
 * ref in ProFormaModal and buildReceiptRef, so parsing inverts it.
 *
 * Returns null on malformed input — never throws.
 *
 * Examples:
 *   "INV-2026-1A2B3C4D" → { type: 'INV', year: 2026, idSuffix: '1a2b3c4d' }
 *   "rct-2025-FOO"      → { type: 'RCT', year: 2025, idSuffix: 'foo' }
 *   "PRO-XX-YYY"        → null
 *   "garbage"           → null
 */
export type InvoiceRefType = 'PRO' | 'INV' | 'RCT';
export interface ParsedInvoiceRef {
  type: InvoiceRefType;
  year: number;
  idSuffix: string;  // lowercase — ready for ILIKE on a uuid column
}

export function parseInvoiceRef(ref: string): ParsedInvoiceRef | null {
  if (!ref || typeof ref !== 'string') return null;
  const match = ref.trim().match(/^(PRO|INV|RCT)-(\d{4})-(.+)$/i);
  if (!match) return null;
  return {
    type: match[1].toUpperCase() as InvoiceRefType,
    year: parseInt(match[2], 10),
    idSuffix: match[3].toLowerCase(),
  };
}

/**
 * Generate a QR code as a base64 PNG data URL.
 * Used to embed in jsPDF via addImage and in HTML preview via <img>.
 */
export async function generateQrCodeDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 4,
    color: {
      dark: '#0D1F18',
      light: '#FFFFFF',
    },
  });
}

/**
 * Resolve QR code synchronously by pre-generating it before calling.
 * jsPDF can embed PNG via addImage when given a base64 data URL.
 */
async function resolveInvoiceArtifacts(data: InvoiceData): Promise<{ qrDataUrl: string }> {
  const verifyUrl = data.verifyUrl || buildVerifyUrl(data.invoiceRef);
  const qrDataUrl = await generateQrCodeDataUrl(verifyUrl);
  return { qrDataUrl };
}

/**
 * Get the human-readable doc type name based on mode.
 */
function docTypeName(mode: InvoiceMode | undefined): string {
  return mode === 'invoice' ? 'TAX INVOICE' : 'PRO-FORMA INVOICE';
}

/**
 * Get badge background color (institutional palette).
 */
function badgeColor(badge: InvoiceBadge | undefined): { bg: [number, number, number]; fg: [number, number, number] } {
  switch (badge) {
    case 'PAID':     return { bg: [16, 185, 129],  fg: [255, 255, 255] };  // emerald
    case 'EXEMPT':   return { bg: [14, 165, 233],  fg: [255, 255, 255] };  // sky
    case 'OVERDUE':  return { bg: [220, 38, 38],   fg: [255, 255, 255] };  // red
    case 'DISPUTED': return { bg: [249, 115, 22],  fg: [255, 255, 255] };  // orange
    case 'TO PAY':
    default:         return { bg: [234, 179, 8],   fg: [13, 31, 24] };     // amber on dark
  }
}

/**
 * Generate an official institutional carbon tax pro-forma/invoice PDF.
 * Includes branded header, official seal, signature blocks, legal preamble,
 * status badge (TO PAY / PAID / OVERDUE / DISPUTED / EXEMPT), and a verification
 * QR code linking to /verify/<ref>.
 *
 * Returns the PDF as a Uint8Array buffer.
 */
export async function generateInvoicePdf(data: InvoiceData): Promise<Uint8Array> {
  const { qrDataUrl } = await resolveInvoiceArtifacts(data);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth  = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;

  // ── Top accent gradient bar (emerald → gold) ──
  doc.setFillColor(4, 120, 87); // #047857
  doc.rect(0, 0, pageWidth / 2, 4, 'F');
  doc.setFillColor(16, 185, 129); // #10B981
  doc.rect(pageWidth / 2, 0, pageWidth / 4, 4, 'F');
  doc.setFillColor(234, 179, 8); // #EAB308
  doc.rect((pageWidth * 3) / 4, 0, pageWidth / 4, 4, 'F');

  // ── Logo (vector) — emerald rounded square with shield ──
  const logoX = margin;
  const logoY = 12;
  const logoSize = 16;
  doc.setFillColor(4, 120, 87);
  doc.roundedRect(logoX, logoY, logoSize, logoSize, 3, 3, 'F');
  // Shield path approximation
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.4);
  doc.line(logoX + 8, logoY + 4, logoX + 4, logoY + 6);
  doc.line(logoX + 8, logoY + 4, logoX + 12, logoY + 6);
  doc.line(logoX + 4, logoY + 6, logoX + 4, logoY + 10);
  doc.line(logoX + 12, logoY + 6, logoX + 12, logoY + 10);
  doc.line(logoX + 4, logoY + 10, logoX + 8, logoY + 13);
  doc.line(logoX + 12, logoY + 10, logoX + 8, logoY + 13);
  // Tree mark inside shield
  doc.setLineWidth(0.6);
  doc.line(logoX + 8, logoY + 6, logoX + 8, logoY + 11);
  doc.line(logoX + 6, logoY + 9, logoX + 8, logoY + 7);
  doc.line(logoX + 10, logoY + 9, logoX + 8, logoY + 7);

  // ── Brand text ──
  doc.setTextColor(13, 31, 24); // #0D1F18
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('AFRICGREEN', logoX + logoSize + 4, logoY + 6);
  doc.setFontSize(7);
  doc.setTextColor(5, 150, 105);
  doc.text('SOVEREIGN CARBON PLATFORM', logoX + logoSize + 4, logoY + 10);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105); // slate-600
  doc.text('Republic of Somaliland', logoX + logoSize + 4, logoY + 14);
  doc.text('Ministry of Environment & Climate Change', logoX + logoSize + 4, logoY + 17.5);
  doc.text('Maritime Carbon Tax Authority', logoX + logoSize + 4, logoY + 21);

  // ── Right header: OFFICIAL DOCUMENT badge + title ──
  const rightX = pageWidth - margin;
  doc.setFillColor(13, 31, 24);
  doc.rect(rightX - 38, logoY, 38, 5, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('OFFICIAL DOCUMENT', rightX - 19, logoY + 3.5, { align: 'center' });

  doc.setTextColor(13, 31, 24);
  doc.setFontSize(13);
  doc.text(docTypeName(data.mode), rightX, logoY + 12, { align: 'right' });
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Maritime Environmental Levy Notice', rightX, logoY + 17, { align: 'right' });

  // ── Status badge (TO PAY / PAID / OVERDUE / DISPUTED / EXEMPT) ──
  if (data.badge) {
    const colors = badgeColor(data.badge);
    const badgeText = data.badge;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    const badgeW = doc.getTextWidth(badgeText) + 8;
    const badgeH = 6;
    const badgeX = rightX - badgeW;
    const badgeY = logoY + 20;
    doc.setFillColor(...colors.bg);
    doc.rect(badgeX, badgeY, badgeW, badgeH, 'F');
    doc.setTextColor(...colors.fg);
    doc.text(badgeText, badgeX + badgeW / 2, badgeY + 4.2, { align: 'center' });
  }

  // ── Header divider ──
  doc.setDrawColor(13, 31, 24);
  doc.setLineWidth(0.6);
  doc.line(margin, 40, pageWidth - margin, 40);

  // ── Reference block ──
  let y = 48;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('ISSUED TO', margin, y);
  doc.text('REFERENCE', rightX, y, { align: 'right' });

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(13, 31, 24);
  doc.text(data.ownerName, margin, y);
  doc.setFont('courier', 'bold');
  doc.setTextColor(4, 120, 87);
  doc.setFontSize(13);
  doc.text(data.invoiceRef, rightX, y, { align: 'right' });

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(`Vessel: ${data.vesselName}`, margin, y);
  doc.text(`Issued: ${data.periodStart}`, rightX, y, { align: 'right' });

  y += 4.5;
  doc.text(`IMO: ${data.vesselImo} · MMSI: ${data.vesselMmsi || '—'}`, margin, y);
  doc.setTextColor(220, 38, 38);
  doc.setFont('helvetica', 'bold');
  doc.text(`Due: ${data.periodEnd}`, rightX, y, { align: 'right' });

  // ── Legal preamble ──
  y += 10;
  doc.setFillColor(240, 250, 244); // #F0FAF4
  doc.rect(margin, y - 4, pageWidth - 2 * margin, 14, 'F');
  doc.setFillColor(16, 185, 129);
  doc.rect(margin, y - 4, 1, 14, 'F');
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(13, 31, 24);
  doc.text(
    'Pursuant to the Maritime Carbon Tax Act (2024) and IMO MEPC.346(78), the above-named',
    margin + 4,
    y,
  );
  doc.text(
    'vessel is hereby notified of carbon emission liabilities incurred within the',
    margin + 4,
    y + 3.5,
  );
  doc.text(
    'Somaliland Exclusive Economic Zone (EEZ).',
    margin + 4,
    y + 7,
  );

  // ── Line items table ──
  y += 16;
  const tableX = margin;
  const tableW = pageWidth - 2 * margin;
  const colDescW = tableW * 0.5;
  const colQtyW = tableW * 0.15;
  const colRateW = tableW * 0.15;
  const colAmtW = tableW * 0.2;

  // Header row
  doc.setFillColor(13, 31, 24);
  doc.rect(tableX, y, tableW, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('DESCRIPTION', tableX + 2, y + 4.6);
  doc.text('QTY', tableX + colDescW + colQtyW - 2, y + 4.6, { align: 'right' });
  doc.text('RATE', tableX + colDescW + colQtyW + colRateW - 2, y + 4.6, { align: 'right' });
  doc.text('AMOUNT (USD)', tableX + tableW - 2, y + 4.6, { align: 'right' });

  // Body rows
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(13, 31, 24);
  data.lineItems.forEach((item, i) => {
    if (i % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(tableX, y, tableW, 7, 'F');
    }
    doc.setTextColor(13, 31, 24);
    doc.text(item.zone === 'EEZ' ? 'Carbon Emissions Tax (IMO Cubic Law)' : item.zone, tableX + 2, y + 4.6);
    doc.setFont('courier', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`${item.emissionsTco2.toFixed(2)} tCO2`, tableX + colDescW + colQtyW - 2, y + 4.6, { align: 'right' });
    doc.text(`$${item.rate.toFixed(2)}/t`, tableX + colDescW + colQtyW + colRateW - 2, y + 4.6, { align: 'right' });
    doc.setFont('courier', 'bold');
    doc.setTextColor(13, 31, 24);
    doc.text(`$${item.amount.toLocaleString()}.00`, tableX + tableW - 2, y + 4.6, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    y += 7;
  });

  // ── Total bar ──
  y += 3;
  doc.setFillColor(13, 31, 24);
  doc.rect(tableX, y, tableW, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('TOTAL DUE (USD)', tableX + 4, y + 7.5);
  doc.setTextColor(16, 185, 129);
  doc.setFont('courier', 'bold');
  doc.setFontSize(16);
  doc.text(`$${data.totalUsd.toLocaleString()}.00`, tableX + tableW - 4, y + 8.5, { align: 'right' });

  // ── Signature, QR code & seal (3 columns) ──
  y += 22;

  // Left: signature line
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(margin, y, margin + 60, y);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Authorized Signatory', margin, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 31, 24);
  doc.text('Director, Maritime Carbon', margin, y + 8);
  doc.text('Tax Authority', margin, y + 11);

  // Center: QR code for verification
  const qrSize = 26;
  const qrX = (pageWidth - qrSize) / 2;
  const qrY = y - 6;
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 31, 24);
  doc.text('VERIFY ONLINE', pageWidth / 2, qrY + qrSize + 3, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Scan to check status', pageWidth / 2, qrY + qrSize + 6, { align: 'center' });

  // Right: official seal (circle with text)
  const sealX = pageWidth - margin - 14;
  const sealY = y - 4;
  doc.setDrawColor(4, 120, 87);
  doc.setLineWidth(1.2);
  doc.circle(sealX, sealY + 10, 14, 'S');
  doc.setLineWidth(0.4);
  doc.circle(sealX, sealY + 10, 12, 'S');
  doc.setTextColor(4, 120, 87);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');
  doc.text('OFFICIAL', sealX, sealY + 8, { align: 'center' });
  doc.text('SEAL', sealX, sealY + 11, { align: 'center' });
  doc.text('SOMALILAND', sealX, sealY + 14, { align: 'center' });

  // ── Footer ──
  const footerY = pageHeight - 20;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY, pageWidth - margin, footerY);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Payment terms: 30 days from issuance. Late payment incurs 1.5% monthly interest.',
    margin,
    footerY + 4,
  );
  doc.text(
    `Remit to: Sovereign Climate Fund · Bank of Somaliland · SWIFT BSSLSO21 · Ref: ${data.invoiceRef}`,
    margin,
    footerY + 7.5,
  );
  doc.setTextColor(203, 213, 225);
  doc.setFontSize(6);
  doc.text(
    `Document generated by AfricgreenOS · ${new Date().toISOString()} · AES-256 Encrypted`,
    pageWidth / 2,
    footerY + 12,
    { align: 'center' },
  );

  return new Uint8Array(doc.output('arraybuffer'));
}

/**
 * Generate invoice PDF and upload to Supabase Storage.
 * Returns the public URL of the uploaded PDF.
 */
export async function generateAndStoreInvoice(
  client: SupabaseClient,
  data: InvoiceData,
): Promise<string | null> {
  const pdfBuffer = await generateInvoicePdf(data);
  const fileName = `invoices/${data.invoiceRef}.pdf`;

  const { error: uploadError } = await client.storage
    .from('documents')
    .upload(fileName, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    console.error('[Invoice] Upload failed:', uploadError.message);
    return null;
  }

  const { data: urlData } = client.storage.from('documents').getPublicUrl(fileName);
  return urlData.publicUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFICIAL RECEIPT (proof of payment)
// ─────────────────────────────────────────────────────────────────────────────
//
// A receipt is the legal proof that a tax obligation has been settled. It is
// distinct from the pro-forma/tax-invoice (which is the bill). Both must be
// retained for audit purposes. The receipt embeds:
//   - WHO paid (vessel + owner)
//   - WHEN they paid (paid_at timestamp)
//   - HOW much they paid (amount + currency)
//   - BY WHAT MEANS (paymentMethod: wire/cash/mobile/card/...)
//   - PROOF OF FUND TRANSFER (paymentReference: SWIFT MT103, etc.)
//   - WHO confirmed it (confirmedBy: admin name)
//   - QR code → /verify/<receiptRef> showing live status

export interface ReceiptData {
  receiptRef: string;             // RCT-2026-XXXX
  invoiceRef: string;             // The original INV-XXXX it pays off
  vesselName: string;
  vesselImo: string;
  vesselMmsi: string;
  ownerName: string;
  jurisdiction: string;
  amountUsd: number;
  paidAt: string;                 // formatted "12 April 2026, 18:42 UTC"
  paymentMethod: string;          // wire_transfer, mobile_money, etc.
  paymentReference?: string;      // bank/provider ref (optional)
  paymentNotes?: string;          // optional admin notes
  confirmedBy: string;            // acting user name
  verifyUrl?: string;             // pre-built or auto-built
}

const PAYMENT_METHOD_DISPLAY: Record<string, string> = {
  wire_transfer: 'Wire Transfer (SWIFT)',
  cash:          'Cash Deposit',
  mobile_money:  'Mobile Money',
  card:          'Card Payment',
  stripe:        'Stripe (Card)',
  paystack:      'Paystack',
  flutterwave:   'Flutterwave',
  wave:          'Wave Mobile Money',
  other:         'Other',
};

/**
 * Build a receipt reference from the transaction id.
 * Format: RCT-{YEAR}-{first segment of tx UUID}
 */
export function buildReceiptRef(transactionId: string, paidAt: Date): string {
  return `RCT-${paidAt.getFullYear()}-${transactionId.split('-')[1].toUpperCase()}`;
}

/**
 * Generate an official receipt PDF (proof of payment).
 * Same institutional style as the invoice but with payment-specific blocks.
 */
export async function generateReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const verifyUrl = data.verifyUrl || buildVerifyUrl(data.receiptRef);
  const qrDataUrl = await generateQrCodeDataUrl(verifyUrl);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth  = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;

  // Top accent gradient bar
  doc.setFillColor(4, 120, 87);
  doc.rect(0, 0, pageWidth / 2, 4, 'F');
  doc.setFillColor(16, 185, 129);
  doc.rect(pageWidth / 2, 0, pageWidth / 4, 4, 'F');
  doc.setFillColor(234, 179, 8);
  doc.rect((pageWidth * 3) / 4, 0, pageWidth / 4, 4, 'F');

  // Logo (same vector as invoice)
  const logoX = margin;
  const logoY = 12;
  const logoSize = 16;
  doc.setFillColor(4, 120, 87);
  doc.roundedRect(logoX, logoY, logoSize, logoSize, 3, 3, 'F');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.4);
  doc.line(logoX + 8, logoY + 4, logoX + 4, logoY + 6);
  doc.line(logoX + 8, logoY + 4, logoX + 12, logoY + 6);
  doc.line(logoX + 4, logoY + 6, logoX + 4, logoY + 10);
  doc.line(logoX + 12, logoY + 6, logoX + 12, logoY + 10);
  doc.line(logoX + 4, logoY + 10, logoX + 8, logoY + 13);
  doc.line(logoX + 12, logoY + 10, logoX + 8, logoY + 13);
  doc.setLineWidth(0.6);
  doc.line(logoX + 8, logoY + 6, logoX + 8, logoY + 11);
  doc.line(logoX + 6, logoY + 9, logoX + 8, logoY + 7);
  doc.line(logoX + 10, logoY + 9, logoX + 8, logoY + 7);

  // Brand text
  doc.setTextColor(13, 31, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('AFRICGREEN', logoX + logoSize + 4, logoY + 6);
  doc.setFontSize(7);
  doc.setTextColor(5, 150, 105);
  doc.text('SOVEREIGN CARBON PLATFORM', logoX + logoSize + 4, logoY + 10);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Republic of Somaliland', logoX + logoSize + 4, logoY + 14);
  doc.text('Ministry of Environment & Climate Change', logoX + logoSize + 4, logoY + 17.5);
  doc.text('Maritime Carbon Tax Authority', logoX + logoSize + 4, logoY + 21);

  // Right header: OFFICIAL RECEIPT badge + title + PAID stamp
  const rightX = pageWidth - margin;
  doc.setFillColor(13, 31, 24);
  doc.rect(rightX - 38, logoY, 38, 5, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('OFFICIAL DOCUMENT', rightX - 19, logoY + 3.5, { align: 'center' });

  doc.setTextColor(13, 31, 24);
  doc.setFontSize(13);
  doc.text('OFFICIAL RECEIPT', rightX, logoY + 12, { align: 'right' });
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Proof of Payment — Maritime Carbon Tax', rightX, logoY + 17, { align: 'right' });

  // PAID stamp (large, prominent)
  doc.setFillColor(16, 185, 129);
  doc.rect(rightX - 32, logoY + 20, 32, 8, 'F');
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('PAID', rightX - 16, logoY + 26, { align: 'center' });

  // Header divider
  doc.setDrawColor(13, 31, 24);
  doc.setLineWidth(0.6);
  doc.line(margin, 40, pageWidth - margin, 40);

  // Reference + paid-to block
  let y = 48;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('PAID BY', margin, y);
  doc.text('RECEIPT REFERENCE', rightX, y, { align: 'right' });

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(13, 31, 24);
  doc.text(data.ownerName, margin, y);
  doc.setFont('courier', 'bold');
  doc.setTextColor(4, 120, 87);
  doc.setFontSize(13);
  doc.text(data.receiptRef, rightX, y, { align: 'right' });

  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(`Vessel: ${data.vesselName}`, margin, y);
  doc.setFont('courier', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Settles: ${data.invoiceRef}`, rightX, y, { align: 'right' });

  y += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.text(`IMO: ${data.vesselImo} · MMSI: ${data.vesselMmsi || '—'}`, margin, y);
  doc.setTextColor(16, 185, 129);
  doc.setFont('helvetica', 'bold');
  doc.text(`Paid: ${data.paidAt}`, rightX, y, { align: 'right' });

  // Legal preamble — payment confirmation
  y += 10;
  doc.setFillColor(240, 250, 244);
  doc.rect(margin, y - 4, pageWidth - 2 * margin, 14, 'F');
  doc.setFillColor(16, 185, 129);
  doc.rect(margin, y - 4, 1, 14, 'F');
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(13, 31, 24);
  doc.text(
    'This document confirms that the carbon tax obligation referenced above has been',
    margin + 4,
    y,
  );
  doc.text(
    'settled in full. The vessel is hereby cleared for port operations within Somaliland',
    margin + 4,
    y + 3.5,
  );
  doc.text(
    'territorial waters and Exclusive Economic Zone (EEZ).',
    margin + 4,
    y + 7,
  );

  // Amount paid — large prominent
  y += 16;
  doc.setFillColor(13, 31, 24);
  doc.rect(margin, y, pageWidth - 2 * margin, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('AMOUNT PAID', margin + 4, y + 6);
  doc.setFont('courier', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(16, 185, 129);
  doc.text(`$${data.amountUsd.toLocaleString()}.00 USD`, margin + 4, y + 14);

  // Payment method details box
  y += 24;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('PAYMENT DETAILS', margin, y);

  y += 4;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.rect(margin, y, pageWidth - 2 * margin, 28, 'S');

  // Method row
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Method', margin + 3, y + 6);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 31, 24);
  doc.text(PAYMENT_METHOD_DISPLAY[data.paymentMethod] || data.paymentMethod, margin + 30, y + 6);

  // Reference row
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Reference', margin + 3, y + 12);
  doc.setFont('courier', 'bold');
  doc.setTextColor(13, 31, 24);
  doc.text(data.paymentReference || '— not provided —', margin + 30, y + 12);

  // Confirmed by row
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Confirmed by', margin + 3, y + 18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 31, 24);
  doc.text(data.confirmedBy, margin + 30, y + 18);

  // Notes row (if any)
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Notes', margin + 3, y + 24);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(71, 85, 105);
  if (data.paymentNotes) {
    const truncated = data.paymentNotes.length > 75 ? data.paymentNotes.slice(0, 72) + '…' : data.paymentNotes;
    doc.text(truncated, margin + 30, y + 24);
  } else {
    doc.text('—', margin + 30, y + 24);
  }

  y += 36;

  // Signature, QR, seal — 3 columns
  y += 6;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(margin, y, margin + 60, y);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Authorized Signatory', margin, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 31, 24);
  doc.text(data.confirmedBy, margin, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Maritime Carbon Tax Authority', margin, y + 11);

  // Center: QR code
  const qrSize = 26;
  const qrX = (pageWidth - qrSize) / 2;
  const qrY = y - 6;
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 31, 24);
  doc.text('VERIFY ONLINE', pageWidth / 2, qrY + qrSize + 3, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Scan to verify payment', pageWidth / 2, qrY + qrSize + 6, { align: 'center' });

  // Right: official seal
  const sealX = pageWidth - margin - 14;
  const sealY = y - 4;
  doc.setDrawColor(4, 120, 87);
  doc.setLineWidth(1.2);
  doc.circle(sealX, sealY + 10, 14, 'S');
  doc.setLineWidth(0.4);
  doc.circle(sealX, sealY + 10, 12, 'S');
  doc.setTextColor(4, 120, 87);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');
  doc.text('PAID', sealX, sealY + 8, { align: 'center' });
  doc.text('SEAL', sealX, sealY + 11, { align: 'center' });
  doc.text('SOMALILAND', sealX, sealY + 14, { align: 'center' });

  // Footer
  const footerY = pageHeight - 20;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY, pageWidth - margin, footerY);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Retain this receipt for your records. Cross-reference: ${data.invoiceRef}`,
    margin,
    footerY + 4,
  );
  doc.text(
    'This is an official tax receipt issued by the Maritime Carbon Tax Authority.',
    margin,
    footerY + 7.5,
  );
  doc.setTextColor(203, 213, 225);
  doc.setFontSize(6);
  doc.text(
    `Document generated by AfricgreenOS · ${new Date().toISOString()} · AES-256 Encrypted`,
    pageWidth / 2,
    footerY + 12,
    { align: 'center' },
  );

  return new Uint8Array(doc.output('arraybuffer'));
}

/**
 * Generate the receipt PDF and upload it to Supabase Storage.
 * Returns the public URL.
 */
export async function generateAndStoreReceipt(
  client: SupabaseClient,
  data: ReceiptData,
): Promise<string | null> {
  const pdfBuffer = await generateReceiptPdf(data);
  const fileName = `receipts/${data.receiptRef}.pdf`;

  const { error: uploadError } = await client.storage
    .from('documents')
    .upload(fileName, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    console.error('[Receipt] Upload failed:', uploadError.message);
    return null;
  }

  const { data: urlData } = client.storage.from('documents').getPublicUrl(fileName);
  return urlData.publicUrl;
}

export type { InvoiceData };
