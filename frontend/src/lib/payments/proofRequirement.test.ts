import { describe, it, expect } from 'vitest';
import { RAILS_REQUIRING_PROOF, railRequiresProof } from './proofRequirement';

describe('railRequiresProof', () => {
    it('exige une pièce sur les rails que l armateur déclare', () => {
        // Virement, mobile money, paiement par un tiers : la plateforme ne voit
        // pas le versement passer. Sans pièce, le service financier n'a rien à
        // rapprocher et la facture reste ouverte.
        expect(railRequiresProof('WIRE_TRANSFER')).toBe(true);
        expect(railRequiresProof('MOBILE_MONEY')).toBe(true);
        expect(railRequiresProof('THIRD_PARTY')).toBe(true);
    });

    it('n en exige aucune quand la plateforme constate elle-même l encaissement', () => {
        // Stripe et PayPal se confirment par webhook ou capture au retour ;
        // le portefeuille est une écriture interne.
        expect(railRequiresProof('STRIPE')).toBe(false);
        expect(railRequiresProof('PAYPAL')).toBe(false);
        expect(railRequiresProof('WALLET')).toBe(false);
    });

    it('traite un rail absent comme n exigeant rien', () => {
        // La garde ne doit pas bloquer l'écran avant qu'un rail soit choisi.
        expect(railRequiresProof(null)).toBe(false);
        expect(railRequiresProof(undefined)).toBe(false);
        expect(railRequiresProof('')).toBe(false);
    });

    it('énumère exactement les trois rails déclaratifs', () => {
        expect([...RAILS_REQUIRING_PROOF]).toEqual(['WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY']);
    });
});
