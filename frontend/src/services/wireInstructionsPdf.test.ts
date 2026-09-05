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
    it('produit un PDF valide', async () => {
        const pdf = await generateWireInstructionsPdf(BASE);
        expect(asText(pdf).startsWith('%PDF-')).toBe(true);
        expect(pdf.byteLength).toBeGreaterThan(1000);
    });

    it('porte l IBAN, le BIC et la reference a citer', async () => {
        // Ces trois valeurs sont ce que la banque de l'armateur recopie. Sans la
        // reference, les fonds arrivent anonymes sur le compte de collecte.
        const out = asText(await generateWireInstructionsPdf(BASE));
        expect(out).toContain('MT12SYPL39480821090981701607644');
        expect(out).toContain('SYPLMTM2XXX');
        expect(out).toContain('PRO-2026-81be71091a2b');
    });

    it('reste nominatif et chiffre', async () => {
        const out = asText(await generateWireInstructionsPdf(BASE));
        expect(out).toContain('GG Demo Shipping Ltd');
        expect(out).toContain('11,492');
    });

    it('accepte une recharge sans facture', async () => {
        const pdf = await generateWireInstructionsPdf({
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
    /** Client minimal : `.from().select()` rend les lignes fournies. */
    function fakeClient(rows: unknown[], error: unknown = null) {
        return {
            from: () => ({ select: async () => ({ data: rows, error }) }),
        } as unknown as Parameters<typeof getWireBeneficiary>[0];
    }

    it('sert le compte de defaut quand la juridiction n en surcharge pas', async () => {
        const rows = [{
            jurisdiction_id: null,
            bank_accounts: [{
                holder: 'Solide Technology Limited',
                bank: 'SYSTEM PAY SERVICES (MALTA) LIMITED',
                bank_address: WIRE_BENEFICIARY.bankAddress,
                swift: 'SYPLMTM2XXX',
                iban: 'MT12SYPL39480821090981701607644',
                is_primary: true,
            }],
        }];
        await expect(getWireBeneficiary(fakeClient(rows), 'jur-1'))
            .resolves.toEqual(WIRE_BENEFICIARY);
    });

    it('sert le compte de la juridiction quand elle en declare un', async () => {
        // La promesse du point de substitution unique : le jour ou une
        // juridiction encaisse sur son propre compte, rien d'autre ne bouge.
        const rows = [
            { jurisdiction_id: null, bank_accounts: [{ holder: 'Defaut', bank: 'B', swift: 'S', iban: 'MT00', is_primary: true }] },
            { jurisdiction_id: 'jur-dj', bank_accounts: [{ holder: 'Tresor Djibouti', bank: 'BCD', bank_address: 'Djibouti', swift: 'BCDJDJJD', iban: 'DJ2100', is_primary: true }] },
        ];
        await expect(getWireBeneficiary(fakeClient(rows), 'jur-dj')).resolves.toEqual({
            beneficiary: 'Tresor Djibouti',
            bank: 'BCD',
            bankAddress: 'Djibouti',
            swiftCode: 'BCDJDJJD',
            iban: 'DJ2100',
        });
    });

    it('retombe sur les coordonnees connues si la table est injoignable', async () => {
        // Un document fiscal ne reste pas bloque parce qu'une table de
        // configuration ne repond pas.
        await expect(getWireBeneficiary(fakeClient([], { message: 'boom' }), 'jur-1'))
            .resolves.toEqual(WIRE_BENEFICIARY);
    });
});
