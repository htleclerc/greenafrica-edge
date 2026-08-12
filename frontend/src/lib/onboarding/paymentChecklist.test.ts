import { describe, it, expect } from 'vitest';
import { derivePaymentChecklist, isChecklistComplete } from './paymentChecklist';

const FRESH = {
    accountState: 'ACTIVE',
    hasAttachedVessel: false,
    billingComplete: false,
    hasConfirmedPayment: false,
};

describe('derivePaymentChecklist', () => {
    it('retourne les quatre items dans l\'ordre du parcours', () => {
        expect(derivePaymentChecklist(FRESH).map((i) => i.key))
            .toEqual(['account', 'vessel', 'billing', 'payment']);
    });

    it('coche le compte quand il est ACTIVE', () => {
        const items = derivePaymentChecklist(FRESH);
        expect(items.find((i) => i.key === 'account')?.done).toBe(true);
    });

    it('ne coche pas le compte tant qu\'il est GHOST', () => {
        const items = derivePaymentChecklist({ ...FRESH, accountState: 'GHOST' });
        expect(items.find((i) => i.key === 'account')?.done).toBe(false);
    });

    it('se décoche si l\'état régresse — c\'est l\'intérêt d\'une dérivation', () => {
        const done = derivePaymentChecklist({
            accountState: 'ACTIVE', hasAttachedVessel: true,
            billingComplete: true, hasConfirmedPayment: true,
        });
        expect(isChecklistComplete(done)).toBe(true);

        const regressed = derivePaymentChecklist({
            accountState: 'ACTIVE', hasAttachedVessel: true,
            billingComplete: false, hasConfirmedPayment: true,
        });
        expect(isChecklistComplete(regressed)).toBe(false);
    });

    it('isChecklistComplete est faux tant qu\'un item manque', () => {
        expect(isChecklistComplete(derivePaymentChecklist(FRESH))).toBe(false);
    });
});
