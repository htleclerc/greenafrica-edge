import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockFrom, mockAdminFrom } = vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockFrom: vi.fn(),
    mockAdminFrom: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: mockAuth }, from: mockFrom }),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: mockAdminFrom }),
}));

import { rejectVesselCandidate } from './rejectVesselCandidate';

interface Capture {
    updates: Array<{ table: string; payload: Record<string, unknown> }>;
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
}

function newCapture(): Capture {
    return { updates: [], inserts: [] };
}

interface StubOptions {
    capture?: Capture;
    /**
     * Vrai ⇒ l'UPDATE filtré ne touche AUCUNE ligne : quelqu'un a apparié le
     * candidat entre la lecture et l'écriture. C'est la course que le filtre
     * de statut rejoué dans l'UPDATE existe pour perdre proprement.
     */
    rowVanished?: boolean;
}

/** Stub à état : un update() modifie la ligne scriptée, la relecture le voit. */
function tableStub(responses: Record<string, unknown>, options?: StubOptions) {
    const state: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(responses)) {
        state[key] = value && typeof value === 'object' ? { ...value } : value;
    }
    return (table: string) => {
        const row = state[table] as Record<string, unknown> | null | undefined;
        let updating = false;
        const chain = {
            select: (): unknown =>
                updating
                    ? Promise.resolve({
                          data: options?.rowVanished ? [] : [{ id: row?.id }],
                          error: null,
                      })
                    : chain,
            eq: () => chain,
            in: () => chain,
            // Une lecture rend un INSTANTANÉ, jamais la ligne vivante : le
            // vrai client renvoie un objet décodé du JSON de la réponse, qu'un
            // UPDATE ultérieur ne mute pas. Rendre la référence faisait voir à
            // l'action son propre changement de statut avant même de l'avoir
            // journalisé — un artefact de stub, pas un défaut du code.
            maybeSingle: async () => ({ data: row ? { ...row } : null, error: null }),
            single: async () => ({ data: row ? { ...row } : null, error: null }),
            update: (payload: Record<string, unknown>) => {
                updating = true;
                options?.capture?.updates.push({ table, payload });
                if (row && !options?.rowVanished) Object.assign(row, payload);
                return chain;
            },
            insert: async (payload: Record<string, unknown>) => {
                options?.capture?.inserts.push({ table, payload });
                return { error: null };
            },
        };
        return chain;
    };
}

const CANDIDATE = {
    id: '11111111-1111-1111-1111-111111111111',
    status: 'PENDING',
    imo_number: '7504158',
    vessel_name: 'TRUST 1',
    batch_label: 'escales-aout.csv',
};

beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockImplementation(tableStub({ profiles: { role: 'PORT_OFFICER', full_name: 'Officier' } }));
});

