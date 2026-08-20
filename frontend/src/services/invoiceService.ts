import { createHash, createHmac, timingSafeEqual } from 'crypto';
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
export type InvoiceBadge = 'TO PAY' | 'PAID' | 'OVERDUE' | 'DISPUTED' | 'EXEMPT' | 'SIMULATION';
/**
 * Badge dérivé d'un statut de transaction réel — ne contient jamais SIMULATION,
 * qui n'existe que pour les pré-estimations du simulateur (aucun statut en base).
 */
export type StatusBadge = Exclude<InvoiceBadge, 'SIMULATION'>;

export function statusToMode(status: string): { mode: InvoiceMode; badge: StatusBadge } {
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
    /** Display overrides used for non-carbon lines (fixed port fee, flat
     *  surcharges, …) so the generated PDF matches the HTML preview 1:1.
     *  If omitted, the PDF falls back to the carbon-tax rendering
     *  (emissionsTco2 + $/t). */
    description?: string;
    qtyDisplay?: string;
    rateDisplay?: string;
  }>;
  // New fields for mode + verification
  mode?: InvoiceMode;
  badge?: InvoiceBadge;
  verifyUrl?: string;       // URL encoded in the QR code
  /**
   * Simulation (pré-estimation du simulateur) : le document ne doit JAMAIS
   * pouvoir être confondu avec un vrai pro-forma opposable. Remplace le bandeau
   * « OFFICIAL DOCUMENT », retitre le document et appose un filigrane.
   */
  simulation?: boolean;
}

/**
 * Compute a canonical string for an invoice's authoritative fields.
 * The SAME function must be used when signing (server) and when verifying
 * (server) — any divergence breaks the hash chain.
 *
 * Ordering is deterministic (fixed key sequence, not JSON.stringify which
 * preserves declaration order but is fragile to future refactors). Numbers
 * are coerced to fixed-precision strings so a float like 6312.00 vs 6312
 * don't produce different hashes.
 */
export function canonicalizeInvoiceFields(fields: {
  invoiceRef: string;
  vesselImo: string;
  vesselName: string;
  ownerName: string;
  totalUsd: number;
  periodStart: string;
  periodEnd: string;
  mode: InvoiceMode;
}): string {
  const parts = [
    `ref=${fields.invoiceRef}`,
    `imo=${fields.vesselImo}`,
    `vessel=${fields.vesselName}`,
    `owner=${fields.ownerName}`,
    `total=${Number(fields.totalUsd).toFixed(2)}`,
    `start=${fields.periodStart}`,
    `end=${fields.periodEnd}`,
    `mode=${fields.mode}`,
  ];
  return parts.join('|');
}

/** SHA-256 of the canonical payload — embedded in the QR URL as `?h=...`
 *  so the verifier can see the bound content hash on /verify. */
export function hashInvoiceFields(fields: Parameters<typeof canonicalizeInvoiceFields>[0]): string {
  return createHash('sha256').update(canonicalizeInvoiceFields(fields)).digest('hex');
}

/** Read the signing secret. THROWS in production if missing so misconfig
 *  doesn't silently downgrade to unsigned URLs. In dev, falls back to a
 *  constant so local flows work without ceremony. */
function getSigningSecret(): string {
  const secret = process.env.INVOICE_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[invoiceService] INVOICE_SIGNING_SECRET missing or too short (need >=32 chars). ' +
        'Generate one with `openssl rand -hex 32` and set it in the environment.',
      );
    }
    // Dev-only fallback — documented, not a secret worth rotating.
    return 'dev-unsafe-invoice-signing-secret-REPLACE-IN-PROD-xxxxxx';
  }
  return secret;
}

/** Compute an HMAC-SHA256 signature binding (ref, hash) to the Green Gate
 *  signing key. Anyone can build a URL with a random ref; only the server
 *  can produce a URL whose `?s=...` validates. */
export function signInvoiceRef(invoiceRef: string, contentHash: string): string {
  return createHmac('sha256', getSigningSecret())
    .update(`${invoiceRef}:${contentHash}`)
    .digest('hex');
}

/** Constant-time comparison. Returns false on length mismatch. Used by
 *  the /verify route and the signed PDF download route to reject forgeries. */
