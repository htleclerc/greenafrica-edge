import { describe, it, expect } from 'vitest';
import { resolveLoginTarget } from './loginAllowlist';

/**
 * La liste d'autorisation décide qui peut recevoir un lien de connexion.
 *
 * Trois sources, par priorité décroissante : l'adresse officielle de
 * l'armateur, un représentant rattaché (owner_agent_mappings), un
 * destinataire en copie de facturation (shipowners.billing_cc_emails, une
 * colonne TEXT[] et non une table).
 *
 * Une adresse inconnue ne crée jamais rien, et l'adresse de livraison vient
 * toujours de la base : la saisie sert à chercher, pas à recevoir.
 */
const OWNER = {
    id: 'own-1',
    name: 'FAROS SHIPPING CO SARL',
    official_email: 'faros@farosshipping.example',
    is_placeholder: false,
    is_ofac_sdn: false,
    is_un_prohibited: false,
};

/** Faux client : chaque table rend la première ligne correspondant aux filtres. */
function admin(tables: {
    shipowners?: Record<string, unknown>[];
    mappings?: Record<string, unknown>[];
    members?: Record<string, unknown>[];
    cc?: Record<string, unknown>[];
}) {
    const calls: string[] = [];
    const selects: string[] = [];
    const make = (table: string, rows: Record<string, unknown>[]) => {
        let filtered = [...rows];
        const chain: Record<string, unknown> = {};
        chain.select = (columns?: string) => {
            selects.push(`${table}|${columns ?? ''}`);
            return chain;
        };
        // PostgREST filtre une table jointe par chemin pointe
        // (`profiles.email`) : le simulacre doit le refleter, sinon il
        // validerait une requete qui ne marche pas en vrai.
        chain.eq = (col: string, val: unknown) => {
            filtered = filtered.filter((r) => {
                const v = col.includes('.')
                    ? col.split('.').reduce<unknown>((acc, k) =>
                        (acc as Record<string, unknown> | undefined)?.[k], r)
                    : r[col];
                return v === val;
            });
            return chain;
        };
        chain.contains = (col: string, val: unknown[]) => {
            filtered = filtered.filter((r) => {
                const arr = (r[col] ?? []) as unknown[];
                return val.every((v) => arr.includes(v));
            });
            return chain;
        };
        chain.order = () => chain;
        chain.limit = (n: number) => {
            filtered = filtered.slice(0, n);
            return chain;
        };
        // PostgREST renvoie une ERREUR — pas la premiere ligne — quand
        // maybeSingle() trouve plusieurs correspondances. Le simulacre doit le
        // reproduire : sans cela il validerait un code qui rend un armateur
        // introuvable des que son adresse couvre deux dossiers.
        chain.maybeSingle = async () => (filtered.length > 1
            ? { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } }
            : { data: filtered[0] ?? null, error: null });
        chain.then = (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: filtered, error: null }).then(res);
        return chain;
    };
    return {
        client: {
            from: (t: string) => {
                calls.push(t);
                if (t === 'owner_agent_mappings') return make(t, tables.mappings ?? []);
                if (t === 'owner_members') return make(t, tables.members ?? []);
                return make(t, t === 'shipowners' && tables.cc ? tables.cc : (tables.shipowners ?? []));
            },
        } as never,
        calls,
        selects,
    };
}

/**
 * `owner_members` et `owner_agent_mappings` portent CHACUNE deux clés
 * étrangères vers `profiles`. Un embed `profiles!inner(...)` y est ambigu :
 * PostgREST refuse la requête entière (PGRST201) et rend `data: null`. Le code
 * ne lisait pas l'erreur et passait à la source suivante — aucun membre ni
 * représentant ne pouvait recevoir de lien, en silence.
 *
 * Les simulacres ne peuvent pas reproduire PGRST201 : ils ne parlent pas
 * PostgREST. C'est donc la CHAÎNE `select` qu'on contraint, seule trace
 * vérifiable hors base de la désambiguïsation.
 */
