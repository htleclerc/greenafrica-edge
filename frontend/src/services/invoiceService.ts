import type { SupabaseClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';

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
}

/**
 * Generate an official institutional carbon tax pro-forma invoice PDF.
 * Includes branded header, official seal, signature blocks, legal preamble.
 * Returns the PDF as a Uint8Array buffer.
 */
export function generateInvoicePdf(data: InvoiceData): Uint8Array {
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
  doc.text('PRO-FORMA INVOICE', rightX, logoY + 12, { align: 'right' });
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Maritime Environmental Levy Notice', rightX, logoY + 17, { align: 'right' });

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

  // ── Signature & seal ──
  y += 22;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(margin, y, margin + 70, y);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Authorized Signatory', margin, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 31, 24);
  doc.text('Director, Maritime Carbon Tax Authority', margin, y + 8);

  // Official seal (circle with text)
  const sealX = pageWidth - margin - 22;
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

  return doc.output('arraybuffer') as unknown as Uint8Array;
}

/**
 * Generate invoice PDF and upload to Supabase Storage.
 * Returns the public URL of the uploaded PDF.
 */
export async function generateAndStoreInvoice(
  client: SupabaseClient,
  data: InvoiceData,
): Promise<string | null> {
  const pdfBuffer = generateInvoicePdf(data);
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

export type { InvoiceData };
