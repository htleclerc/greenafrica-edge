import { describe, it, expect } from 'vitest';
import { generateWireInstructionsPdf, getWireBeneficiary } from './wireInstructionsPdf';
import { WIRE_BENEFICIARY } from '@/lib/payments/wireBeneficiary';

const BASE = {
    beneficiary: WIRE_BENEFICIARY,
    reference: 'PRO-2026-81be71091a2b',
    amountUsd: 11492,
    payerName: 'GG Demo Shipping Ltd',
    invoiceRef: 'PRO-2026-81be71091a2b',
    issuedAt: new Date('2026-08-22T10:00:00Z'),
};

/** Le PDF sort en binaire : on lit le texte brut du flux pour les assertions. */
function asText(pdf: Uint8Array): string {
    return Buffer.from(pdf).toString('latin1');
}

describe('generateWireInstructionsPdf', () => {
    it('produit un PDF valide', () => {
        const pdf = generateWireInstructionsPdf(BASE);
        expect(asText(pdf).startsWith('%PDF-')).toBe(true);
        expect(pdf.byteLength).toBeGreaterThan(1000);
    });

    it('porte l IBAN, le BIC et la reference a citer', () => {
        // Ces trois valeurs sont ce que la banque de l'armateur recopie. Sans la
        // reference, les fonds arrivent anonymes sur le compte de collecte.
        const out = asText(generateWireInstructionsPdf(BASE));
        expect(out).toContain('MT12SYPL39480821090981701607644');
        expect(out).toContain('SYPLMTM2XXX');
        expect(out).toContain('PRO-2026-81be71091a2b');
    });

    it('reste nominatif et chiffre', () => {
        const out = asText(generateWireInstructionsPdf(BASE));
        expect(out).toContain('GG Demo Shipping Ltd');
        expect(out).toContain('11,492');
    });

    it('accepte une recharge sans facture', () => {
        const pdf = generateWireInstructionsPdf({
            ...BASE,
            invoiceRef: null,
            reference: 'TOPUP-ARM014AB',
            amountUsd: 5000,
        });
        const out = asText(pdf);
        expect(out).toContain('TOPUP-ARM014AB');
        expect(out).not.toContain('PRO-2026-81be71091a2b');
    });
});

describe('getWireBeneficiary', () => {
    it('sert le compte du concessionnaire pour toute juridiction', async () => {
        // Un seul concessionnaire perçoit aujourd'hui. Ce test tient la
        // promesse du point de substitution unique : le jour où une
        // juridiction encaisse sur son compte, c'est ici que ça se voit.
        await expect(getWireBeneficiary('00000000-0000-4000-8000-00000000534f'))
            .resolves.toEqual(WIRE_BENEFICIARY);
    });
});
