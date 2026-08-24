import { describe, it, expect } from 'vitest';
import {
    isClaimable, outstandingUsd, paidUsd,
    NON_CLAIMABLE_STATUSES, SETTLED_STATUSES,
} from './outstanding';

describe('outstandingUsd', () => {
    it('retranche les paiements confirmés', () => {
        // La flotte sommait le montant plein : l'armateur voyait 1 000 là où la
        // plateforme lui réclamait 400.
        expect(outstandingUsd({ status: 'PARTIALLY_PAID', tax_amount_usd: 1000 }, 600)).toBe(400);
    });

    it('retient aussi les règlements antérieurs à la table payments', () => {
        // `partial_paid_usd` porte la SEULE trace des factures soldées avant le
        // rail v7 (backfill mig 022, table `payments` démarrée vide en mig 048).
        // L'ignorer faisait ressortir cinq factures soldées comme dues pour
        // 32 482 USD sur staging.
        expect(outstandingUsd({ status: 'OVERDUE', tax_amount_usd: 8256, partial_paid_usd: 8000 }, 0))
            .toBe(256);
    });

    it('retient le plus grand des deux encaissements, jamais leur somme', () => {
        // Ils couvrent deux époques, pas deux règlements distincts.
        expect(outstandingUsd({ status: 'PENDING', tax_amount_usd: 1000, partial_paid_usd: 400 }, 250)).toBe(600);
        expect(outstandingUsd({ status: 'PENDING', tax_amount_usd: 1000, partial_paid_usd: 250 }, 400)).toBe(600);
    });

    it('ne réclame rien sur une facture marquée payée', () => {
        // Le statut PAID est l'affirmation de règlement de la plateforme
        // (recompute_transaction_status, mig 051). Une trace manquante est une
        // anomalie à signaler, pas une somme à réclamer au débiteur.
        expect(outstandingUsd({ status: 'PAID', tax_amount_usd: 12500 }, 0)).toBe(0);
    });

    it('ne réclame rien sur une facture annulée, exemptée ou remplacée par un avoir', () => {
        for (const status of NON_CLAIMABLE_STATUSES) {
            expect(outstandingUsd({ status, tax_amount_usd: 1000 }, 0)).toBe(0);
        }
    });

    it('laisse due une facture contestée', () => {
        // Une contestation est une demande, pas une extinction — même règle que
        // la vue v_transaction_outstanding.
        expect(outstandingUsd({ status: 'DISPUTED', tax_amount_usd: 1000 }, 300)).toBe(700);
    });

    it('ne rend jamais un avoir', () => {
        expect(outstandingUsd({ status: 'PENDING', tax_amount_usd: 100 }, 130)).toBe(0);
    });

    it('accepte les numériques rendus en chaîne par PostgREST', () => {
        expect(outstandingUsd({ status: 'PENDING', tax_amount_usd: '250.50', partial_paid_usd: '50.50' })).toBe(200);
    });
});

describe('paidUsd', () => {
    it('ne borne pas l encaissement au montant facturé', () => {
        // Un trop-perçu doit rester visible pour être remboursé.
        expect(paidUsd({ status: 'PENDING', tax_amount_usd: 100 }, 130)).toBe(130);
    });
});

describe('isClaimable', () => {
    it('garde les factures payées dans le périmètre réclamable', () => {
        // La colonne sert aux totaux facturé/payé : en sortir les factures
        // soldées ferait diminuer le total facturé à mesure qu'un dossier règle.
        expect(isClaimable('PAID')).toBe(true);
        expect(isClaimable('PENDING')).toBe(true);
        expect(isClaimable('DISPUTED')).toBe(true);
    });

    it('exclut ce qui n ouvre aucune créance', () => {
        for (const status of NON_CLAIMABLE_STATUSES) expect(isClaimable(status)).toBe(false);
    });

    it('énumère les mêmes statuts que la vue SQL', () => {
        expect([...NON_CLAIMABLE_STATUSES]).toEqual(['VOID', 'EXEMPT', 'CREDIT_NOTE_ISSUED']);
        expect([...SETTLED_STATUSES]).toEqual(['VOID', 'EXEMPT', 'CREDIT_NOTE_ISSUED', 'PAID']);
    });
});
