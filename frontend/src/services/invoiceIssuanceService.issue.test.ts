import { describe, it, expect } from 'vitest';
import { assertLineItemsMatchTotal } from './invoiceIssuanceService';

describe('assertLineItemsMatchTotal', () => {
    const line = (amount: number) => ({
        zone: 'EEZ', days: 1, emissionsTco2: 1, rate: amount, amount,
    });

    it('accepte des lignes dont la somme égale le total', () => {
        expect(() => assertLineItemsMatchTotal([line(100), line(50)], 150)).not.toThrow();
    });

    it("tolère un écart d'arrondi au cent", () => {
        expect(() => assertLineItemsMatchTotal([line(100.004)], 100)).not.toThrow();
    });

    it('rejette une somme qui contredit le total', () => {
        expect(() => assertLineItemsMatchTotal([line(100)], 150))
            .toThrow(/lineItems sum 100.*does not match tax_amount_usd 150/);
    });

    it('rejette une liste vide', () => {
        expect(() => assertLineItemsMatchTotal([], 150)).toThrow(/at least one line item/);
    });
});
