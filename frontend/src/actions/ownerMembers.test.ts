import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OWNER_ALL_PRIVILEGES, NO_PRIVILEGES } from '@/lib/auth/ownerPrivileges';

// ── Doublures ────────────────────────────────────────────────────────────────

const principal = {
    kind: 'operator' as const,
    userId: 'holder-1',
    email: 'ops@horn.example',
    shipowner: { id: 'so-1', name: 'Horn Shipping', is_ofac_sdn: false, is_un_prohibited: false },
    jurisdictionId: 'j1',
    applicableModes: ['MARITIME'],
    privileges: { ...OWNER_ALL_PRIVILEGES },
    isMember: false,
};
vi.mock('@/lib/auth/requirePrincipal', () => ({ requirePrincipal: async () => principal }));

const provisionOwnerAccount = vi.fn(async () => ({ profileId: 'prof-new', wasCreated: true }));
vi.mock('@/services/ownerProvisioning', () => ({
    provisionOwnerAccount: (...a: unknown[]) => provisionOwnerAccount(...(a as [])),
}));

const auditSpy = vi.fn(async () => {});
const notifySpy = vi.fn(async () => ({ id: 'notif-1' }));
vi.mock('@/services/notificationService', () => ({
    notifyOwner: (...a: unknown[]) => notifySpy(...(a as [])),
}));
vi.mock('@/services/auditService', () => ({ writeAuditLog: (...a: unknown[]) => auditSpy(...(a as [])) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/domain/sanctions/contactGuard', () => ({
    assertContactAllowed: vi.fn(),
    SanctionedContactError: class extends Error { code = 'OFAC'; },
}));

/** Tables mimées : chaque `from` rend ce que le scénario a posé. */
const tables: Record<string, unknown> = {};
const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];

function builder(table: string) {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: tables[table] ?? null, error: null });
    chain.single = async () => ({ data: tables[table] ?? null, error: null });
    chain.insert = (row: Record<string, unknown>) => {
        inserted.push({ table, ...row });
        return { select: () => ({ single: async () => ({ data: { id: 'member-new' }, error: null }) }) };
    };
    chain.update = (patch: Record<string, unknown>) => {
        updated.push({ table, ...patch });
        return { eq: async () => ({ error: null }) };
    };
    return chain;
}
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({ from: builder }) }));

beforeEach(() => {
    for (const k of Object.keys(tables)) delete tables[k];
    inserted.length = 0;
    updated.length = 0;
    vi.clearAllMocks();
    provisionOwnerAccount.mockResolvedValue({ profileId: 'prof-new', wasCreated: true });
    principal.privileges = { ...OWNER_ALL_PRIVILEGES };
    principal.isMember = false;
});

const invite = async (over: Record<string, unknown> = {}) => {
    const { inviteOwnerMember } = await import('./inviteOwnerMember');
    return inviteOwnerMember({
        email: 'compta@horn.example',
        fullName: 'Amina Haji',
        privileges: { canPay: true, canDispute: true, canManageVessels: true, canInvite: true },
        ...over,
    });
};

describe('inviteOwnerMember — qui peut inviter', () => {
    it('accepte le titulaire', async () => {
        const r = await invite();
        expect(r.ok).toBe(true);
    });

    it('accepte un membre porteur de can_invite', async () => {
        principal.isMember = true;
        principal.privileges = { ...NO_PRIVILEGES, canInvite: true };
        expect((await invite()).ok).toBe(true);
    });

    it('refuse un membre sans can_invite, sans rien écrire', async () => {
        principal.isMember = true;
        principal.privileges = { ...NO_PRIVILEGES };
        expect(await invite()).toEqual({ ok: false, reason: 'forbidden' });
        expect(inserted).toHaveLength(0);
    });
});

describe('inviteOwnerMember — la borne de délégation', () => {
    // Sans clampToGranter, un membre porteur du seul can_invite créerait un
    // compte muni de can_pay, puis s'y connecterait. C'est une escalade.
    it('n’accorde jamais plus que ce que détient l’invitant', async () => {
        principal.isMember = true;
        principal.privileges = { ...NO_PRIVILEGES, canInvite: true };

        const r = await invite();
        expect(r.ok && r.granted).toEqual({
            canPay: false, canDispute: false, canManageVessels: false, canInvite: true,
        });
        const row = inserted.find((i) => i.table === 'owner_members');
        expect(row).toMatchObject({ can_pay: false, can_dispute: false, can_invite: true });
    });

    it('laisse le titulaire tout accorder', async () => {
        const r = await invite();
        expect(r.ok && r.granted).toEqual(OWNER_ALL_PRIVILEGES);
    });

    it('trace qui a ouvert la porte', async () => {
        await invite();
        const row = inserted.find((i) => i.table === 'owner_members');
        expect(row).toMatchObject({ invited_by: 'holder-1', shipowner_id: 'so-1' });
        expect(auditSpy).toHaveBeenCalled();
    });
});

describe('inviteOwnerMember — refus non évidents', () => {
    it('refuse de s’inviter soi-même', async () => {
        expect(await invite({ email: 'ops@horn.example' })).toEqual({ ok: false, reason: 'self' });
    });

    // La propriété l'emporte sur l'appartenance : la ligne ne ferait rien.
    it('refuse le titulaire d’un autre compte plutôt que de créer une ligne inerte', async () => {
        tables.shipowners = { id: 'so-AUTRE' };
        expect(await invite()).toEqual({ ok: false, reason: 'holds_other_account' });
        expect(inserted).toHaveLength(0);
    });

    it('refuse une adresse invalide avant tout provisionnement', async () => {
        const r = await invite({ email: 'pas-une-adresse' });
        expect(r.ok).toBe(false);
        expect(provisionOwnerAccount).not.toHaveBeenCalled();
    });
});

