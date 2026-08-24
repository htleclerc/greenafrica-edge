import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockSignOut = vi.fn();
const tables: Record<string, unknown> = {};

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({
        auth: { getUser: mockGetUser, signOut: mockSignOut },
        // Le stub HONORE les filtres : sans cela, la lecture par `profile_id` et
        // celle du compte de l'appartenance rendraient la même ligne, et le
        // chemin « membre » ne serait jamais emprunté.
        from: (table: string) => {
            const filters: Record<string, unknown> = {};
            const chain: Record<string, unknown> = {};
            chain.select = () => chain;
            chain.limit = () => chain;
            chain.eq = (col: string, val: unknown) => { filters[col] = val; return chain; };
            chain.maybeSingle = async () => {
                const row = tables[table] as Record<string, unknown> | null | undefined;
                if (!row) return { data: null, error: null };
                for (const [col, val] of Object.entries(filters)) {
                    if (row[col] !== val) return { data: null, error: null };
                }
                return { data: row, error: null };
            };
            return chain;
        },
    })),
}));

// redirect() doit lever pour que la fonction court-circuite, comme en vrai.
vi.mock('next/navigation', () => ({
    redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

const { requireOwner } = await import('../requireOwner');

const activeOwner = {
    id: 'so-1', name: 'Horn Shipping', country_code: 'SO', address: null,
    official_email: 'ops@horn.example', official_email_source: 'AGENT_CLAIM',
    account_state: 'ACTIVE', profile_id: 'holder-1', imo_company_no: '1234567',
    invited_at: null, kyc_level_c_completed_at: null, aoc_number: null,
    jurisdiction_id: 'j1',
};

beforeEach(() => {
    for (const k of Object.keys(tables)) delete tables[k];
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'holder-1', email: 'ops@horn.example' } }, error: null });
});

describe('requireOwner — titulaire', () => {
    it('détient toutes les sous-permissions, sans ligne owner_members', async () => {
        tables.shipowners = activeOwner;
        const s = await requireOwner();
        expect(s.isMember).toBe(false);
        expect(s.privileges).toEqual({
            canPay: true, canDispute: true, canManageVessels: true, canInvite: true,
        });
    });

    it('passe toutes les exigences, y compris « holder »', async () => {
        tables.shipowners = activeOwner;
        await expect(requireOwner('holder')).resolves.toBeTruthy();
        await expect(requireOwner('canPay')).resolves.toBeTruthy();
    });
});

describe('requireOwner — membre invité', () => {
    beforeEach(() => {
        // Le compte existe, mais son profile_id est celui du titulaire : la
        // lecture par profile_id ne rend donc rien pour le membre, et c'est
        // l'appartenance qui le résout — comme en vrai (mig 135).
        tables.shipowners = activeOwner;
        tables.owner_members = {
            profile_id: 'member-9', active: true, shipowner_id: 'so-1',
            can_pay: true, can_dispute: false, can_manage_vessels: false, can_invite: false,
        };
    });

    it('résout le compte et porte ses privilèges', async () => {
        // Le titulaire n'est pas cet utilisateur : profile_id ne correspond pas.
        mockGetUser.mockResolvedValue({ data: { user: { id: 'member-9', email: 'compta@horn.example' } }, error: null });
        const s = await requireOwner();
        expect(s.shipowner.id).toBe('so-1');
        expect(s.privileges.canPay).toBe(true);
        expect(s.privileges.canDispute).toBe(false);
    });
});

describe('requireOwner — les refus', () => {
    beforeEach(() => {
        tables.shipowners = activeOwner;
        tables.owner_members = {
            profile_id: 'member-9', active: true, shipowner_id: 'so-1',
            can_pay: false, can_dispute: false, can_manage_vessels: false, can_invite: false,
        };
        mockGetUser.mockResolvedValue({ data: { user: { id: 'member-9', email: 'x@horn.example' } }, error: null });
    });

    // Le refus est un redirect, pas une valeur : ces actions n'ont pas de chemin
    // d'échec côté appelant, une valeur les laisserait continuer sans droit.
    it('renvoie le membre sans le droit exigé', async () => {
        await expect(requireOwner('canPay')).rejects.toThrow(/REDIRECT:.*forbidden/);
    });

    // L'identité légale et bancaire ne se délègue pas par une case à cocher.
    it('réserve « holder » au titulaire, même à un membre tout-puissant', async () => {
        tables.owner_members = {
            profile_id: 'member-9', active: true, shipowner_id: 'so-1',
            can_pay: true, can_dispute: true, can_manage_vessels: true, can_invite: true,
        };
        await expect(requireOwner('holder')).rejects.toThrow(/REDIRECT:.*forbidden/);
    });

    // Un compte suspendu se refuse à tout le monde, avec le même message, avant
    // toute question de permission.
    it('bloque sur l’état du compte avant de regarder les droits', async () => {
        tables.shipowners = { ...activeOwner, account_state: 'SUSPENDED' };
        await expect(requireOwner('canPay')).rejects.toThrow(/REDIRECT:.*state_suspended/);
    });
});
