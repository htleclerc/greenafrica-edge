import { describe, it, expect } from 'vitest';
import { hasSettlementRights } from './requireSettlementRights';
import { UserRole } from '@/types/secure';

/**
 * Règle du rail monétaire (mig 130). Ce que ces cas tiennent :
 *   - le drapeau est ADDITIF, il n'enlève jamais un droit porté par le rôle ;
 *   - il n'ouvre le rail qu'aux comptes actifs ;
 *   - il ne fait entrer personne d'autre par accident.
 */
describe('hasSettlementRights', () => {
    it('accorde le droit par le role, drapeau ou pas', () => {
        for (const role of [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]) {
            expect(hasSettlementRights({ role, can_settle_payments: false, is_active: true })).toBe(true);
            expect(hasSettlementRights({ role, can_settle_payments: true, is_active: true })).toBe(true);
        }
    });

    it('accorde le droit a un MANAGER dont la case est cochee', () => {
        expect(
            hasSettlementRights({ role: UserRole.MANAGER, can_settle_payments: true, is_active: true }),
        ).toBe(true);
    });

    it('refuse un MANAGER sans la case', () => {
        expect(
            hasSettlementRights({ role: UserRole.MANAGER, can_settle_payments: false, is_active: true }),
        ).toBe(false);
    });

    it('refuse un compte desactive, meme avec la case', () => {
        // Desactiver un compte doit fermer le rail monetaire sans avoir a
        // penser a decocher quoi que ce soit.
        expect(
            hasSettlementRights({ role: UserRole.MANAGER, can_settle_payments: true, is_active: false }),
        ).toBe(false);
        expect(
            hasSettlementRights({ role: UserRole.FINANCE_ADMIN, can_settle_payments: false, is_active: false }),
        ).toBe(false);
    });

    it('refuse un armateur et un agent portuaire par defaut', () => {
        expect(
            hasSettlementRights({ role: UserRole.SHIPPING_AGENT, can_settle_payments: false, is_active: true }),
        ).toBe(false);
        expect(
            hasSettlementRights({ role: UserRole.PORT_OFFICER, can_settle_payments: false, is_active: true }),
        ).toBe(false);
    });

    it('traite un drapeau absent comme faux', () => {
        expect(hasSettlementRights({ role: UserRole.MANAGER, is_active: true })).toBe(false);
    });
});
