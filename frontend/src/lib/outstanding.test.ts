import { describe, it, expect } from 'vitest';
import { isOutstanding, outstandingUsd, OUTSTANDING_STATUSES } from './outstanding';

describe('outstandingUsd', () => {
    it('retranche ce qui a deja ete encaisse', () => {
        // Le calcul de la flotte ignorait `partial_paid_usd` : l'armateur
        // voyait 1 000 la ou la plateforme lui reclamait 400.
        expect(outstandingUsd({ status: 'PARTIALLY_PAID', tax_amount_usd: 1000, partial_paid_usd: 600 })).toBe(400);
    });

    it('rend zero sur un statut qui ne doit rien', () => {
        expect(outstandingUsd({ status: 'PAID', tax_amount_usd: 1000, partial_paid_usd: 1000 })).toBe(0);
        expect(outstandingUsd({ status: 'VOID', tax_amount_usd: 1000 })).toBe(0);
        expect(outstandingUsd({ status: 'DISPUTED', tax_amount_usd: 1000 })).toBe(0);
    });

    it('traite l absence de reglement partiel comme zero', () => {
        expect(outstandingUsd({ status: 'PENDING', tax_amount_usd: 500, partial_paid_usd: null })).toBe(500);
        expect(outstandingUsd({ status: 'OVERDUE', tax_amount_usd: 500 })).toBe(500);
    });

    it('ne rend jamais un avoir', () => {
        // Un sur-encaissement se regle par un remboursement, pas par une dette
        // negative qui viendrait effacer une autre facture dans un total.
        expect(outstandingUsd({ status: 'PENDING', tax_amount_usd: 100, partial_paid_usd: 130 })).toBe(0);
    });

    it('accepte les numeriques rendus en chaine par PostgREST', () => {
        expect(outstandingUsd({ status: 'PENDING', tax_amount_usd: '250.50', partial_paid_usd: '50.50' })).toBe(200);
    });

    it('retranche le montant encaisse passe en second argument', () => {
        // Source reelle de l'encaissement : les paiements CONFIRMED.
        expect(outstandingUsd({ status: 'PARTIALLY_PAID', tax_amount_usd: 68832, partial_paid_usd: 0 }, 12055.57))
            .toBeCloseTo(56776.43, 2);
    });

    it('retient le plus grand des deux encaissements connus, jamais leur somme', () => {
        // Les additionner compterait deux fois une ligne renseignee par le
        // backfill de la migration 022.
        expect(outstandingUsd({ status: 'PENDING', tax_amount_usd: 1000, partial_paid_usd: 400 }, 250)).toBe(600);
        expect(outstandingUsd({ status: 'PENDING', tax_amount_usd: 1000, partial_paid_usd: 250 }, 400)).toBe(600);
    });

    it('rend zero quand l encaissement couvre le montant', () => {
        expect(outstandingUsd({ status: 'PARTIALLY_PAID', tax_amount_usd: 1000 }, 1200)).toBe(0);
    });

    it('isOutstanding couvre exactement les trois statuts debiteurs', () => {
        expect(OUTSTANDING_STATUSES).toEqual(['PENDING', 'PARTIALLY_PAID', 'OVERDUE']);
        expect(isOutstanding('PENDING')).toBe(true);
        expect(isOutstanding('PAID')).toBe(false);
        expect(isOutstanding(null)).toBe(false);
    });
});
