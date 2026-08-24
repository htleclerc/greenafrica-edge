import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listOwnerMembers } from './ownerMembersService';

function client(result: { data?: unknown[]; error?: { message: string } }) {
    const select = vi.fn(() => chain);
    const chain: Record<string, unknown> = {
        select,
        eq: () => chain,
        order: () => chain,
        then: (resolve: (v: unknown) => void) =>
            resolve({ data: result.data ?? null, error: result.error ?? null }),
    };
    return {
        db: { from: () => chain } as unknown as SupabaseClient,
        select,
    };
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
    profiles: { email: 'compta@horn.example', full_name: 'Amina Haji' },
    ...over,
});

describe('listOwnerMembers', () => {
    /**
     * REGRESSION (2026-08-24) — `owner_members` référence `profiles` deux fois :
     * le membre (`profile_id`) et celui qui l'a invité (`invited_by`). Un embed
     * qui ne nomme pas la contrainte est refusé par PostgREST (PGRST201), la
     * lecture échoue, et l'écran annonçait « aucun membre » alors qu'il y en a.
     */
    it('nomme la contrainte, sans quoi l’embed est ambigu', async () => {
        const { db, select } = client({ data: [row()] });
        await listOwnerMembers(db, 'so-1');
        const projection = select.mock.calls[0][0] as unknown as string;
        expect(projection).toContain('profiles!owner_members_profile_id_fkey');
        expect(projection).not.toContain('profiles!inner');
    });

    it('rend la vue attendue par l’écran', async () => {
        const { db } = client({ data: [row()] });
        const [member] = await listOwnerMembers(db, 'so-1');
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

    it('accepte un profil rendu en tableau — PostgREST varie selon la cardinalité', async () => {
        const { db } = client({ data: [row({ profiles: [{ email: 'a@b.c', full_name: null }] })] });
        const [member] = await listOwnerMembers(db, 'so-1');
        expect(member.email).toBe('a@b.c');
        expect(member.fullName).toBeNull();
    });

    it('rend une liste vide sur erreur, sans faire tomber la page', async () => {
        const { db } = client({ error: { message: 'PGRST201' } });
        await expect(listOwnerMembers(db, 'so-1')).resolves.toEqual([]);
    });
});
