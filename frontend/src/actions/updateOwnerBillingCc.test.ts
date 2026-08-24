import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_CC_EMAILS } from '@/lib/armateurContacts';

const eqSpy = vi.fn(() => Promise.resolve({ error: null }));
const updateSpy = vi.fn((_p: Record<string, unknown>) => ({ eq: eqSpy }));
const tenantSpy = vi.fn(() => ({ from: vi.fn(() => ({ update: updateSpy })) }));

vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: vi.fn(async () => ({
        userId: 'u1',
        jurisdictionId: 'j1',
        shipowner: { id: 's1', name: 'Horn Shipping', official_email: 'ops@horn.example' },
    })),
}));
vi.mock('@/lib/supabase/tenant', () => ({ createTenantClient: (...a: unknown[]) => tenantSpy(...(a as [])) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

beforeEach(() => { updateSpy.mockClear(); eqSpy.mockClear(); tenantSpy.mockClear(); });

const run = async (emails: string[]) => {
    const { updateOwnerBillingCc } = await import('./updateOwnerBillingCc');
    return updateOwnerBillingCc({ emails });
};
const patch = () => updateSpy.mock.calls[0][0] as { billing_cc_emails: string[] };

describe('updateOwnerBillingCc — normalisation', () => {
    it('met en minuscules et élague', async () => {
        await run(['  Compta@Horn.Example  ']);
        expect(patch().billing_cc_emails).toEqual(['compta@horn.example']);
    });

    it('déduplique', async () => {
        await run(['a@horn.example', 'A@horn.example']);
        expect(patch().billing_cc_emails).toEqual(['a@horn.example']);
    });

    // Sans ce retrait, l'armateur recevrait deux fois chaque facture.
    it('retire l’adresse principale de la liste des copies', async () => {
        await run(['ops@horn.example', 'compta@horn.example']);
        expect(patch().billing_cc_emails).toEqual(['compta@horn.example']);
    });

    it('accepte une liste vide — retirer toutes ses copies est légitime', async () => {
        const r = await run([]);
        expect(r).toEqual({ ok: true, emails: [] });
        expect(patch().billing_cc_emails).toEqual([]);
    });
});

describe('updateOwnerBillingCc — refus', () => {
    it('refuse une adresse invalide, sans rien écrire', async () => {
        const r = await run(['pas-une-adresse']);
        expect(r).toEqual({ ok: false, reason: 'invalid_email' });
        expect(updateSpy).not.toHaveBeenCalled();
    });

    // Tronquer masquerait le dépassement : on refuse la requête entière.
    it('refuse un dépassement de plafond plutôt que de tronquer', async () => {
        const tooMany = Array.from({ length: MAX_CC_EMAILS + 1 }, (_, i) => `c${i}@horn.example`);
        const r = await run(tooMany);
        expect(r).toEqual({ ok: false, reason: 'too_many' });
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('distingue le dépassement de l’adresse invalide — les corrections diffèrent', async () => {
        const invalid = await run(['nope']);
        const tooMany = await run(Array.from({ length: MAX_CC_EMAILS + 1 }, (_, i) => `c${i}@horn.example`));
        expect(invalid).not.toEqual(tooMany);
    });

    it('accepte exactement le plafond', async () => {
        const exact = Array.from({ length: MAX_CC_EMAILS }, (_, i) => `c${i}@horn.example`);
        expect((await run(exact)).ok).toBe(true);
    });
});

describe('updateOwnerBillingCc — portée', () => {
    // La portée vient de la session, jamais de l'entrée : l'armateur ne peut pas
    // écrire les copies d'un autre dossier en forgeant la requête.
    it('borne l’écriture à son propre armateur et à sa juridiction', async () => {
        await run(['compta@horn.example']);
        expect(tenantSpy).toHaveBeenCalledWith('j1');
        expect(eqSpy).toHaveBeenCalledWith('id', 's1');
    });

    it('remonte une erreur de base sans la maquiller en succès', async () => {
        eqSpy.mockResolvedValueOnce({ error: { message: 'permission denied' } } as never);
        expect(await run(['compta@horn.example'])).toEqual({ ok: false, reason: 'permission denied' });
    });
});