describe('rejectVesselCandidate', () => {
    it('écarte un candidat PENDING et trace qui, quand, pourquoi', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub({ vessel_identity_candidates: CANDIDATE }, { capture }));

        const r = await rejectVesselCandidate({ candidateId: CANDIDATE.id, reason: 'Faute de frappe sur le nom' });
        expect(r).toEqual({ ok: true });

        const write = capture.updates.find((u) => u.table === 'vessel_identity_candidates');
        expect(write?.payload).toMatchObject({
            status: 'REJECTED',
            rejected_by: 'user-1',
            rejection_reason: 'Faute de frappe sur le nom',
        });
        // Le refus ne doit JAMAIS s'écrire dans les colonnes de l'appariement :
        // une ligne REJECTED portant un matched_by mentirait sur ce qui s'est
        // passé.
        expect(write?.payload).not.toHaveProperty('matched_by');
        expect(write?.payload).not.toHaveProperty('matched_vessel_id');
        expect(write?.payload.rejected_at).toEqual(expect.any(String));

        // Rejeter, c'est refuser une proposition — pas toucher au registre.
        expect(capture.updates.filter((u) => u.table === 'vessels')).toHaveLength(0);

        const audit = capture.inserts.find((i) => i.table === 'audit_logs');
        expect(audit?.payload.details_json).toMatchObject({
            event: 'VESSEL_IDENTITY_REJECTED',
            imoNumber: '7504158',
            previousStatus: 'PENDING',
            rejectionReason: 'Faute de frappe sur le nom',
        });
    });

    it('écarte aussi un candidat CONFLICT', async () => {
        // C'est le cas qui débloque l'écran : un candidat passé en CONFLICT
        // n'avait aucune sortie, ni appariement ni refus.
        const capture = newCapture();
        mockAdminFrom.mockImplementation(
            tableStub({ vessel_identity_candidates: { ...CANDIDATE, status: 'CONFLICT' } }, { capture }),
        );

        expect(await rejectVesselCandidate({ candidateId: CANDIDATE.id })).toEqual({ ok: true });
        const audit = capture.inserts.find((i) => i.table === 'audit_logs');
        expect(audit?.payload.details_json).toMatchObject({ previousStatus: 'CONFLICT' });
    });

    it('laisse le motif nul quand il est vide ou absent', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub({ vessel_identity_candidates: CANDIDATE }, { capture }));

        await rejectVesselCandidate({ candidateId: CANDIDATE.id, reason: '   ' });
        const write = capture.updates.find((u) => u.table === 'vessel_identity_candidates');
        expect(write?.payload.rejection_reason).toBeNull();
    });

    it('refuse un candidat MATCHED, avec un motif qui le dit', async () => {
        // Le « rejeter » laisserait croire qu'on a défait l'identité déjà
        // écrite sur le navire, alors que rien n'est annulé.
        const capture = newCapture();
        mockAdminFrom.mockImplementation(
            tableStub({ vessel_identity_candidates: { ...CANDIDATE, status: 'MATCHED' } }, { capture }),
        );

        expect(await rejectVesselCandidate({ candidateId: CANDIDATE.id })).toEqual({
            ok: false,
            reason: 'candidate already matched',
        });
        expect(capture.updates).toHaveLength(0);
    });

    it('refuse un candidat déjà REJECTED sans réécrire l’auteur du refus', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(
            tableStub({ vessel_identity_candidates: { ...CANDIDATE, status: 'REJECTED' } }, { capture }),
        );

        expect(await rejectVesselCandidate({ candidateId: CANDIDATE.id })).toEqual({
            ok: false,
            reason: 'candidate already processed',
        });
        expect(capture.updates).toHaveLength(0);
    });

    it('perd la course sans rien casser si le candidat a été apparié entre-temps', async () => {
        const capture = newCapture();
        mockAdminFrom.mockImplementation(
            tableStub({ vessel_identity_candidates: CANDIDATE }, { capture, rowVanished: true }),
        );

        expect(await rejectVesselCandidate({ candidateId: CANDIDATE.id })).toEqual({
            ok: false,
            reason: 'candidate already processed',
        });
        // L'UPDATE a bien été tenté, mais son filtre de statut n'a rien touché,
        // donc aucune entrée d'audit ne doit prétendre qu'un refus a eu lieu.
        expect(capture.inserts.filter((i) => i.table === 'audit_logs')).toHaveLength(0);
    });

    it('refuse un rôle non habilité', async () => {
        mockFrom.mockImplementation(tableStub({ profiles: { role: 'OWNER', full_name: 'Armateur' } }));
        const capture = newCapture();
        mockAdminFrom.mockImplementation(tableStub({ vessel_identity_candidates: CANDIDATE }, { capture }));

        expect(await rejectVesselCandidate({ candidateId: CANDIDATE.id })).toEqual({
            ok: false,
            reason: 'insufficient role',
        });
        expect(capture.updates).toHaveLength(0);
    });

    it('refuse un identifiant qui n’est pas un UUID', async () => {
        const r = await rejectVesselCandidate({ candidateId: 'pas-un-uuid' });
        expect(r.ok).toBe(false);
    });
});
