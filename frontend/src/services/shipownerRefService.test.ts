import { describe, it, expect, vi } from 'vitest';
import { isShipownerRef, resolveShipownerByRef, getShipownerRefs } from './shipownerRefService';

describe('isShipownerRef', () => {
    it('accepte la forme produite par la migration 144', () => {
        expect(isShipownerRef('arm_7f3a9c2e51b0')).toBe(true);
    });

    it('rejette un UUID', () => {
        // C'est le point : l'ancienne URL ne doit plus être une entrée valide.
        expect(isShipownerRef('5265aa3b-bd3a-4bfe-9ddf-8bc94898fd4a')).toBe(false);
    });

    it('rejette les formes approchantes', () => {
        expect(isShipownerRef('arm_7F3A9C2E51B0')).toBe(false); // majuscules
        expect(isShipownerRef('arm_7f3a9c2e51b')).toBe(false);  // trop court
        expect(isShipownerRef('arm_7f3a9c2e51b00')).toBe(false); // trop long
        expect(isShipownerRef('air_7f3a9c2e51b0')).toBe(false); // autre préfixe
        expect(isShipownerRef('')).toBe(false);
    });
});

function makeDb(result: { data: unknown; error: unknown }) {
    const calls: { method: string; args: unknown[] }[] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in']) {
        builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
    }
    builder.maybeSingle = () => Promise.resolve(result);
    // `.in()` est terminal pour getShipownerRefs : on le rend « thenable ».
    builder.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    const db = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return builder; } };
    return { db: db as never, calls };
}

describe('resolveShipownerByRef', () => {
    it('ne touche pas la base sur une référence mal formée', async () => {
        const from = vi.fn();
        const db = { from } as never;
        expect(await resolveShipownerByRef(db, 'pas-une-reference')).toBeNull();
        expect(from).not.toHaveBeenCalled();
    });

    it('rend l’identifiant interne pour une référence connue', async () => {
        const { db, calls } = makeDb({ data: { id: 'own-1' }, error: null });
        expect(await resolveShipownerByRef(db, 'arm_7f3a9c2e51b0')).toBe('own-1');
        expect(calls.find((c) => c.method === 'eq')?.args).toEqual(['public_ref', 'arm_7f3a9c2e51b0']);
    });

    it('rend null quand la RLS masque la ligne', async () => {
        // Une référence valide d'une autre juridiction doit être indistinguable
        // d'une référence inexistante — sinon l'écran révèle son existence.
        const { db } = makeDb({ data: null, error: null });
        expect(await resolveShipownerByRef(db, 'arm_7f3a9c2e51b0')).toBeNull();
    });

    it('remonte une erreur de base au lieu de la confondre avec « introuvable »', async () => {
        const { db } = makeDb({ data: null, error: { message: 'boom' } });
        await expect(resolveShipownerByRef(db, 'arm_7f3a9c2e51b0')).rejects.toThrow(/boom/);
    });
});

describe('getShipownerRefs', () => {
    it('ne requête pas sur une liste vide', async () => {
        const from = vi.fn();
        expect(await getShipownerRefs({ from } as never, [])).toEqual({});
        expect(from).not.toHaveBeenCalled();
    });

    it('dédoublonne les identifiants demandés', async () => {
        const { db, calls } = makeDb({ data: [{ id: 'a', public_ref: 'arm_000000000001' }], error: null });
        await getShipownerRefs(db, ['a', 'a', 'a']);
        expect(calls.find((c) => c.method === 'in')?.args[1]).toEqual(['a']);
    });

    it('omet une ligne sans référence plutôt que de retomber sur l’identifiant', async () => {
        // Un repli sur l'UUID remettrait l'identifiant interne dans l'URL.
        const { db } = makeDb({ data: [{ id: 'a', public_ref: null }], error: null });
        expect(await getShipownerRefs(db, ['a'])).toEqual({});
    });
});
