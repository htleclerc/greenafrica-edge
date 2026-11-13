import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listAccessibleJurisdictions } from './accessibleJurisdictions';

const SO = { id: 'jur-so', code: 'SO', name: 'Somaliland' };
const DJ = { id: 'jur-dj', code: 'DJ', name: 'Djibouti' };
const GN = { id: 'jur-gn', code: 'GN', name: 'Guinée' };

interface Fixture {
    role?: string | null;
    all?: typeof SO[];
    memberships?: Array<typeof SO | null>;
    profileError?: string;
    listError?: string;
    membershipError?: string;
}

/** Faux client de session : trois tables, chacune avec la chaîne que le code appelle. */
function client(f: Fixture): { supabase: SupabaseClient; reads: string[] } {
    const reads: string[] = [];
    const supabase = {
        from: (table: string) => {
            reads.push(table);
            if (table === 'profiles') {
                return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
                    data: f.role === undefined ? null : { role: f.role },
                    error: f.profileError ? { message: f.profileError } : null,
                }) }) }) };
            }
            if (table === 'jurisdictions') {
                return { select: async () => ({
                    data: f.listError ? null : (f.all ?? []),
                    error: f.listError ? { message: f.listError } : null,
                }) };
            }
            if (table === 'user_jurisdictions') {
                return { select: () => ({ eq: async () => ({
                    data: f.membershipError ? null : (f.memberships ?? []).map((j) => ({
                        jurisdiction_id: j?.id ?? 'orphan', jurisdictions: j,
                    })),
                    error: f.membershipError ? { message: f.membershipError } : null,
                }) }) };
            }
            throw new Error(`table inattendue : ${table}`);
        },
    } as unknown as SupabaseClient;
    return { supabase, reads };
}

describe('listAccessibleJurisdictions — administrateur général', () => {
    it('voit tous les pays sans être rattaché à aucun', async () => {
        const { supabase, reads } = client({ role: 'SUPERADMIN', all: [SO, GN, DJ], memberships: [] });
        const res = await listAccessibleJurisdictions(supabase, 'u1');
        expect(res.isGeneralAdmin).toBe(true);
        expect(res.jurisdictions.map((j) => j.code)).toEqual(['DJ', 'GN', 'SO']);
        // Ses rattachements ne comptent pas : on ne les lit même pas.
        expect(reads).not.toContain('user_jurisdictions');
    });

    it('n\'a accès à rien si aucun pays n\'existe, sans lever', async () => {
        const { supabase } = client({ role: 'SUPERADMIN', all: [] });
        expect(await listAccessibleJurisdictions(supabase, 'u1')).toEqual({ isGeneralAdmin: true, jurisdictions: [] });
    });
});

describe('listAccessibleJurisdictions — personnel d\'un pays', () => {
    it.each(['FINANCE_ADMIN', 'MANAGER', 'PORT_OFFICER'])('%s ne voit que ses rattachements', async (role) => {
        const { supabase, reads } = client({ role, all: [SO, DJ, GN], memberships: [SO] });
        const res = await listAccessibleJurisdictions(supabase, 'u1');
        expect(res).toEqual({ isGeneralAdmin: false, jurisdictions: [SO] });
        expect(reads).not.toContain('jurisdictions');
    });

    it('trie plusieurs rattachements par code', async () => {
        const { supabase } = client({ role: 'MANAGER', memberships: [SO, DJ] });
        const res = await listAccessibleJurisdictions(supabase, 'u1');
        expect(res.jurisdictions.map((j) => j.code)).toEqual(['DJ', 'SO']);
    });

    it('n\'a accès à rien sans rattachement', async () => {
        const { supabase } = client({ role: 'MANAGER', memberships: [] });
        expect((await listAccessibleJurisdictions(supabase, 'u1')).jurisdictions).toEqual([]);
    });

    it('ignore un rattachement dont le pays n\'est pas lisible', async () => {
        const { supabase } = client({ role: 'MANAGER', memberships: [SO, null] });
        expect((await listAccessibleJurisdictions(supabase, 'u1')).jurisdictions).toEqual([SO]);
    });

    it('traite un profil introuvable comme du personnel sans droit particulier', async () => {
        const { supabase } = client({ memberships: [SO] });
        expect(await listAccessibleJurisdictions(supabase, 'u1')).toEqual({ isGeneralAdmin: false, jurisdictions: [SO] });
    });
});

describe('listAccessibleJurisdictions — erreurs de lecture', () => {
    it('lève si le profil est illisible, plutôt que de conclure « aucun pays »', async () => {
        const { supabase } = client({ role: 'MANAGER', profileError: 'boom' });
        await expect(listAccessibleJurisdictions(supabase, 'u1')).rejects.toThrow(/profil illisible/);
    });

    it('lève si la liste des pays est illisible', async () => {
        const { supabase } = client({ role: 'SUPERADMIN', listError: 'boom' });
        await expect(listAccessibleJurisdictions(supabase, 'u1')).rejects.toThrow(/pays illisibles/);
    });

    it('lève si les rattachements sont illisibles', async () => {
        const { supabase } = client({ role: 'MANAGER', membershipError: 'boom' });
        await expect(listAccessibleJurisdictions(supabase, 'u1')).rejects.toThrow(/rattachements illisibles/);
    });
});
