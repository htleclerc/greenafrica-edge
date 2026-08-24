import { describe, it, expect, vi, beforeEach } from 'vitest';

const OWNER = { id: 'own-1', name: 'CORAL TECHNICAL SERVICES' };
const VESSEL_ID = '11111111-1111-4111-8111-111111111111';

let authUser: { id: string } | null = { id: 'profile-1' };
let ownerRow: Record<string, unknown> | null = OWNER;
let vesselRow: Record<string, unknown> | null = {
    id: VESSEL_ID, name: 'MAYAR', shipowner_id: 'own-1', previous_names: [],
};

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: authUser } }) },
        // `eq` et `limit` sont chaînables : la résolution du compte s'appuie sur
        // RLS (mig 135) et n'a plus de filtre explicite, la lecture des
        // appartenances filtre sur deux colonnes.
        from: (t: string) => {
            const data =
                t === 'shipowners' ? ownerRow
                : t === 'owner_members' ? memberRow
                : vesselRow;
            const chain: Record<string, unknown> = {};
            for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain;
            chain.maybeSingle = async () => ({ data });
            return chain;
        },
    }),
}));

// Aucune appartenance par défaut : l'appelant est le titulaire, qui détient
// tout. Les cas « membre » la posent explicitement.
let memberRow: { can_manage_vessels: boolean } | null = null;

let liveInvoiceCount = 0;
const updateVessel = vi.fn(() => ({ eq: async () => ({ error: null }) }));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        from: (t: string) => {
            if (t === 'transactions') {
                return {
                    select: () => ({
                        eq: () => ({ neq: async () => ({ count: liveInvoiceCount, error: null }) }),
                    }),
                };
            }
            return { update: updateVessel };
        },
    }),
}));

const audit = vi.fn(async () => undefined);
vi.mock('@/services/auditService', () => ({
    writeAuditLog: (...a: unknown[]) => audit(...(a as [])),
}));

const { renameOwnerVessel, detachOwnerVessel } = await import('./updateOwnerVessel');

beforeEach(() => {
    vi.clearAllMocks();
    authUser = { id: 'profile-1' };
    ownerRow = { ...OWNER };
    vesselRow = { id: VESSEL_ID, name: 'MAYAR', shipowner_id: 'own-1', previous_names: [] };
    liveInvoiceCount = 0;
    memberRow = null;
});

describe('renameOwnerVessel', () => {
    it('renomme et verse l’ancien nom dans previous_names', async () => {
        const r = await renameOwnerVessel({ vesselId: VESSEL_ID, name: 'MAYAR STAR' });
        expect(r).toEqual({ ok: true });
        expect(updateVessel).toHaveBeenCalledWith({
            name: 'MAYAR STAR',
            previous_names: ['MAYAR'],
        });
    });

    it('ne duplique pas un ancien nom déjà connu', async () => {
        vesselRow = { ...vesselRow, name: 'MAYAR', previous_names: ['MAYAR'] };
        await renameOwnerVessel({ vesselId: VESSEL_ID, name: 'MAYAR STAR' });
        expect(updateVessel).toHaveBeenCalledWith(
            expect.objectContaining({ previous_names: ['MAYAR'] }),
        );
    });

    it('ne fait rien quand le nom est inchangé', async () => {
        const r = await renameOwnerVessel({ vesselId: VESSEL_ID, name: 'MAYAR' });
        expect(r).toEqual({ ok: true });
        expect(updateVessel).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
    });

    it('journalise le renommage', async () => {
        await renameOwnerVessel({ vesselId: VESSEL_ID, name: 'MAYAR STAR' });
        expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            entity_type: 'Vessel',
            details_json: expect.objectContaining({
                event: 'OWNER_VESSEL_RENAMED', from: 'MAYAR', to: 'MAYAR STAR',
            }),
        }));
    });

    it('refuse le navire d’un autre armateur', async () => {
        vesselRow = { ...vesselRow, shipowner_id: 'own-AUTRE' };
        const r = await renameOwnerVessel({ vesselId: VESSEL_ID, name: 'PIRATE' });
        expect(r).toEqual({ ok: false, reason: 'vessel not found' });
        expect(updateVessel).not.toHaveBeenCalled();
    });

    it('refuse un nom vide', async () => {
        const r = await renameOwnerVessel({ vesselId: VESSEL_ID, name: '   ' });
        expect(r.ok).toBe(false);
        expect(updateVessel).not.toHaveBeenCalled();
    });

    it('refuse un appel non authentifié', async () => {
        authUser = null;
        expect(await renameOwnerVessel({ vesselId: VESSEL_ID, name: 'X' }))
            .toEqual({ ok: false, reason: 'not authenticated' });
    });
});

