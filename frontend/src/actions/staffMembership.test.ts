import { describe, it, expect, vi, beforeEach } from 'vitest';

// Les deux gestes de l'administration du personnel par pays (mig 174) :
// retirer quelqu'un d'un pays, donner ou retirer le droit de l'administrer.

const SO = '00000000-0000-4000-8000-00000000534f';
const DJ = '11111111-1111-4111-8111-111111111111';
const CALLER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ── État du monde, réglé par chaque test ──────────────────────────────────────
let caller: { role: string; full_name: string; is_active: boolean } | null;
let callerUser: { id: string } | null;
let callerAdminJurisdictions: string[];
let targetMembership: { is_admin: boolean } | null;
let targetRemaining: Array<{ jurisdiction_id: string }>;
let targetProfile: { role: string } | null;
let updatedRows: Array<{ user_id: string }>;
/** La personne est devenue administratrice entre la lecture et la suppression. */
let promotedBeforeDelete: boolean;

const membershipDeleteSpy = vi.fn();
const membershipUpdateSpy = vi.fn();
const profileUpdateSpy = vi.fn();
const auditInsertSpy = vi.fn((_row: unknown) => Promise.resolve({ error: null }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: () =>
        Promise.resolve({
            auth: { getUser: () => Promise.resolve({ data: { user: callerUser } }) },
            from: () => ({
                select: () => ({
                    eq: () => ({ single: () => Promise.resolve({ data: caller, error: null }) }),
                }),
            }),
        }),
}));

function userJurisdictionsTable() {
    return {
        select: (columns: string) => ({
            eq: (_col: string, _val: string) => {
                // « rattachements restants » : un seul filtre, attendu directement.
                const remaining = Promise.resolve({ data: targetRemaining, error: null });
                return Object.assign(remaining, {
                    eq: (col2: string) => {
                        // getAdminScope : filtré sur is_admin.
                        if (col2 === 'is_admin') {
                            return Promise.resolve({
                                data: callerAdminJurisdictions.map((jurisdiction_id) => ({ jurisdiction_id })),
                                error: null,
                            });
                        }
                        // Lecture du rattachement visé.
                        void columns;
                        return {
                            maybeSingle: () => Promise.resolve({ data: targetMembership, error: null }),
                        };
                    },
                });
            },
        }),
        delete: () => {
            const filters: Record<string, unknown> = {};
            const builder = {
                eq: (col: string, val: unknown) => {
                    filters[col] = val;
                    return builder;
                },
                select: () => {
                    const onlyNonAdmin = filters.is_admin === false;
                    membershipDeleteSpy(filters.user_id, filters.jurisdiction_id, onlyNonAdmin);
                    // Une suppression limitée aux non-administrateurs ne touche
                    // rien si la personne l'est devenue entre-temps.
                    const matches = !(onlyNonAdmin && promotedBeforeDelete);
                    return Promise.resolve({
                        data: matches ? [{ user_id: filters.user_id }] : [],
                        error: null,
                    });
                },
            };
            return builder;
        },
        update: (payload: { is_admin: boolean }) => ({
            eq: (_c1: string, userId: string) => ({
                eq: (_c2: string, jurisdictionId: string) => ({
                    select: () => {
                        membershipUpdateSpy(userId, jurisdictionId, payload);
                        return Promise.resolve({ data: updatedRows, error: null });
                    },
                }),
            }),
        }),
    };
}

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        from: (table: string) => {
            if (table === 'user_jurisdictions') return userJurisdictionsTable();
            if (table === 'profiles') {
                return {
                    select: () => ({
                        eq: () => ({ maybeSingle: () => Promise.resolve({ data: targetProfile, error: null }) }),
                    }),
                    update: (payload: { is_active: boolean }) => ({
                        eq: (_c: string, id: string) => {
                            profileUpdateSpy(id, payload);
                            return Promise.resolve({ error: null });
                        },
                    }),
                };
            }
            if (table === 'audit_logs') return { insert: auditInsertSpy };
            throw new Error(`table inattendue : ${table}`);
        },
    }),
}));

const { removeStaffFromJurisdiction } = await import('./removeStaffFromJurisdiction');
const { setJurisdictionAdmin } = await import('./setJurisdictionAdmin');

beforeEach(() => {
    vi.clearAllMocks();
    caller = { role: 'PORT_OFFICER', full_name: 'Admin du pays', is_active: true };
    callerUser = { id: CALLER };
    callerAdminJurisdictions = [SO];
    targetMembership = { is_admin: false };
    targetRemaining = [{ jurisdiction_id: DJ }];
    targetProfile = { role: 'MANAGER' };
    updatedRows = [{ user_id: TARGET }];
    promotedBeforeDelete = false;
});