describe('revokeOwnerMember', () => {
    const revoke = async (memberId = '11111111-1111-4111-8111-111111111111') => {
        const { revokeOwnerMember } = await import('./revokeOwnerMember');
        return revokeOwnerMember({ memberId });
    };

    it('révoque sans supprimer — un accès passé doit rester lisible', async () => {
        tables.owner_members = { id: 'm1', profile_id: 'prof-x', active: true };
        expect(await revoke()).toEqual({ ok: true });
        const patch = updated.find((u) => u.table === 'owner_members');
        expect(patch).toMatchObject({ active: false });
        expect(patch?.revoked_at).toBeTruthy();
    });

    it('est idempotente sur un membre déjà révoqué', async () => {
        tables.owner_members = { id: 'm1', profile_id: 'prof-x', active: false };
        expect(await revoke()).toEqual({ ok: true });
        expect(updated).toHaveLength(0);
    });

    // Se révoquer soi-même fermerait la porte de l'intérieur.
    it('refuse l’auto-révocation', async () => {
        tables.owner_members = { id: 'm1', profile_id: 'holder-1', active: true };
        expect(await revoke()).toEqual({ ok: false, reason: 'self' });
    });

    it('refuse sans can_invite', async () => {
        principal.privileges = { ...NO_PRIVILEGES };
        expect(await revoke()).toEqual({ ok: false, reason: 'forbidden' });
    });

    it('ne trouve rien hors de son propre compte', async () => {
        tables.owner_members = null;
        expect(await revoke()).toEqual({ ok: false, reason: 'not_found' });
    });
});

/**
 * Un membre porteur de `can_invite` peut ouvrir un accès sans que le titulaire
 * en soit partie. Le journal d'audit le trace, mais personne ne le lit chaque
 * jour : la notification est ce qui rend le geste visible à qui répond du
 * compte.
 */
describe('inviteOwnerMember — le titulaire apprend ce qu’un membre a ouvert', () => {
    it('notifie le compte quand un membre invite', async () => {
        principal.isMember = true;
        principal.privileges = { ...NO_PRIVILEGES, canInvite: true, canDispute: true };

        const r = await invite({ privileges: { canPay: false, canDispute: true, canManageVessels: false, canInvite: false } });
        expect(r.ok).toBe(true);

        expect(notifySpy).toHaveBeenCalledTimes(1);
        const [, input] = notifySpy.mock.calls[0] as unknown as [unknown, {
            shipownerId: string; kind: string; params: Record<string, unknown>;
        }];
        expect(input.kind).toBe('MEMBER_INVITED');
        expect(input.shipownerId).toBe('so-1');
        expect(input.params.member_email).toBe('compta@horn.example');
        expect(input.params.invited_by).toBe('ops@horn.example');
        // Les droits annoncés sont ceux RÉELLEMENT accordés après écrêtage, pas
        // ceux demandés : sinon l'avis promettrait plus que l'accès ne porte.
        expect(input.params.granted).toEqual(['canDispute']);
    });

    it('ne notifie pas quand c’est le titulaire qui invite — il le sait déjà', async () => {
        const r = await invite();
        expect(r.ok).toBe(true);
        expect(notifySpy).not.toHaveBeenCalled();
    });

    it('n’annule pas l’invitation si l’avis échoue', async () => {
        principal.isMember = true;
        principal.privileges = { ...NO_PRIVILEGES, canInvite: true };
        notifySpy.mockRejectedValueOnce(new Error('smtp down'));

        const r = await invite({ privileges: { canPay: false, canDispute: false, canManageVessels: false, canInvite: false } });
        expect(r.ok).toBe(true);
        expect(inserted.some((row) => row.table === 'owner_members')).toBe(true);
    });
});

describe('revokeOwnerMember — le titulaire apprend ce qu’un membre a fermé', () => {
    const revoke = async (memberId = '11111111-1111-4111-8111-111111111111') => {
        const { revokeOwnerMember } = await import('./revokeOwnerMember');
        return revokeOwnerMember({ memberId });
    };

    it('notifie le compte quand un membre révoque', async () => {
        principal.isMember = true;
        principal.privileges = { ...NO_PRIVILEGES, canInvite: true };
        tables.owner_members = {
            id: 'm1', profile_id: 'prof-x', active: true,
            profiles: { email: 'partie@horn.example' },
        };

        expect(await revoke()).toEqual({ ok: true });
        expect(notifySpy).toHaveBeenCalledTimes(1);
        const [, input] = notifySpy.mock.calls[0] as unknown as [unknown, {
            kind: string; params: Record<string, unknown>;
        }];
        expect(input.kind).toBe('MEMBER_REVOKED');
        // L'adresse, pas l'identifiant technique : le titulaire doit reconnaître
        // la personne sans aller la chercher.
        expect(input.params.member_email).toBe('partie@horn.example');
        expect(input.params.revoked_by).toBe('ops@horn.example');
    });

    it('ne notifie pas quand c’est le titulaire qui révoque', async () => {
        tables.owner_members = {
            id: 'm1', profile_id: 'prof-x', active: true,
            profiles: { email: 'partie@horn.example' },
        };
        expect(await revoke()).toEqual({ ok: true });
        expect(notifySpy).not.toHaveBeenCalled();
    });

    it('ne notifie pas une révocation déjà faite — rejouer n’émet rien', async () => {
        principal.isMember = true;
        principal.privileges = { ...NO_PRIVILEGES, canInvite: true };
        tables.owner_members = { id: 'm1', profile_id: 'prof-x', active: false, profiles: null };

        expect(await revoke()).toEqual({ ok: true });
        expect(notifySpy).not.toHaveBeenCalled();
    });
});