describe('detachOwnerVessel', () => {
    it('retire un navire sans facture vivante', async () => {
        const r = await detachOwnerVessel({ vesselId: VESSEL_ID });
        expect(r).toEqual({ ok: true });
        expect(updateVessel).toHaveBeenCalledWith({ shipowner_id: null });
    });

    it('REFUSE le retrait d’un navire facturé', async () => {
        liveInvoiceCount = 1;
        const r = await detachOwnerVessel({ vesselId: VESSEL_ID });
        expect(r).toEqual({ ok: false, reason: 'vessel has invoices — dispute instead' });
        expect(updateVessel).not.toHaveBeenCalled();
    });

    it('revalide la garde côté serveur, pas seulement à l’écran', async () => {
        // Un appel direct a l'action contournerait un bouton grise : la garde
        // doit tomber ici aussi.
        liveInvoiceCount = 3;
        expect((await detachOwnerVessel({ vesselId: VESSEL_ID })).ok).toBe(false);
    });

    it('journalise le retrait en WARNING', async () => {
        await detachOwnerVessel({ vesselId: VESSEL_ID });
        expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            severity: 'WARNING',
            details_json: expect.objectContaining({ event: 'OWNER_VESSEL_DETACHED' }),
        }));
    });

    it('refuse le navire d’un autre armateur', async () => {
        vesselRow = { ...vesselRow, shipowner_id: 'own-AUTRE' };
        expect(await detachOwnerVessel({ vesselId: VESSEL_ID }))
            .toEqual({ ok: false, reason: 'vessel not found' });
    });

    it('ne touche jamais aux transactions', async () => {
        await detachOwnerVessel({ vesselId: VESSEL_ID });
        // Seule la table vessels est mise a jour : l'immuabilite fiscale n'est
        // ni contournee ni assouplie.
        expect(updateVessel).toHaveBeenCalledTimes(1);
        expect(updateVessel).toHaveBeenCalledWith({ shipowner_id: null });
    });
});

/**
 * Gérer la flotte est une sous-permission (mig 135) : un membre invité peut voir
 * les navires du compte sans pouvoir les toucher. La garde vit dans
 * `loadOwnVessel`, donc elle couvre les DEUX gestes — c'est ce que ces cas
 * vérifient, plutôt que de ne tester que le renommage.
 */
describe('sous-permission « gérer les navires »', () => {
    it('refuse le renommage à un membre qui ne l’a pas', async () => {
        memberRow = { can_manage_vessels: false };
        const r = await renameOwnerVessel({ vesselId: VESSEL_ID, name: 'MAYAR STAR' });
        expect(r).toEqual({ ok: false, reason: 'forbidden' });
        expect(updateVessel).not.toHaveBeenCalled();
    });

    it('refuse aussi le retrait — la garde couvre les deux gestes', async () => {
        memberRow = { can_manage_vessels: false };
        const r = await detachOwnerVessel({ vesselId: VESSEL_ID });
        expect(r).toEqual({ ok: false, reason: 'forbidden' });
        expect(updateVessel).not.toHaveBeenCalled();
    });

    it('laisse agir le membre qui la détient', async () => {
        memberRow = { can_manage_vessels: true };
        expect(await renameOwnerVessel({ vesselId: VESSEL_ID, name: 'MAYAR STAR' }))
            .toEqual({ ok: true });
        expect(updateVessel).toHaveBeenCalled();
    });

    it('n’exige aucune ligne d’appartenance du titulaire', async () => {
        // Le titulaire n'a pas de ligne owner_members : exiger qu'il s'invite
        // lui-même serait un piège à comptes verrouillés.
        memberRow = null;
        expect(await renameOwnerVessel({ vesselId: VESSEL_ID, name: 'MAYAR STAR' }))
            .toEqual({ ok: true });
    });
});
