import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listOwnerMembers } from './ownerMembersService';

function client(result: { data?: unknown[]; error?: { message: string } }) {
    const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
    return { db: { rpc } as unknown as SupabaseClient, rpc };
}

const row = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
    profile_id: 'p1',
    can_pay: true,
    can_dispute: false,
    can_manage_vessels: false,
    can_invite: false,
    active: true,
    created_at: '2026-08-24T10:00:00Z',
    revoked_at: null,
    email: 'compta@horn.example',
    full_name: 'Amina Haji',
    ...over,
});

describe('listOwnerMembers', () => {
    /**
     * REGRESSION (2026-08-24) — lire la table en joignant `profiles` échouait
     * deux fois de suite : d'abord un embed ambigu (deux clés étrangères vers
     * `profiles`), puis RLS, qui n'accorde à un armateur que SON propre profil.
     * L'écran a annoncé « aucun membre », puis deux tirets à la place des
     * identités. La fonction bornée de la mig 141 règle les deux.
     */
    it('passe par la fonction bornée, jamais par la table', async () => {
        const { db, rpc } = client({ data: [row()] });
        await listOwnerMembers(db);
        expect(rpc).toHaveBeenCalledWith('owner_members_with_identity');
    });

    it('rend la vue attendue par l’écran', async () => {
        const { db } = client({ data: [row()] });
        const [member] = await listOwnerMembers(db);
        expect(member).toMatchObject({
            id: 'm1',
            email: 'compta@horn.example',
            fullName: 'Amina Haji',
            active: true,
            revokedAt: null,
        });
        expect(member.privileges).toEqual({
            canPay: true, canDispute: false, canManageVessels: false, canInvite: false,
        });
    });

    it('rend une liste vide sur erreur, sans faire tomber la page', async () => {
        const { db } = client({ error: { message: 'PGRST201' } });
        await expect(listOwnerMembers(db)).resolves.toEqual([]);
    });
});