describe('removeStaffFromJurisdiction', () => {
    const input = { userId: TARGET, jurisdictionId: SO };

    it('l’administrateur du pays retire un agent de son pays', async () => {
        const r = await removeStaffFromJurisdiction(input);

        expect(r).toEqual({ ok: true });
        // La suppression elle-même est limitée aux non-administrateurs.
        expect(membershipDeleteSpy).toHaveBeenCalledWith(TARGET, SO, true);
        expect(auditInsertSpy).toHaveBeenCalledTimes(1);
    });

    // Rattacher puis retirer quelqu'un ne doit pas suffire à fermer son compte.
    it('ne désactive jamais le compte, même s’il ne lui reste aucun pays', async () => {
        targetRemaining = [];

        const r = await removeStaffFromJurisdiction(input);

        expect(r).toEqual({ ok: true });
        expect(profileUpdateSpy).not.toHaveBeenCalled();
    });

    it('ne retire pas quelqu’un devenu administrateur entre la lecture et la suppression', async () => {
        promotedBeforeDelete = true;

        const r = await removeStaffFromJurisdiction(input);

        expect(r).toEqual({ ok: false, reason: 'forbidden' });
        expect(auditInsertSpy).not.toHaveBeenCalled();
    });

    it('refuse un pays que l’appelant n’administre pas', async () => {
        const r = await removeStaffFromJurisdiction({ userId: TARGET, jurisdictionId: DJ });

        expect(r).toEqual({ ok: false, reason: 'forbidden' });
        expect(membershipDeleteSpy).not.toHaveBeenCalled();
    });

    it('refuse un agent sans le droit d’administrer', async () => {
        callerAdminJurisdictions = [];

        const r = await removeStaffFromJurisdiction(input);

        expect(r).toEqual({ ok: false, reason: 'forbidden' });
        expect(membershipDeleteSpy).not.toHaveBeenCalled();
    });

    it('refuse de se retirer soi-même', async () => {
        const r = await removeStaffFromJurisdiction({ userId: CALLER, jurisdictionId: SO });

        expect(r).toEqual({ ok: false, reason: 'self' });
        expect(membershipDeleteSpy).not.toHaveBeenCalled();
    });

    it('un administrateur de pays ne retire pas un autre administrateur', async () => {
        targetMembership = { is_admin: true };

        const r = await removeStaffFromJurisdiction(input);

        expect(r).toEqual({ ok: false, reason: 'forbidden' });
        expect(membershipDeleteSpy).not.toHaveBeenCalled();
    });

    it('l’administrateur général, lui, retire un administrateur de pays', async () => {
        caller = { role: 'SUPERADMIN', full_name: 'Général', is_active: true };
        callerAdminJurisdictions = [];
        targetMembership = { is_admin: true };

        const r = await removeStaffFromJurisdiction(input);

        expect(r.ok).toBe(true);
        expect(membershipDeleteSpy).toHaveBeenCalledWith(TARGET, SO, false);
    });

    it('répond not_found si la personne n’est pas rattachée à ce pays', async () => {
        targetMembership = null;

        const r = await removeStaffFromJurisdiction(input);

        expect(r).toEqual({ ok: false, reason: 'not_found' });
    });

    it('refuse un compte inactif et une session absente', async () => {
        caller = { role: 'PORT_OFFICER', full_name: 'x', is_active: false };
        expect(await removeStaffFromJurisdiction(input)).toEqual({ ok: false, reason: 'forbidden' });

        callerUser = null;
        expect(await removeStaffFromJurisdiction(input)).toEqual({ ok: false, reason: 'not_authenticated' });
    });

    it('refuse une entrée mal formée', async () => {
        const r = await removeStaffFromJurisdiction({ userId: 'pas-un-uuid', jurisdictionId: SO });

        expect(r).toEqual({ ok: false, reason: 'invalid_input' });
    });
});

describe('setJurisdictionAdmin', () => {
    const input = { userId: TARGET, jurisdictionId: SO, isAdmin: true };

    beforeEach(() => {
        caller = { role: 'SUPERADMIN', full_name: 'Général', is_active: true };
    });

    it('l’administrateur général donne le droit d’administrer un pays', async () => {
        const r = await setJurisdictionAdmin(input);

        expect(r).toEqual({ ok: true });
        expect(membershipUpdateSpy).toHaveBeenCalledWith(TARGET, SO, { is_admin: true });
        expect(auditInsertSpy).toHaveBeenCalledTimes(1);
    });

    it('et le retire', async () => {
        const r = await setJurisdictionAdmin({ ...input, isAdmin: false });

        expect(r).toEqual({ ok: true });
        expect(membershipUpdateSpy).toHaveBeenCalledWith(TARGET, SO, { is_admin: false });
    });

    it.each([['PORT_OFFICER'], ['FINANCE_ADMIN'], ['MANAGER']])(
        'un %s ne le donne pas, même administrateur de ce pays',
        async (role) => {
            caller = { role, full_name: 'x', is_active: true };
            callerAdminJurisdictions = [SO];

            const r = await setJurisdictionAdmin(input);

            expect(r).toEqual({ ok: false, reason: 'forbidden' });
            expect(membershipUpdateSpy).not.toHaveBeenCalled();
        },
    );

    it('ne le donne qu’à du personnel', async () => {
        targetProfile = { role: 'SHIPPING_AGENT' };

        const r = await setJurisdictionAdmin(input);

        expect(r).toEqual({ ok: false, reason: 'not_staff' });
        expect(membershipUpdateSpy).not.toHaveBeenCalled();
    });

    it('répond not_found si la personne n’est pas rattachée au pays', async () => {
        updatedRows = [];

        const r = await setJurisdictionAdmin(input);

        expect(r).toEqual({ ok: false, reason: 'not_found' });
    });

    it('refuse un administrateur général inactif', async () => {
        caller = { role: 'SUPERADMIN', full_name: 'x', is_active: false };

        const r = await setJurisdictionAdmin(input);

        expect(r).toEqual({ ok: false, reason: 'forbidden' });
    });
});
