import { describe, it, expect } from 'vitest';
import { ownerAccessBlockers, isReachable } from './ownerAccessBlockers';

const ok = {
    officialEmail: 'billing@armateur.com',
    accountState: 'ACTIVE',
    isOfacSdn: false,
    isUnProhibited: false,
};

describe('ownerAccessBlockers', () => {
    it('ne signale rien sur un armateur joignable et actif', () => {
        expect(ownerAccessBlockers(ok)).toEqual([]);
    });

    it("signale l'absence d'adresse de facturation", () => {
        // Cas réel de « À identifier » : 83 pro-formas, aucun destinataire.
        expect(ownerAccessBlockers({ ...ok, officialEmail: null })).toEqual(['NO_EMAIL']);
        expect(ownerAccessBlockers({ ...ok, officialEmail: '   ' })).toEqual(['NO_EMAIL']);
    });

    it('distingue un compte jamais créé d’une invitation restée sans suite', () => {
        // Les deux empêchent l'accès au portail, mais pas pour la même raison :
        // l'un demande une invitation, l'autre une relance de l'invitation.
        expect(ownerAccessBlockers({ ...ok, accountState: 'GHOST' })).toEqual(['NO_ACCOUNT']);
        expect(ownerAccessBlockers({ ...ok, accountState: 'INVITED' })).toEqual(['INVITE_PENDING']);
    });

    it('place les sanctions en tête', () => {
        // Seul empêchement qui interdit d'agir, au lieu de constater une
        // impossibilité technique — il doit se lire en premier.
        const b = ownerAccessBlockers({ ...ok, isOfacSdn: true, officialEmail: null, accountState: 'GHOST' });
        expect(b[0]).toBe('SANCTIONED');
        expect(b).toEqual(['SANCTIONED', 'NO_EMAIL', 'NO_ACCOUNT']);
    });

    it('retient aussi le régime UN seul', () => {
        expect(ownerAccessBlockers({ ...ok, isUnProhibited: true })).toEqual(['SANCTIONED']);
    });
});

describe('isReachable', () => {
    it('reste vrai pour un compte non activé mais joignable par e-mail', () => {
        // Une relance atteint son destinataire même sans compte portail :
        // l'e-mail porte la facture en pièce jointe.
        expect(isReachable({ ...ok, accountState: 'GHOST' })).toBe(true);
    });

    it('devient faux sans adresse', () => {
        expect(isReachable({ ...ok, officialEmail: null })).toBe(false);
    });

    it('devient faux sous sanctions, même avec une adresse valide', () => {
        expect(isReachable({ ...ok, isOfacSdn: true })).toBe(false);
    });
});
