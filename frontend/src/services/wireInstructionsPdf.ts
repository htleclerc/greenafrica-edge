import { jsPDF } from 'jspdf';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type WireBeneficiary } from '@/lib/payments/wireBeneficiary';
import { getIssuerProfile, toWireBeneficiary } from '@/services/issuerProfileService';
import { BRAND_HEADER_BODY_Y, drawBrandHeader } from '@/services/pdfBrandHeader';

/**
 * Coordonnées bancaires applicables à une juridiction.
 *
 * Depuis la mig 131 elles viennent de `jurisdiction_issuer_profile` : compte de
 * défaut, surchargeable juridiction par juridiction. Le service ne lève jamais
 * — sans ligne en base, il rend les coordonnées connues plutôt que rien.
 */
export async function getWireBeneficiary(
    client: SupabaseClient,
    jurisdictionId: string | null,
): Promise<WireBeneficiary> {
    return toWireBeneficiary(await getIssuerProfile(client, jurisdictionId));
}

export interface WireInstructionsData {
    beneficiary: WireBeneficiary;
    /** Référence à porter sur le virement — facture, ou marqueur de recharge. */
    reference: string;
    amountUsd: number;
    /** Raison sociale de l'armateur, pour que le document soit nominatif. */
    payerName: string;
    /** Libellé de la facture concernée, absent pour une recharge. */
    invoiceRef: string | null;
    issuedAt: Date;
}

const INK = { dark: [15, 23, 42], body: [51, 65, 85], muted: [100, 116, 139], rule: [226, 232, 240] } as const;

/**
 * Ordre de virement à remettre à sa banque : les coordonnées du compte de
 * collecte, la référence à porter, le montant.
 *
 * Pourquoi un PDF généré plutôt qu'un fichier bancaire joint tel quel : le
 * document porte la RÉFÉRENCE et le MONTANT de ce règlement précis. Un RIB nu
 * produit des virements anonymes que le service financier ne sait pas
 * rapprocher — c'est la première cause de fonds reçus non affectés.
 */
export async function generateWireInstructionsPdf(data: WireInstructionsData): Promise<Uint8Array> {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 18;

    const text = (
        value: string,
        x: number,
        yy: number,
        opts?: { size?: number; bold?: boolean; color?: readonly number[]; align?: 'left' | 'right' },
    ) => {
        doc.setFontSize(opts?.size ?? 10);
        doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
        const c = opts?.color ?? INK.body;
        doc.setTextColor(c[0], c[1], c[2]);
        doc.text(value, x, yy, opts?.align ? { align: opts.align } : undefined);
    };

    const rule = (yy: number) => {
        doc.setDrawColor(INK.rule[0], INK.rule[1], INK.rule[2]);
        doc.setLineWidth(0.3);
        doc.line(margin, yy, pageWidth - margin, yy);
    };

    // ── En-tête ──────────────────────────────────────────────────────────────
    // Le même que sur la facture réglée : l'ordre de virement part chez la
    // banque de l'armateur, il doit se rattacher au document qu'il paie.
    await drawBrandHeader(doc, {
        tag: 'INFORMATIONAL DOCUMENT',
        tagTone: 'muted',
        tagWidth: 46,
        title: 'BANK TRANSFER INSTRUCTIONS',
        subtitle: `Maritime carbon tax settlement · ${data.issuedAt.toISOString().slice(0, 10)}`,
    });
    let y = BRAND_HEADER_BODY_Y;

    // ── Ce qu'il faut payer ──────────────────────────────────────────────────
    text('AMOUNT TO TRANSFER', margin, y, { size: 8, bold: true, color: INK.muted });
    y += 6;
    text(
        data.amountUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
        margin, y, { size: 20, bold: true, color: INK.dark },
    );
    y += 9;

    text('PAYER', margin, y, { size: 8, bold: true, color: INK.muted });
    text(data.payerName, margin + 40, y, { size: 10, bold: true, color: INK.dark });
    y += 6;
    if (data.invoiceRef) {
        text('INVOICE', margin, y, { size: 8, bold: true, color: INK.muted });
        text(data.invoiceRef, margin + 40, y, { size: 10, color: INK.dark });
        y += 6;
    }
    y += 3;
    rule(y);
    y += 9;

    // ── Compte à créditer ────────────────────────────────────────────────────
    text('BENEFICIARY ACCOUNT', margin, y, { size: 8, bold: true, color: INK.muted });
    y += 7;

    const line = (label: string, value: string, emphasise = false) => {
        text(label, margin, y, { size: 8, color: INK.muted });
        text(value, margin + 40, y, {
            size: emphasise ? 11 : 10,
            bold: emphasise,
            color: emphasise ? INK.dark : INK.body,
        });
        y += emphasise ? 7 : 6;
    };

    line('Beneficiary', data.beneficiary.beneficiary, true);
    line('Bank', data.beneficiary.bank);
    line('Bank address', data.beneficiary.bankAddress);
    line('IBAN', data.beneficiary.iban, true);
    line('SWIFT / BIC', data.beneficiary.swiftCode, true);
    line('Reference', data.reference, true);

    y += 3;
    rule(y);
    y += 9;

    // ── Marche à suivre ──────────────────────────────────────────────────────
    text('WHAT HAPPENS NEXT', margin, y, { size: 8, bold: true, color: INK.muted });
    y += 6;
    const steps = [
        '1.  Instruct the transfer with your bank, quoting the reference above in the payment message.',
        '2.  Upload the SWIFT MT103 or your bank receipt in the Green Gate portal, on the invoice.',
        '3.  Finance reconciles the funds against the account and confirms the payment. Nothing is',
        '     charged automatically — the transfer is instructed by you, at your bank.',
    ];
    for (const step of steps) {
        text(step, margin, y, { size: 9 });
        y += 5;
    }

    y += 4;
    text(
        'The reference is what allows the funds to be matched to your invoice. A transfer sent without it',
        margin, y, { size: 8, color: INK.muted },
    );
    y += 4;
    text('arrives unattributed and cannot clear your vessel.', margin, y, { size: 8, color: INK.muted });

    // ── Pied de page ─────────────────────────────────────────────────────────
    const footerY = doc.internal.pageSize.getHeight() - 16;
    rule(footerY);
    text(
        `Document generated by Green Gate OS · ${data.issuedAt.toISOString()}`,
        pageWidth / 2, footerY + 5, { size: 7, color: INK.muted },
    );
    doc.text('', pageWidth / 2, footerY + 5, { align: 'center' });

    return new Uint8Array(doc.output('arraybuffer'));
}
