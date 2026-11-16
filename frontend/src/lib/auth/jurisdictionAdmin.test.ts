import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    administersSomething,
    canAdminister,
    getAdminScope,
    isCountryStaffRole,
} from './jurisdictionAdmin';

const SO = '00000000-0000-4000-8000-00000000534f';
const DJ = '11111111-1111-4111-8111-111111111111';

/** Client minimal : `user_jurisdictions` filtré sur l'utilisateur puis sur is_admin. */
function platformReturning(result: { data: Array<{ jurisdiction_id: string }> | null; error: { message: string } | null }) {
    const secondEq = vi.fn(() => Promise.resolve(result));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const select = vi.fn(() => ({ eq: firstEq }));
    const from = vi.fn(() => ({ select }));
    return { client: { from } as unknown as SupabaseClient, from, firstEq, secondEq };
}

describe('getAdminScope', () => {
    it('l’administrateur général administre tout, sans lire aucun rattachement', async () => {
        const { client, from } = platformReturning({ data: [], error: null });

        const scope = await getAdminScope(client, 'u1', 'SUPERADMIN');

        expect(scope).toEqual({ isGeneralAdmin: true, jurisdictionIds: [] });
        expect(from).not.toHaveBeenCalled();
    });

    it('le personnel administre les pays dont le rattachement porte is_admin', async () => {
        const { client, firstEq, secondEq } = platformReturning({
            data: [{ jurisdiction_id: SO }],
            error: null,
        });

        const scope = await getAdminScope(client, 'u1', 'PORT_OFFICER');

        expect(scope).toEqual({ isGeneralAdmin: false, jurisdictionIds: [SO] });
        expect(firstEq).toHaveBeenCalledWith('user_id', 'u1');
        expect(secondEq).toHaveBeenCalledWith('is_admin', true);
    });

    it.each([['SHIPPING_AGENT'], ['SHIPOWNER'], [null], [undefined], ['']])(
        'un rôle hors personnel (%s) n’administre rien, quoi que dise la base',
        async (role) => {
            const { client, from } = platformReturning({ data: [{ jurisdiction_id: SO }], error: null });

            const scope = await getAdminScope(client, 'u1', role);

            expect(scope).toEqual({ isGeneralAdmin: false, jurisdictionIds: [] });
            expect(from).not.toHaveBeenCalled();
        },
    );

    it('lève une erreur si la lecture échoue, plutôt que de répondre « aucun droit »', async () => {
        const { client } = platformReturning({ data: null, error: { message: 'boom' } });

        await expect(getAdminScope(client, 'u1', 'MANAGER')).rejects.toThrow(/boom/);
    });
});

describe('canAdminister', () => {
    it('l’administrateur général peut agir sur n’importe quel pays', () => {
        expect(canAdminister({ isGeneralAdmin: true, jurisdictionIds: [] }, DJ)).toBe(true);
    });

    it('l’administrateur d’un pays n’agit que sur le sien', () => {
        const scope = { isGeneralAdmin: false, jurisdictionIds: [SO] };
        expect(canAdminister(scope, SO)).toBe(true);
        expect(canAdminister(scope, DJ)).toBe(false);
    });
});

describe('administersSomething', () => {
    it('faux sans aucun pays, vrai avec un pays ou pour l’administrateur général', () => {
        expect(administersSomething({ isGeneralAdmin: false, jurisdictionIds: [] })).toBe(false);
        expect(administersSomething({ isGeneralAdmin: false, jurisdictionIds: [SO] })).toBe(true);
        expect(administersSomething({ isGeneralAdmin: true, jurisdictionIds: [] })).toBe(true);
    });
});

describe('isCountryStaffRole', () => {
    it('reconnaît les trois rôles du personnel et eux seuls', () => {
        expect(['PORT_OFFICER', 'FINANCE_ADMIN', 'MANAGER'].every(isCountryStaffRole)).toBe(true);
        expect(['SUPERADMIN', 'SHIPPING_AGENT', 'SHIPOWNER', ''].some(isCountryStaffRole)).toBe(false);
    });
});
