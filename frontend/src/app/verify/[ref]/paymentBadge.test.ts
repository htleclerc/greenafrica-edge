import { describe, it, expect } from 'vitest';
import { paymentBadge, type VerifyStatus } from './paymentBadge';

/**
 * Depuis la rebascule du livre (mig 128), une transaction peut porter le
 * statut VOID : la pro-forma du seed qui occupait la référence a été annulée
 * au profit de celle réellement envoyée le 19/08/2026.
 *
 * Le repli `status ?? 'PENDING'` faisait afficher « To Pay » sur une facture
 * annulée — on aurait annoncé à un vérificateur qu'une créance éteinte est
 * due. La RPC filtre déjà sur content_hash, donc les deux lignes d'une même
 * référence ne se confondent pas ; il reste à ne pas présenter l'annulée
 * comme exigible.
 */
const PROFORMA = { kind: 'proforma' as const };
const RECEIPT = { kind: 'receipt' as const };
const REFUND = { kind: 'refund' as const };

describe('paymentBadge', () => {
    it('annonce une pro-forma annulée comme annulée, pas comme due', () => {
        const badge = paymentBadge(PROFORMA, 'VOID');
        expect(badge?.label).toBe('Cancelled');
        expect(badge?.label).not.toBe('To Pay');
    });

    it('annonce un reçu annulé comme annulé, pas comme impayé', () => {
        const badge = paymentBadge(RECEIPT, 'VOID');
        expect(badge?.label).toBe('Cancelled');
        expect(badge?.label).not.toBe('Unpaid');
    });

    it('traite CREDIT_NOTE_ISSUED comme annulé', () => {
        expect(paymentBadge(PROFORMA, 'CREDIT_NOTE_ISSUED')?.label).toBe('Cancelled');
    });

    it('laisse un remboursement sans pastille', () => {
        expect(paymentBadge(REFUND, 'VOID')).toBeNull();
    });

    it('ne change rien aux statuts existants', () => {
        expect(paymentBadge(PROFORMA, 'PENDING')?.label).toBe('To Pay');
        expect(paymentBadge(PROFORMA, 'OVERDUE')?.label).toBe('Overdue');
        expect(paymentBadge(PROFORMA, 'PAID')?.label).toBe('Paid in Advance');
        expect(paymentBadge(RECEIPT, 'PAID')?.label).toBe('Paid');
        expect(paymentBadge(RECEIPT, 'OVERDUE')?.label).toBe('In Default of Payment');
        expect(paymentBadge(RECEIPT, 'PENDING')?.label).toBe('Unpaid');
        expect(paymentBadge(PROFORMA, 'EXEMPT')?.label).toBe('Exempt');
        expect(paymentBadge(PROFORMA, 'DISPUTED')?.label).toBe('Disputed');
    });

    it('conserve le repli « To Pay » quand le statut est absent', () => {
        expect(paymentBadge(PROFORMA, undefined)?.label).toBe('To Pay');
    });

    it('couvre tous les statuts de l’enum sans jamais rendre « To Pay » sur une annulation', () => {
        const all: VerifyStatus[] = ['PAID', 'PENDING', 'PARTIALLY_PAID', 'OVERDUE',
            'EXEMPT', 'DISPUTED', 'CREDIT_NOTE_ISSUED', 'VOID'];
        for (const s of all) {
            const badge = paymentBadge(PROFORMA, s);
            expect(badge, `statut ${s} doit produire une pastille`).not.toBeNull();
            if (s === 'VOID' || s === 'CREDIT_NOTE_ISSUED') {
                expect(badge?.label, `statut ${s}`).toBe('Cancelled');
            }
        }
    });
});