describe('embeds vers profiles — la clé étrangère doit être nommée', () => {
    const AMBIGU = /profiles!inner/;

    it('nomme la clé sur owner_members', async () => {
        const a = admin({ members: [] });
        await resolveLoginTarget(a.client, 'inconnu@example.com');
        const q = a.selects.find((s) => s.startsWith('owner_members|'));
        expect(q).toBeDefined();
        expect(q).not.toMatch(AMBIGU);
        expect(q).toContain('profiles!owner_members_profile_id_fkey!inner(email)');
    });

    it('nomme la clé sur owner_agent_mappings', async () => {
        const a = admin({ mappings: [] });
        await resolveLoginTarget(a.client, 'inconnu@example.com');
        const q = a.selects.find((s) => s.startsWith('owner_agent_mappings|'));
        expect(q).toBeDefined();
        expect(q).not.toMatch(AMBIGU);
        expect(q).toContain('profiles!owner_agent_mappings_agent_profile_id_fkey!inner(email)');
    });
});

describe('resolveLoginTarget', () => {
    it('reconnaît l’adresse officielle de l’armateur', async () => {
        const a = admin({ shipowners: [OWNER] });
        const t = await resolveLoginTarget(a.client, 'faros@farosshipping.example');
        expect(t).toMatchObject({ shipownerId: 'own-1', scope: 'OWNER' });
    });

    it('normalise la casse et les espaces', async () => {
        const a = admin({ shipowners: [OWNER] });
        const t = await resolveLoginTarget(a.client, '  FAROS@farosshipping.example ');
        expect(t?.shipownerId).toBe('own-1');
    });

    it('livre toujours à l’adresse de la base, jamais à celle saisie', async () => {
        const a = admin({ shipowners: [OWNER] });
        const t = await resolveLoginTarget(a.client, 'FAROS@FAROSSHIPPING.EXAMPLE');
        expect(t?.deliveryEmail).toBe('faros@farosshipping.example');
    });

    it('rend null sur une adresse inconnue', async () => {
        const a = admin({ shipowners: [OWNER] });
        expect(await resolveLoginTarget(a.client, 'inconnu@nulle.part')).toBeNull();
    });

    it('rend null sur une saisie qui n’est pas une adresse', async () => {
        const a = admin({ shipowners: [OWNER] });
        expect(await resolveLoginTarget(a.client, 'pas-une-adresse')).toBeNull();
        // Aucune requête ne doit partir pour une saisie manifestement invalide.
        expect(a.calls).toEqual([]);
    });

    it('rend null sur un armateur fictif', async () => {
        const a = admin({ shipowners: [{ ...OWNER, is_placeholder: true }] });
        expect(await resolveLoginTarget(a.client, 'faros@farosshipping.example')).toBeNull();
    });

    it('rend null quand l’armateur n’a pas d’adresse de livraison', async () => {
        const a = admin({ shipowners: [{ ...OWNER, official_email: null }] });
        expect(await resolveLoginTarget(a.client, 'faros@farosshipping.example')).toBeNull();
    });

    it('remonte les drapeaux de sanctions sans décider à la place de l’appelant', async () => {
        const a = admin({ shipowners: [{
            ...OWNER, id: 'own-2',
            official_email: 'morgan.navigation@mail.example',
            is_un_prohibited: true,
        }] });
        const t = await resolveLoginTarget(a.client, 'morgan.navigation@mail.example');
        expect(t?.isUnProhibited).toBe(true);
        expect(t?.scope).toBe('OWNER');
    });

    it('reconnaît un membre du compte, et lui envoie le lien à SON adresse', async () => {
        const a = admin({
            shipowners: [],
            members: [{
                shipowner_id: 'own-1', active: true,
                profiles: { email: 'compta@farosshipping.com' },
                shipowners: OWNER,
            }],
        });
        const t = await resolveLoginTarget(a.client, 'compta@farosshipping.com');
        expect(t).toMatchObject({ shipownerId: 'own-1', scope: 'MEMBER' });
        // Envoyer le lien à l'armateur priverait le membre de l'accès qu'on
        // vient de lui accorder.
        expect(t?.deliveryEmail).toBe('compta@farosshipping.com');
    });

    it('ignore une appartenance révoquée', async () => {
        const a = admin({
            shipowners: [],
            members: [{
                shipowner_id: 'own-1', active: false,
                profiles: { email: 'ancien@farosshipping.com' },
                shipowners: OWNER,
            }],
        });
        expect(await resolveLoginTarget(a.client, 'ancien@farosshipping.com')).toBeNull();
    });

    // Un membre a des droits explicitement cochés ; un représentant n'a qu'un
    // lien de correspondance. La revendication la plus forte l'emporte.
    it('fait primer l’appartenance sur le rattachement', async () => {
        const shared = 'double@farosshipping.com';
        const a = admin({
            shipowners: [],
            members: [{
                shipowner_id: 'own-1', active: true,
                profiles: { email: shared }, shipowners: OWNER,
            }],
            mappings: [{
                shipowner_id: 'own-1', active: true,
                profiles: { email: shared }, shipowners: OWNER,
            }],
        });
        expect((await resolveLoginTarget(a.client, shared))?.scope).toBe('MEMBER');
    });

    it('reconnaît un représentant rattaché et actif', async () => {
        const a = admin({
            shipowners: [],
            mappings: [{
                shipowner_id: 'own-1', active: true,
                profiles: { email: 'gavaksh.b@rafflescommercial.com' },
                shipowners: OWNER,
            }],
        });
        const t = await resolveLoginTarget(a.client, 'gavaksh.b@rafflescommercial.com');
        expect(t).toMatchObject({ shipownerId: 'own-1', scope: 'REPRESENTATIVE' });
        // Le lien part à l'adresse du représentant, pas à celle de l'armateur.
        expect(t?.deliveryEmail).toBe('gavaksh.b@rafflescommercial.com');
    });

    it('ignore un rattachement désactivé', async () => {
        const a = admin({
            shipowners: [],
            mappings: [{
                shipowner_id: 'own-1', active: false,
                profiles: { email: 'ancien@rep.com' },
                shipowners: OWNER,
            }],
        });
        expect(await resolveLoginTarget(a.client, 'ancien@rep.com')).toBeNull();
    });

    it('reconnaît une copie de facturation, portée BILLING_CC', async () => {
        const a = admin({ cc: [{ ...OWNER, billing_cc_emails: ['compta@armateur.com'] }] });
        const t = await resolveLoginTarget(a.client, 'compta@armateur.com');
        expect(t).toMatchObject({ shipownerId: 'own-1', scope: 'BILLING_CC' });
        expect(t?.deliveryEmail).toBe('compta@armateur.com');
    });

    it('reste résolvable quand l’adresse couvre plusieurs dossiers', async () => {
        // faros@farosshipping.example porte PRO-CONS-2026-008 et -021, soit
        // 56 518,80 USD. maybeSingle() echouait sur ce cas et rendait
        // l'armateur introuvable, sans message.
        const a = admin({ shipowners: [
            { ...OWNER, id: 'own-008', name: 'FAROS SHIPPING CO SARL' },
            { ...OWNER, id: 'own-021', name: 'LEADERS FOR TRADING & MARITIME' },
        ] });
        const t = await resolveLoginTarget(a.client, 'faros@farosshipping.example');
        expect(t).not.toBeNull();
        expect(t?.scope).toBe('OWNER');
        // Choix stable : le premier de l'ordre impose, jamais un tirage.
        expect(t?.shipownerId).toBe('own-008');
    });

    it('reste résolvable quand une adresse sanctionnée couvre plusieurs dossiers', async () => {
        const a = admin({ shipowners: [
            { ...OWNER, id: 'own-022', official_email: 'info@petrofleetenergy.example', is_ofac_sdn: true },
            { ...OWNER, id: 'own-042', official_email: 'info@petrofleetenergy.example', is_ofac_sdn: true },
        ] });
        const t = await resolveLoginTarget(a.client, 'info@petrofleetenergy.example');
        // Doit etre RECONNU pour que l'appelant puisse le bloquer et le
        // journaliser ; rendre null le ferait passer pour une adresse inconnue.
        expect(t?.isOfacSdn).toBe(true);
    });
});