export function verifyInvoiceSignature(
  invoiceRef: string,
  contentHash: string,
  signature: string,
): boolean {
  const expected = signInvoiceRef(invoiceRef, contentHash);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== actualBuf.length || expectedBuf.length === 0) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Generate a verification URL for an invoice ref.
 * Used by both the HTML preview and the PDF QR code.
 *
 * The URL embeds the content hash and an HMAC signature so anyone scanning
 * the QR lands on a page that can (a) prove the document came from Green
 * Gate without touching the DB (signature check at the edge) and (b) show
 * the authoritative hash the verifier is expected to compare against the
 * printed document's content.
 *
 * Origin resolution (in order):
 *   1. explicit `origin` arg — caller passed `window.location.origin` or
 *      `Origin`/`Host` headers from the incoming request.
 *   2. `NEXT_PUBLIC_APP_URL` env — for server contexts without a request.
 *   3. `window.location.origin` — last-ditch client fallback.
 */
export function buildVerifyUrl(
  invoiceRef: string,
  options?: { contentHash?: string; signature?: string; origin?: string },
): string {
  const resolved =
    options?.origin
    || process.env.NEXT_PUBLIC_APP_URL
    || (typeof window !== 'undefined' ? window.location.origin : '');
  const base = resolved.replace(/\/+$/, '');
  const path = `${base}/verify/${encodeURIComponent(invoiceRef)}`;
  if (options?.contentHash && options?.signature) {
    const qs = new URLSearchParams({ h: options.contentHash, s: options.signature });
    return `${path}?${qs.toString()}`;
  }
  return path;
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
function docTypeName(mode: InvoiceMode | undefined, simulation?: boolean): string {
  if (simulation) return 'TAX SIMULATION';
  return mode === 'invoice' ? 'TAX INVOICE' : 'PRO-FORMA INVOICE';
}

/**
 * Cached base64 data URL of the official Somaliland flag PNG
 * (includes the Shahada calligraphy in the top green band).
 *
 * Loaded lazily from public/brand/somaliland-flag.png on first use.
 * Server-side only — client-side imports fall back to vector primitives.
 */
let CACHED_SOMALILAND_FLAG_PNG: string | null = null;

async function loadSomalilandFlagPng(): Promise<string | null> {
  if (CACHED_SOMALILAND_FLAG_PNG !== null) return CACHED_SOMALILAND_FLAG_PNG;
  if (typeof window !== 'undefined') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path');
    const svgPath = join(process.cwd(), 'public', 'brand', 'somaliland-flag.svg');
    const svgBuffer = readFileSync(svgPath);
    // Use sharp (already installed by Next.js) to rasterize the SVG (which includes
    // the Shahada calligraphy in the top green band) to a PNG jsPDF can embed.
    // Rasterize at ~300dpi for a 16mm wide flag (188px is plenty).
    // Keep file small: quantize colors + max compression. The flag has few
    // colors so this is near-lossless and keeps the PDF under ~60KB overhead.
    const sharp = (await import('sharp')).default;
    const pngBuffer = await sharp(svgBuffer, { density: 400 })
      .resize(240, 120, { fit: 'fill' })
      .png({ palette: true, compressionLevel: 9 })
      .toBuffer();
    CACHED_SOMALILAND_FLAG_PNG = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    return CACHED_SOMALILAND_FLAG_PNG;
  } catch {
    return null;
  }
}

/**
 * Draw the Somaliland flag.
 *
 * Preferred path (server-side): use the official PNG asset which includes the
 * Shahada calligraphy ("لا إله إلا الله محمد رسول الله") in the top green band
 * plus the 5-point black star on the white band.
 *
 * Fallback path (client-side or PNG unavailable): draw 3 horizontal stripes +
 * star using jsPDF primitives. Colors match the official flag:
 * green #006d21, white #ffffff, red #df0000.
 */
async function drawSomalilandFlag(doc: jsPDF, x: number, y: number, w: number, h: number): Promise<void> {
  const pngDataUrl = await loadSomalilandFlagPng();
  if (pngDataUrl) {
    try {
      doc.addImage(pngDataUrl, 'PNG', x, y, w, h);
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.15);
      doc.rect(x, y, w, h, 'S');
      return;
    } catch (err) {
      // fall through to vector fallback
      void err;
    }
  }

  // ── Vector fallback ──
  const band = h / 3;
  doc.setFillColor(0, 109, 33);
  doc.rect(x, y, w, band, 'F');
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y + band, w, band, 'F');
  doc.setFillColor(223, 0, 0);
  doc.rect(x, y + 2 * band, w, band, 'F');
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.15);
  doc.rect(x, y, w, h, 'S');
  const cx = x + w / 2;
  const cy = y + band + band / 2;
  const R = Math.min(band * 0.45, w * 0.09);
  const r = R * 0.4;
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? R : r;
    const theta = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)]);
  }
  const offsets: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) {
    offsets.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  }
  offsets.push([pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]]);
  doc.setFillColor(0, 0, 0);
  doc.lines(offsets, pts[0][0], pts[0][1], [1, 1], 'F', true);
}

