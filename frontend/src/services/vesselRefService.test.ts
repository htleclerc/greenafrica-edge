import { describe, it, expect, vi } from 'vitest';
import { isVesselRef, resolveVesselByRef } from './vesselRefService';

describe('isVesselRef', () => {
    it('accepte la forme produite par la migration 147', () => {
        expect(isVesselRef('ves_7f3a9c2e51b0')).toBe(true);
    });

    it('rejette un UUID', () => {
        // C'est le point : l'ancienne URL ne doit plus être une entrée valide.
        expect(isVesselRef('34841384-e3de-4ff5-9055-8127f5691f49')).toBe(false);
    });

    it('rejette les formes approchantes', () => {
        expect(isVesselRef('ves_7F3A9C2E51B0')).toBe(false); // majuscules
        expect(isVesselRef('ves_7f3a9c2e51b')).toBe(false);  // trop court
        expect(isVesselRef('arm_7f3a9c2e51b0')).toBe(false); // référence d'armateur
        expect(isVesselRef('')).toBe(false);
    });
});

function makeDb(result: { data: unknown; error: unknown }) {
    const calls: { method: string; args: unknown[] }[] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) {
        builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
    }
    builder.maybeSingle = () => Promise.resolve(result);
    const db = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return builder; } };
    return { db: db as never, calls };
}

describe('resolveVesselByRef', () => {
    it('ne touche pas la base sur une référence mal formée', async () => {
        const from = vi.fn();
        expect(await resolveVesselByRef({ from } as never, '34841384-e3de-4ff5-9055-8127f5691f49')).toBeNull();
        expect(from).not.toHaveBeenCalled();
    });

    it('rend l’identifiant interne pour une référence connue', async () => {
        const { db, calls } = makeDb({ data: { id: 'v-1' }, error: null });
        expect(await resolveVesselByRef(db, 'ves_7f3a9c2e51b0')).toBe('v-1');
        expect(calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([
            ['public_ref', 'ves_7f3a9c2e51b0'],
        ]);
    });

    it('resserre au compte de l’armateur quand il est donné', async () => {
        // La RLS seule laisserait passer un navire rattaché par le lien agent
        // hérité : le détail doit avoir le même périmètre que la liste.
        const { db, calls } = makeDb({ data: { id: 'v-1' }, error: null });
        await resolveVesselByRef(db, 'ves_7f3a9c2e51b0', 'own-1');
        expect(calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([
            ['public_ref', 'ves_7f3a9c2e51b0'],
            ['shipowner_id', 'own-1'],
        ]);
    });

    it('rend null quand la RLS masque la ligne', async () => {
        const { db } = makeDb({ data: null, error: null });
        expect(await resolveVesselByRef(db, 'ves_7f3a9c2e51b0')).toBeNull();
    });

    it('remonte une erreur de base au lieu de la confondre avec « introuvable »', async () => {
        const { db } = makeDb({ data: null, error: { message: 'boom' } });
        await expect(resolveVesselByRef(db, 'ves_7f3a9c2e51b0')).rejects.toThrow(/boom/);
    });
});
