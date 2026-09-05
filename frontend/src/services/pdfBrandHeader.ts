import { jsPDF } from 'jspdf';

// ─────────────────────────────────────────────────────────────────────────────
// En-tête de marque commun à tous les PDF Green Gate.
//
// Un seul dessin — logo, drapeau, bloc autorité, bandeau et titre à droite —
// pour la facture, le reçu, le relevé et les instructions de virement. Avant,
// chaque document redessinait le sien (ou n'en avait pas) : le relevé sortait
// sans logo ni autorité, et l'armateur ne pouvait pas le rattacher d'un coup
// d'œil aux factures qu'il récapitule.
// ─────────────────────────────────────────────────────────────────────────────

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
export async function drawSomalilandFlag(doc: jsPDF, x: number, y: number, w: number, h: number): Promise<void> {
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

export interface BrandHeaderOptions {
    /** Bandeau en haut à droite : « OFFICIAL DOCUMENT », « INFORMATIONAL DOCUMENT »… */
    tag: string;
    /**
     * Ton du bandeau : `official` (vert sur sombre) pour un document opposable,
     * `muted` (blanc sur gris) pour ce qui ne l'est pas — simulation, relevé
     * informatif. Un lecteur pressé doit distinguer les deux au premier regard.
     */
    tagTone?: 'official' | 'muted';
    /** Largeur du bandeau (mm). Défaut : 38, ce que « OFFICIAL DOCUMENT » occupe. */
    tagWidth?: number;
    /** Nom du document, à droite : « PRO-FORMA INVOICE », « ACCOUNT STATEMENT »… */
    title: string;
    /** Sous-titre en italique sous le nom. */
    subtitle: string;
    /**
     * Première ligne du bloc autorité. Défaut : République du Somaliland —
     * le relevé porte la juridiction de l'armateur.
     */
    sovereignLine?: string;
}

/** Marge latérale de tous les documents (mm). */
export const PDF_MARGIN = 18;
/** Ordonnée du logo ; les badges des documents s'alignent dessus. */
export const BRAND_HEADER_LOGO_Y = 12;
/** Ordonnée du filet qui ferme l'en-tête. */
export const BRAND_HEADER_RULE_Y = 44;
/** Première ordonnée libre pour le corps du document. */
export const BRAND_HEADER_BODY_Y = 52;

/**
 * Dessine l'en-tête sur la page courante : barre d'accent, logo, drapeau,
 * bloc autorité à gauche ; bandeau, titre et sous-titre à droite ; filet.
 *
 * Ne dessine PAS le badge d'état (TO PAY, PAID…) : il est propre à chaque
 * document et se place sous le sous-titre, à `BRAND_HEADER_LOGO_Y + 20`.
 */
export async function drawBrandHeader(doc: jsPDF, opts: BrandHeaderOptions): Promise<void> {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = PDF_MARGIN;
  const logoY = BRAND_HEADER_LOGO_Y;

  // ── Top accent gradient bar (emerald → gold) ──
  doc.setFillColor(4, 120, 87); // #047857
  doc.rect(0, 0, pageWidth / 2, 4, 'F');
  doc.setFillColor(16, 185, 129); // #10B981
  doc.rect(pageWidth / 2, 0, pageWidth / 4, 4, 'F');
  doc.setFillColor(234, 179, 8); // #EAB308
  doc.rect((pageWidth * 3) / 4, 0, pageWidth / 4, 4, 'F');

  // ── Logo (vector) — emerald rounded square with shield ──
  const logoX = margin;
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
  doc.text(opts.sovereignLine ?? 'Republic of Somaliland', brandX, logoY + 19);
  doc.text('Ministry of Environment & Climate Change', brandX, logoY + 22.5);
  doc.text('Maritime Carbon Tax Authority', brandX, logoY + 26);

  // ── Right header: tag + title + subtitle ──
  const rightX = pageWidth - margin;
  const muted = opts.tagTone === 'muted';
  const tagW = opts.tagWidth ?? 38;
  if (muted) {
    doc.setFillColor(100, 116, 139);
  } else {
    doc.setFillColor(13, 31, 24);
  }
  doc.rect(rightX - tagW, logoY, tagW, 5, 'F');
  if (muted) {
    doc.setTextColor(255, 255, 255);
  } else {
    doc.setTextColor(16, 185, 129);
  }
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text(opts.tag, rightX - tagW / 2, logoY + 3.5, { align: 'center' });

  doc.setTextColor(13, 31, 24);
  doc.setFontSize(13);
  doc.text(opts.title, rightX, logoY + 12, { align: 'right' });
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(opts.subtitle, rightX, logoY + 17, { align: 'right' });

  // ── Header divider ──
  doc.setDrawColor(13, 31, 24);
  doc.setLineWidth(0.6);
  doc.line(margin, BRAND_HEADER_RULE_Y, pageWidth - margin, BRAND_HEADER_RULE_Y);
}