/**
 * Format a USD amount for display — forces en-US thousands separators
 * (comma) with NO decimals. Used consistently in PDFs and HTML preview
 * to avoid locale-dependent separators and duplicated ".00" suffixes.
 */
function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
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
    case 'SIMULATION': return { bg: [100, 116, 139], fg: [255, 255, 255] }; // slate — non opposable
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

  // ── Filigrane SIMULATION ──
  // Dessiné en premier (donc sous le contenu) et en gris très clair : lisible
  // sans gêner la lecture, mais impossible de confondre une pré-estimation du
  // simulateur avec un pro-forma réel, y compris une fois imprimée.
  if (data.simulation) {
    doc.saveGraphicsState();
    doc.setTextColor(226, 232, 240); // slate-200
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(58);
    doc.text('SIMULATION', pageWidth / 2, pageHeight / 2, {
      align: 'center',
      angle: 40,
      baseline: 'middle',
    });
    doc.restoreGraphicsState();
  }

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

  // ── Somaliland flag below the logo (port country) ──
  await drawSomalilandFlag(doc, logoX, logoY + logoSize + 2, logoSize, 9);

  // ── Brand text ──
  const brandX = logoX + logoSize + 4;
  doc.setTextColor(13, 31, 24); // #0D1F18
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('GREEN GATE', brandX, logoY + 6);
  doc.setFontSize(7);
  doc.setTextColor(5, 150, 105);
  doc.text('SOVEREIGN CARBON PLATFORM', brandX, logoY + 10);
  // Solide Technology — concessionaire collecting the payment
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(4, 120, 87);
  doc.text('SOLIDE TECHNOLOGY — Concessionaire', brandX, logoY + 14.5);
  // Sovereign authority block
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105); // slate-600
  doc.text('Republic of Somaliland', brandX, logoY + 19);
  doc.text('Ministry of Environment & Climate Change', brandX, logoY + 22.5);
  doc.text('Maritime Carbon Tax Authority', brandX, logoY + 26);

  // ── Right header: OFFICIAL DOCUMENT badge + title ──
  const rightX = pageWidth - margin;
  // Une simulation n'est pas un document officiel : bandeau et libellés distincts
  // pour qu'elle ne puisse pas être présentée comme un pro-forma opposable.
  const headerTag = data.simulation ? 'NOT AN OFFICIAL DOCUMENT' : 'OFFICIAL DOCUMENT';
  const tagW = data.simulation ? 52 : 38;
  if (data.simulation) {
    doc.setFillColor(100, 116, 139);
  } else {
    doc.setFillColor(13, 31, 24);
  }
  doc.rect(rightX - tagW, logoY, tagW, 5, 'F');
  if (data.simulation) {
    doc.setTextColor(255, 255, 255);
  } else {
    doc.setTextColor(16, 185, 129);
  }
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text(headerTag, rightX - tagW / 2, logoY + 3.5, { align: 'center' });

  doc.setTextColor(13, 31, 24);
  doc.setFontSize(13);
  doc.text(docTypeName(data.mode, data.simulation), rightX, logoY + 12, { align: 'right' });
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    data.simulation
      ? 'Non-binding pre-estimate — simulator output'
      : 'Maritime Environmental Levy Notice',
    rightX,
    logoY + 17,
    { align: 'right' },
  );

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
  doc.line(margin, 44, pageWidth - margin, 44);

  // ── Reference block ──
  let y = 52;
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
    'Pursuant to Ministerial Decree MOE&CC/MWI/36/2026 (Hargeisa, 31 March 2026), the Maritime',
    margin + 4,
    y,
  );
  doc.text(
    'Carbon Tax Act (2024) and IMO MEPC.346(78), the above-named vessel is hereby notified of',
    margin + 4,
    y + 3.5,
  );
  doc.text(
    'carbon emission liabilities incurred within the Somaliland EEZ. Collection: SOLIDE TECHNOLOGY.',
    margin + 4,
    y + 7,
  );

  // ── Late payment penalty notice ──
  y += 13;
  doc.setFillColor(254, 242, 242); // red-50
  doc.rect(margin, y - 3, pageWidth - 2 * margin, 7, 'F');
  doc.setFillColor(220, 38, 38);
  doc.rect(margin, y - 3, 1, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(185, 28, 28);
  doc.text(
    'LATE PAYMENT PENALTY — A flat fee of US$20,000 applies if the amount is not settled by the due date.',
    margin + 4,
    y + 1,
  );

  // ── Line items table ──
  y += 10;
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
    const description = item.description
      ?? (item.zone === 'EEZ' ? 'Carbon Emissions Tax (IMO Cubic Law)' : item.zone);
    const qty = item.qtyDisplay ?? `${item.emissionsTco2.toFixed(2)} tCO2`;
    const rate = item.rateDisplay ?? `$${item.rate.toFixed(2)}/t`;
    doc.setTextColor(13, 31, 24);
    doc.text(description, tableX + 2, y + 4.6);
    doc.setFont('courier', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(qty, tableX + colDescW + colQtyW - 2, y + 4.6, { align: 'right' });
    doc.text(rate, tableX + colDescW + colQtyW + colRateW - 2, y + 4.6, { align: 'right' });
    doc.setFont('courier', 'bold');
    doc.setTextColor(13, 31, 24);
    doc.text(`$${fmtUsd(item.amount)}`, tableX + tableW - 2, y + 4.6, { align: 'right' });
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
  doc.text(`$${fmtUsd(data.totalUsd)}`, tableX + tableW - 4, y + 8.5, { align: 'right' });

  // ── Signature, QR code & seal (3 columns) ──
  y += 22;

  // Left: signature line
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(margin, y, margin + 60, y);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Signataire Autorisé', margin, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 31, 24);
  doc.text('Directeur', margin, y + 8);
  doc.text('Solide Technology', margin, y + 11);

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
    'Payment terms: 30 days from issuance. Late settlement incurs a flat US$20,000 penalty fee.',
    margin,
    footerY + 4,
  );
  // Split across two lines — holder+bank / SWIFT+IBAN+Ref no longer fits a
  // single 7pt line at this page width (measured ~212mm vs. ~174mm usable).
  doc.text(
    'Remit to: Solide Technology Limited · System Pay Services (Malta) Limited',
    margin,
    footerY + 7.5,
  );
  doc.text(
    `SWIFT SYPLMTM2XXX · IBAN MT12SYPL39480821090981701607644 · Ref: ${data.invoiceRef}`,
    margin,
    footerY + 11,
  );
  doc.setTextColor(203, 213, 225);
  doc.setFontSize(6);
  doc.text(
    `Document generated by Green Gate OS · ${new Date().toISOString()} · AES-256 Encrypted`,
    pageWidth / 2,
    footerY + 14.5,
    { align: 'center' },
  );

  return new Uint8Array(doc.output('arraybuffer'));
}

