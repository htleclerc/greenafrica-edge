import { describe, it, expect } from 'vitest';
import { pdfSafe } from './invoiceLayout';
import { generateInvoicePdf } from './invoiceService';

describe('pdfSafe', () => {
    it('remplace les fleches, absentes de WinAnsi', () => {
        // Une seule fleche suffisait a faire basculer jsPDF en encodage 16 bits
        // et a rendre la ligne entiere illisible.
        expect(pdfSafe('Reminder → notice → bailiff')).toBe('Reminder > notice > bailiff');
    });

    it('normalise les guillemets typographiques', () => {
        expect(pdfSafe('l’IBAN “officiel”')).toBe('l\'IBAN "officiel"');
    });

    it('laisse passer le Latin-1 imprimable', () => {
        // Tiret cadratin, point median, multiplication et accents sont dans
        // WinAnsi : les toucher abimerait les libelles.
        expect(pdfSafe('Noël · 1 720,80 × USD 40,00 — Hargeisa')).toBe('Noël · 1 720,80 × USD 40,00 — Hargeisa');
    });

    it('remplace le reste plutot que de casser la ligne', () => {
        expect(pdfSafe('emoji 🚢 fin')).toBe('emoji ?? fin');
    });
});

const BASE = {
    invoiceRef: 'PRO-2026-064001',
    vesselName: 'MAYAR',
    vesselImo: '9167057',
    vesselMmsi: '341264001',
    ownerName: 'LEVANTE MARITTIMO CO',
    jurisdiction: 'Republic of Somaliland',
    periodStart: '19 August 2026',
    periodEnd: '03 October 2026',
    emissionsTco2: 1720.8,
    ratePerTco2: 40,
    subtotalUsd: 68832,
    exemptionUsd: 0,
    totalUsd: 68832,
    mode: 'proforma' as const,
    badge: 'TO PAY' as const,
    lineItems: [{
        zone: 'EEZ', days: 1, emissionsTco2: 1720.8, rate: 40, amount: 68832,
        description: 'Carbon Emissions Tax (Voyage Method)',
    }],
};

/** Les flux du PDF ne sont pas compressés : le texte se lit en clair. */
function pdfText(pdf: Uint8Array): string {
    const raw = Buffer.from(pdf).toString('latin1');
    const tokens = raw.match(/\((?:\\.|[^()\\])*\)/g) ?? [];
    // jsPDF échappe les parenthèses à l'intérieur des chaînes : le document
    // porte « Berbera \(BBO\) ». Sans déséchappement, toute assertion sur un
    // libellé parenthésé échouerait alors que le PDF est correct.
    return tokens.map((t) => t.slice(1, -1).replace(/\\([()\\])/g, '$1')).join(' ');
}

function pageCount(pdf: Uint8Array): number {
    return (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe('generateInvoicePdf — gabarit deux pages', () => {
    it('produit une page 1 et une page CALCULATION DETAILS', async () => {
        const pdf = await generateInvoicePdf(BASE);
        expect(pageCount(pdf)).toBe(2);
        const text = pdfText(pdf);
        expect(text).toContain('PRO-FORMA INVOICE');
        expect(text).toContain('CALCULATION DETAILS');
    });

    it('porte le compte a crediter et la preuve exigee sur la page 1', async () => {
        // Un armateur qui imprime la facture doit pouvoir la remettre telle
        // quelle a sa banque.
        const text = pdfText(await generateInvoicePdf(BASE));
        expect(text).toContain('PAYMENT INSTRUCTIONS');
        expect(text).toContain('MT12SYPL39480821090981701607644');
        expect(text).toContain('SYPLMTM2XXX');
        expect(text).toContain('Mandatory reference');
        expect(text).toContain('PROOF OF PAYMENT REQUIRED');
    });

    it('conserve le QR de verification en page 1', async () => {
        // Absent du document de reference : c'est un ajout assume.
        const text = pdfText(await generateInvoicePdf(BASE));
        expect(text).toContain('VERIFY ONLINE');
    });

    it('imprime les six sections de la page 2', async () => {
        const text = pdfText(await generateInvoicePdf(BASE));
        for (const section of [
            '1. VOYAGE & STOPOVER DETAILS',
            '2. STEP-BY-STEP CALCULATION',
            '3. DEBTOR CONTACT INFORMATION',
            '4. PAYMENT TERMS & RECOVERY PROCEDURE',
            '5. ISSUER CONTACT & CORRESPONDENCE',
            '6. LEGAL BASIS & METHODOLOGY REFERENCES',
        ]) {
            expect(text).toContain(section);
        }
    });

    it('tient le delai de paiement et la penalite du profil emetteur', async () => {
        // 30 jours depuis la mig 149 (decision PO 2026-09-05) : le texte
        // imprime suit enfin le NET-30 que la base pose sur due_date.
        const text = pdfText(await generateInvoicePdf(BASE));
        expect(text).toContain('Payment terms: 30 days from issuance');
        expect(text).toContain('US$20,000');
    });

    it('marque « — » ce que la base ne porte pas', async () => {
        // Ni ISM manager ni P&I Club ne sont stockes aujourd'hui. Un document
        // opposable ne les invente pas.
        const text = pdfText(await generateInvoicePdf(BASE));
        expect(text).toContain('ISM manager');
        expect(text).toContain('P&I Club');
    });

    it('reprend les valeurs d escale et de debiteur quand elles existent', async () => {
        const text = pdfText(await generateInvoicePdf({
            ...BASE,
            voyage: { arrivalPort: 'Port of Berbera (BBO)', stopoverLabel: '91 days in port' },
            debtor: { ismName: 'MORGAN NAVIGATION CO SA (LB)', piClub: 'North of England P&I' },
        }));
        expect(text).toContain('Port of Berbera (BBO)');
        expect(text).toContain('91 days in port');
        expect(text).toContain('MORGAN NAVIGATION CO SA (LB)');
    });

    it('n ajoute pas de page 2 a une simulation', async () => {
        // Une pre-estimation n'ouvre aucun droit : pas de procedure de
        // recouvrement a exposer.
        const pdf = await generateInvoicePdf({ ...BASE, simulation: true });
        expect(pageCount(pdf)).toBe(1);
        expect(pdfText(pdf)).not.toContain('CALCULATION DETAILS');
    });
});
