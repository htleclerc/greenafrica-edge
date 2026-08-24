import { describe, it, expect } from 'vitest';
import {
    privilegesFromMember, clampToGranter, PRIVILEGE_KEYS, PRIVILEGE_COLUMN,
    OWNER_ALL_PRIVILEGES, NO_PRIVILEGES,
} from './ownerPrivileges';

describe('privilegesFromMember', () => {
    it('traduit les quatre drapeaux', () => {
        expect(privilegesFromMember({
            can_pay: true, can_dispute: false, can_manage_vessels: true, can_invite: false,
        })).toEqual({
            canPay: true, canDispute: false, canManageVessels: true, canInvite: false,
        });
    });

    // Un droit ne s'accorde jamais par omission : colonne absente, null, ou
    // valeur inattendue valent tous « non ».
    it('n’accorde rien sur une colonne absente ou nulle', () => {
        expect(privilegesFromMember({ can_pay: null })).toEqual(NO_PRIVILEGES);
        expect(privilegesFromMember({})).toEqual(NO_PRIVILEGES);
    });

    it('n’accorde rien sans ligne d’appartenance', () => {
        expect(privilegesFromMember(null)).toEqual(NO_PRIVILEGES);
        expect(privilegesFromMember(undefined)).toEqual(NO_PRIVILEGES);
    });

    it('exige strictement true — une valeur truthy ne suffit pas', () => {
        expect(privilegesFromMember({ can_pay: 1 as unknown as boolean }).canPay).toBe(false);
    });
});

describe('clampToGranter', () => {
    // Sans cette borne, la délégation transitive serait une escalade : un membre
    // porteur du seul can_invite créerait un compte muni de can_pay.
    it('empêche d’accorder plus que ce qu’on détient', () => {
        const granter = { canPay: false, canDispute: false, canManageVessels: false, canInvite: true };
        const requested = { canPay: true, canDispute: true, canManageVessels: true, canInvite: true };
        expect(clampToGranter(requested, granter)).toEqual({
            canPay: false, canDispute: false, canManageVessels: false, canInvite: true,
        });
    });

    it('laisse passer ce que le donneur détient', () => {
        const granter = { canPay: true, canDispute: true, canManageVessels: false, canInvite: true };
        const requested = { canPay: true, canDispute: false, canManageVessels: true, canInvite: false };
        expect(clampToGranter(requested, granter)).toEqual({
            canPay: true, canDispute: false, canManageVessels: false, canInvite: false,
        });
    });

    it('est sans effet pour le titulaire, qui détient tout', () => {
        const requested = { canPay: true, canDispute: true, canManageVessels: true, canInvite: false };
        expect(clampToGranter(requested, OWNER_ALL_PRIVILEGES)).toEqual(requested);
    });

    it('ne peut rien accorder à partir de rien', () => {
        expect(clampToGranter(OWNER_ALL_PRIVILEGES, NO_PRIVILEGES)).toEqual(NO_PRIVILEGES);
    });
});

describe('table des privilèges', () => {
    it('couvre chaque clé par une colonne — un ajout sans colonne ne s’écrirait pas', () => {
        for (const key of PRIVILEGE_KEYS) {
            expect(PRIVILEGE_COLUMN[key], key).toBeTruthy();
        }
        expect(Object.keys(PRIVILEGE_COLUMN).sort()).toEqual([...PRIVILEGE_KEYS].sort());
    });

    it('décrit exactement les clés des deux constantes', () => {
        expect(Object.keys(OWNER_ALL_PRIVILEGES).sort()).toEqual([...PRIVILEGE_KEYS].sort());
        expect(Object.keys(NO_PRIVILEGES).sort()).toEqual([...PRIVILEGE_KEYS].sort());
    });
});