// ── Monthly account statement (chantier C) ─────────────────────────────────
// Informatif : pas de QR, pas de HMAC, pas de sceau fiscal. Réutilise fmtUsd et
// le squelette jsPDF de generateInvoicePdf, en version allégée.

export interface StatementLine {
    // Requis (pas une commodité) : sans transactionId, une ligne de relevé ne
    // peut pas être reliée à sa transaction d'origine — ce qui bloquerait
    // l'insert groupé collection_reminders du récap consolidé (Task 12).
    transactionId: string;
    invoiceRef: string; vesselName: string; issuedAt: string; ageDays: number; outstandingUsd: number;
}
export interface StatementPayment {
    confirmedAt: string; receiptRef: string | null; amountUsd: number;
}
export interface StatementData {
    ownerName: string;
    jurisdiction: string;
    periodLabel: string;
    openLines: StatementLine[];
    payments: StatementPayment[];
    totalOutstandingUsd: number;
    paymentsInMonthUsd: number;
}

export async function generateStatementPdf(data: StatementData): Promise<Uint8Array> {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 18;

    // Accent bar
    doc.setFillColor(4, 120, 87); doc.rect(0, 0, pageWidth / 2, 4, 'F');
    doc.setFillColor(16, 185, 129); doc.rect(pageWidth / 2, 0, pageWidth / 4, 4, 'F');
    doc.setFillColor(234, 179, 8); doc.rect((pageWidth * 3) / 4, 0, pageWidth / 4, 4, 'F');

    // Title
    doc.setTextColor(13, 31, 24);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('Account Statement', margin, 22);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`${data.jurisdiction} · Maritime Carbon Tax Authority`, margin, 29);

    // Owner + period
    doc.setTextColor(13, 31, 24); doc.setFontSize(11);
    doc.text(data.ownerName, margin, 40);
    doc.setTextColor(100, 116, 139); doc.setFontSize(10);
    doc.text(`Statement period: ${data.periodLabel}`, margin, 46);

    // Informational disclaimer
    doc.setTextColor(148, 163, 184); doc.setFontSize(8);
    doc.text('Informational account statement — not an invoice or a formal notice.', margin, 52);

    let y = 62;

    // Open pro-formas
    doc.setTextColor(13, 31, 24); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Outstanding pro-formas', margin, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    doc.text('Reference', margin, y); doc.text('Vessel', margin + 55, y);
    doc.text('Age', margin + 110, y); doc.text('Due (USD)', pageWidth - margin, y, { align: 'right' }); y += 5;
    doc.setTextColor(13, 31, 24);
    if (data.openLines.length === 0) {
        doc.setTextColor(148, 163, 184); doc.text('None', margin, y); doc.setTextColor(13, 31, 24); y += 6;
    } else {
        for (const l of data.openLines) {
            if (y > 250) { doc.addPage(); y = 22; }
            doc.setFontSize(9);
            doc.text(l.invoiceRef, margin, y);
            doc.text(l.vesselName.slice(0, 26), margin + 55, y);
            doc.text(`${l.ageDays}d`, margin + 110, y);
            doc.text(fmtUsd(l.outstandingUsd), pageWidth - margin, y, { align: 'right' });
            y += 5;
        }
    }
    y += 4;

    // Payments in month
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(`Payments received in ${data.periodLabel}`, margin, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    doc.text('Date', margin, y); doc.text('Receipt', margin + 55, y);
    doc.text('Amount (USD)', pageWidth - margin, y, { align: 'right' }); y += 5;
    doc.setTextColor(13, 31, 24);
    if (data.payments.length === 0) {
        doc.setTextColor(148, 163, 184); doc.text('None', margin, y); doc.setTextColor(13, 31, 24); y += 6;
    } else {
        for (const p of data.payments) {
            if (y > 250) { doc.addPage(); y = 22; }
            doc.setFontSize(9);
            doc.text(p.confirmedAt.slice(0, 10), margin, y);
            doc.text(p.receiptRef ?? '—', margin + 55, y);
            doc.text(fmtUsd(p.amountUsd), pageWidth - margin, y, { align: 'right' });
            y += 5;
        }
    }
    y += 8;

    // Totals
    doc.setDrawColor(203, 213, 225); doc.line(margin, y, pageWidth - margin, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
    doc.text('Payments received this period', margin, y);
    doc.setTextColor(16, 185, 129);
    doc.text(`$${fmtUsd(data.paymentsInMonthUsd)}`, pageWidth - margin, y, { align: 'right' }); y += 7;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(13, 31, 24);
    doc.text('Total outstanding', margin, y);
    doc.text(`$${fmtUsd(data.totalOutstandingUsd)}`, pageWidth - margin, y, { align: 'right' });

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
 * Format: RCT-{YEAR}-{first 8 hex chars of tx UUID}
 *
 * The first segment of a UUIDv4 is 8 hex chars (16^8 ≈ 4.3 billion values),
 * making birthday-paradox collisions impractical at our receipt volumes.
 */
export function buildReceiptRef(transactionId: string, paidAt: Date): string {
  return `RCT-${paidAt.getFullYear()}-${transactionId.split('-')[0].toUpperCase()}`;
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

  // Somaliland flag below the logo
  await drawSomalilandFlag(doc, logoX, logoY + logoSize + 2, logoSize, 9);

  // Brand text
  const brandX = logoX + logoSize + 4;
  doc.setTextColor(13, 31, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('GREEN GATE', brandX, logoY + 6);
  doc.setFontSize(7);
  doc.setTextColor(5, 150, 105);
  doc.text('SOVEREIGN CARBON PLATFORM', brandX, logoY + 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(4, 120, 87);
  doc.text('SOLIDE TECHNOLOGY — Concessionaire', brandX, logoY + 14.5);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Republic of Somaliland', brandX, logoY + 19);
  doc.text('Ministry of Environment & Climate Change', brandX, logoY + 22.5);
  doc.text('Maritime Carbon Tax Authority', brandX, logoY + 26);

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
  doc.line(margin, 44, pageWidth - margin, 44);

  // Reference + paid-to block
  let y = 52;
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
  doc.text(`$${fmtUsd(data.amountUsd)} USD`, margin + 4, y + 14);

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
  doc.text('Signataire Autorisé', margin, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(13, 31, 24);
  doc.text(data.confirmedBy, margin, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Directeur — Solide Technology', margin, y + 11);

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
    `Document generated by Green Gate OS · ${new Date().toISOString()} · AES-256 Encrypted`,
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
