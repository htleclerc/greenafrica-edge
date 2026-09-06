import { describe, it, expect } from 'vitest';
import { listPlatformUsers, matchesUserSearch, type PlatformUser } from './platformUsersService';

/** Deux clients : la session (RLS) ne rend que les comptes vus ; la plateforme joint. */
function clients(data: Record<string, unknown[]>, opts: { rpc?: unknown[] } = {}) {
    const seen: { client: string; table: string; filters: [string, unknown][] }[] = [];
    const make = (name: string) => ({
        from: (table: string) => {
            const entry = { client: name, table, filters: [] as [string, unknown][] };
            seen.push(entry);
            const chain: Record<string, unknown> = {};
            chain.select = () => chain;
            chain.in = (c: string, v: unknown) => { entry.filters.push([c, v]); return chain; };
            chain.eq = (c: string, v: unknown) => { entry.filters.push([c, v]); return chain; };
            chain.then = (res: (v: unknown) => unknown) =>
                Promise.resolve({ data: data[`${name}:${table}`] ?? data[table] ?? [], error: null }).then(res);
            return chain;
        },
        rpc: async () => ({ data: opts.rpc ?? [], error: null }),
    });
    return { session: make('session') as never, platform: make('platform') as never, seen };
}

const OWNERS = [
    { id: 'own-1', name: 'HORN SHIPPING', public_ref: 'arm_000000000001', account_state: 'ACTIVE', profile_id: 'p-holder', official_email: 'ops@horn.example', created_at: '2026-08-01' },
    { id: 'own-2', name: 'GHOST LINES', public_ref: 'arm_000000000002', account_state: 'GHOST', profile_id: null, official_email: 'x@ghost.example', created_at: '2026-08-02' },
];

describe('listPlatformUsers', () => {
    it('unit titulaires, membres, représentants et staff, avec dernière connexion', async () => {
        const { session, platform } = clients({
            shipowners: OWNERS,
            vessels: [{ shipowner_id: 'own-1', imo_number: '9167057' }],
            owner_members: [{
                id: 'm1', public_ref: 'mbr_000000000001', shipowner_id: 'own-1', profile_id: 'p-member', active: true, created_at: '2026-08-24',
                can_pay: true, can_dispute: false, can_manage_vessels: false, can_invite: false,
                profiles: { id: 'p-member', email: 'compta@horn.example', full_name: 'Amina Haji' },
            }],
            owner_agent_mappings: [{
                id: 'r1', shipowner_id: 'own-1', agent_profile_id: 'p-rep', active: true, created_at: '2026-07-01',
                profiles: [{ id: 'p-rep', email: 'agent@berbera.example', full_name: 'Berbera Agency' }],
            }],
            profiles: [{ id: 'p-holder', email: 'ops@horn.example', full_name: 'Horn Ops', is_active: true }],
        }, { rpc: [{ profile_id: 'p-member', last_sign_in_at: '2026-09-05T10:00:00Z' }] });

        const users = await listPlatformUsers(session, platform, { includeStaff: false });
        const kinds = users.map((u) => `${u.kind}:${u.email}`).sort();
        expect(kinds).toEqual([
            'MEMBER:compta@horn.example',
            'OWNER:ops@horn.example',
            'OWNER:x@ghost.example',
            'REPRESENTATIVE:agent@berbera.example',
        ]);
        const member = users.find((u) => u.kind === 'MEMBER')!;
        expect(member.memberRef).toBe('mbr_000000000001');
        expect(member.ownerRef).toBe('arm_000000000001');
        expect(member.privileges).toEqual({ canPay: true, canDispute: false, canManageVessels: false, canInvite: false });
        expect(member.lastSignInAt).toBe('2026-09-05T10:00:00Z');
        expect(member.imos).toEqual(['9167057']);
        const ghost = users.find((u) => u.ownerRef === 'arm_000000000002')!;
        expect(ghost.active).toBe(false);
        expect(ghost.lastSignInAt).toBeNull();
    });

    it('ne lit membres et représentants que pour les comptes que la session voit', async () => {
        const { session, platform, seen } = clients({ shipowners: OWNERS });
        await listPlatformUsers(session, platform, { includeStaff: false });
        const members = seen.find((s) => s.client === 'platform' && s.table === 'owner_members')!;
        expect(members.filters).toEqual([['shipowner_id', ['own-1', 'own-2']]]);
        const reps = seen.find((s) => s.client === 'platform' && s.table === 'owner_agent_mappings')!;
        expect(reps.filters).toEqual([['shipowner_id', ['own-1', 'own-2']], ['active', true]]);
    });

    it("n'inclut le staff que sur demande (SUPERADMIN)", async () => {
        const { session, platform, seen } = clients({
            shipowners: [],
            'platform:profiles': [{ id: 's1', email: 'admin@greengate.africa', full_name: 'Admin', role: 'SUPERADMIN', is_active: true }],
        });
        expect(await listPlatformUsers(session, platform, { includeStaff: false })).toEqual([]);
        expect(seen.some((s) => s.table === 'profiles')).toBe(false);
        const withStaff = await listPlatformUsers(session, platform, { includeStaff: true });
        expect(withStaff.map((u) => u.kind)).toEqual(['STAFF']);
        expect(withStaff[0].role).toBe('SUPERADMIN');
    });
});

describe('matchesUserSearch', () => {
    const u: PlatformUser = {
        key: 'k', kind: 'MEMBER', fullName: 'Amina Haji', email: 'compta@horn.example', role: null,
        ownerRef: 'arm_1', ownerName: 'HORN SHIPPING', ownerState: 'ACTIVE', memberRef: 'mbr_1',
        privileges: null, active: true, lastSignInAt: null, createdAt: null, imos: ['9167057'],
    };
    it('cherche sur le nom, l’e-mail, le compte et l’IMO', () => {
        expect(matchesUserSearch(u, 'amina')).toBe(true);
        expect(matchesUserSearch(u, 'HORN')).toBe(true);
        expect(matchesUserSearch(u, '9167057')).toBe(true);
        expect(matchesUserSearch(u, 'compta@')).toBe(true);
        expect(matchesUserSearch(u, 'zzz')).toBe(false);
        expect(matchesUserSearch(u, '  ')).toBe(true);
    });
});
