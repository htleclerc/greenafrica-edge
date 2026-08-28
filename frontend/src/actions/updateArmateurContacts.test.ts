import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_CC_EMAILS, normalizeCcEmails } from '@/lib/armateurContacts';

// ─────────────────────────────────────────────────────────────────────────────
// updateArmateurContacts — remplace l'ancienne action à e-mail seul : édition
// complète des contacts d'un armateur (e-mail officiel + copies de facturation
// + coordonnées).
//
// Couvre : normalizeCcEmails (pure), gardes (auth/rôle/isolation de juridiction
// reprises à l'identique de l'action remplacée), délégation à upsertShipownerEmail en
// source PORT_OFFICER, et surtout la mise à jour PARTIELLE des coordonnées —
// un champ absent de la requête ne doit JAMAIS écraser une valeur existante
// (c'est ce qui protège les appelants "édition rapide" du cockpit/de la fiche,
// qui n'envoient que l'e-mail et une liste de copies vide).
// ─────────────────────────────────────────────────────────────────────────────

const { JID } = vi.hoisted(() => ({ JID: '00000000-0000-4000-8000-00000000534f' }));
const OTHER_JID = '00000000-0000-4000-8000-00000000444a';
const SHIPOWNER_ID = 'a1b2c3d4-e5f6-4789-9abc-def012345678';
const PUBLIC_REF = 'arm_0123456789ab';

// ── Mocks ────────────────────────────────────────────────────────────────────

const getUserMock = vi.fn();
const profileSingleMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: getUserMock },
        from: (table: string) => {
            if (table === 'profiles') {
                return { select: () => ({ eq: () => ({ single: profileSingleMock }) }) };
            }
            throw new Error(`unexpected table on user client: ${table}`);
        },
    }),
}));

let ownerRow: { id: string; jurisdiction_id: string; public_ref: string } | null;
const contactsUpdateSpy = vi.fn((_patch: Record<string, unknown>) => ({ error: null as { message: string } | null }));
const auditInsertSpy = vi.fn((_payload: Record<string, unknown>) => ({ error: null as { message: string } | null }));

function buildAdminMock() {
    return {
        from: (table: string) => {
            if (table === 'shipowners') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () =>
                                ownerRow
                                    ? { data: ownerRow, error: null }
                                    : { data: null, error: { message: 'not found' } },
                            // L'action relit la reference opaque pour revalider la
                            // fiche : la route est indexee par elle, pas par l'UUID.
                            maybeSingle: async () => ({ data: ownerRow, error: null }),
                        }),
                    }),
                    update: (patch: Record<string, unknown>) => ({
                        eq: async () => contactsUpdateSpy(patch),
                    }),
                };
            }
            if (table === 'audit_logs') {
                return { insert: async (payload: Record<string, unknown>) => auditInsertSpy(payload) };
            }
            throw new Error(`unexpected table on admin client: ${table}`);
        },
    };
}

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => buildAdminMock(),
    createTenantClient: () => buildAdminMock(),
}));

vi.mock('@/lib/auth/tenantContext', () => ({
    getServerJurisdictionId: vi.fn(async () => JID),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const upsertEmailSpy = vi.fn(async (_db: unknown, _id: string, email: string, source: string) => ({
    id: SHIPOWNER_ID,
    official_email: email,
    official_email_source: source,
}));
vi.mock('@/services/shipownerService', () => ({ upsertShipownerEmail: upsertEmailSpy }));

const { updateArmateurContacts } = await import('./updateArmateurContacts');

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } } });
    profileSingleMock.mockResolvedValue({ data: { role: 'PORT_OFFICER', full_name: 'Officer A' }, error: null });
    ownerRow = { id: SHIPOWNER_ID, jurisdiction_id: JID, public_ref: PUBLIC_REF };
    contactsUpdateSpy.mockImplementation(() => ({ error: null }));
});

const baseInput = {
    shipownerId: SHIPOWNER_ID,
    officialEmail: 'owner@example.com',
    billingCcEmails: [] as string[],
};

// ── normalizeCcEmails (pure) ─────────────────────────────────────────────────

describe('normalizeCcEmails', () => {
    it('met en minuscules, élague et déduplique', () => {
        expect(normalizeCcEmails(['  A@x.com ', 'a@X.com', 'b@x.com'], 'main@x.com'))
            .toEqual(['a@x.com', 'b@x.com']);
    });

    it("retire l'adresse déjà destinataire principal", () => {
        // Sans ce retrait, l'armateur recevrait deux fois le même e-mail.
        expect(normalizeCcEmails(['Main@x.com', 'b@x.com'], 'main@x.com')).toEqual(['b@x.com']);
    });

    it('écarte les entrées vides', () => {
        expect(normalizeCcEmails(['', '   ', 'b@x.com'], 'main@x.com')).toEqual(['b@x.com']);
    });

    it('ne plafonne plus elle-meme (round de correction 1) — le schema refuse en amont', () => {
        // Tronquer ici masquerait un depassement au lieu de le signaler : voir
        // le schema Zod de updateArmateurContacts (`.max(MAX_CC_EMAILS)`), qui
        // refuse desormais la requete entiere plutot que d'enregistrer une
        // liste raccourcie sans le dire.
        const many = Array.from({ length: MAX_CC_EMAILS + 5 }, (_, i) => `u${i}@x.com`);
        expect(normalizeCcEmails(many, 'main@x.com')).toHaveLength(MAX_CC_EMAILS + 5);
    });
});

// ── Gardes (reprises à l'identique de l'action remplacée) ──────────────────

describe('updateArmateurContacts — gardes', () => {
    it('rejette un appelant non authentifié', async () => {
        getUserMock.mockResolvedValue({ data: { user: null } });
        const r = await updateArmateurContacts(baseInput);
        expect(r).toEqual({ ok: false, reason: 'not authenticated' });
        expect(contactsUpdateSpy).not.toHaveBeenCalled();
    });

    it('rejette un rôle hors liste (MANAGER)', async () => {
        profileSingleMock.mockResolvedValue({ data: { role: 'MANAGER', full_name: 'M' }, error: null });
        const r = await updateArmateurContacts(baseInput);
        expect(r).toEqual({ ok: false, reason: 'insufficient role' });
        expect(contactsUpdateSpy).not.toHaveBeenCalled();
    });

    it('rejette une entrée invalide (Zod)', async () => {
        const r = await updateArmateurContacts({ ...baseInput, officialEmail: 'not-an-email' });
        expect(r.ok).toBe(false);
        expect(contactsUpdateSpy).not.toHaveBeenCalled();
    });

    it('renvoie "shipowner not found" quand l\'armateur est introuvable', async () => {
        ownerRow = null;
        const r = await updateArmateurContacts(baseInput);
        expect(r).toEqual({ ok: false, reason: 'shipowner not found' });
    });

    it('isolation de juridiction — refuse un PORT_OFFICER hors de sa juridiction', async () => {
        ownerRow = { id: SHIPOWNER_ID, jurisdiction_id: OTHER_JID, public_ref: PUBLIC_REF };
        const r = await updateArmateurContacts(baseInput);
        expect(r).toEqual({ ok: false, reason: 'forbidden: shipowner belongs to another jurisdiction' });
        expect(contactsUpdateSpy).not.toHaveBeenCalled();
    });

    it('isolation de juridiction — autorise un PORT_OFFICER dans sa propre juridiction', async () => {
        const r = await updateArmateurContacts(baseInput);
        expect(r).toEqual({ ok: true });
    });

    it('SUPERADMIN contourne la vérification de juridiction', async () => {
        profileSingleMock.mockResolvedValue({ data: { role: 'SUPERADMIN', full_name: 'Root' }, error: null });
        ownerRow = { id: SHIPOWNER_ID, jurisdiction_id: OTHER_JID, public_ref: PUBLIC_REF };
        const r = await updateArmateurContacts(baseInput);
        expect(r).toEqual({ ok: true });
    });
});

// ── preferredLanguage : enum sur les six locales livrées (mig 124) ─────────
// La colonne shipowners.preferred_language est NOT NULL avec un CHECK sur
// en/fr/so/pt/ar/sw (migration 124) : Zod doit refuser exactement ce que
// Postgres refuserait, et jamais accepter null (contrairement aux cinq autres
// coordonnées, qui elles peuvent être explicitement effacées).
describe('updateArmateurContacts — revalidation', () => {
    it('revalide la fiche par sa reference opaque, jamais par son identifiant', async () => {
        // La route /admin/armateurs/[ref] est indexee par la reference opaque
        // (mig 144) : revalider le chemin construit avec l'UUID ne purgerait
        // rien, et la fiche resterait perimee apres une correction de contact.
        const { revalidatePath } = await import('next/cache');
        const { updateArmateurContacts } = await import('../actions/updateArmateurContacts');

        await updateArmateurContacts({ shipownerId: SHIPOWNER_ID, officialEmail: 'a@b.example' });

        expect(revalidatePath).toHaveBeenCalledWith(`/admin/armateurs/${PUBLIC_REF}`);
        expect(revalidatePath).not.toHaveBeenCalledWith(`/admin/armateurs/${SHIPOWNER_ID}`);
    });
});

describe('updateArmateurContacts — preferredLanguage', () => {
    it('rejette une langue hors des six locales livrées', async () => {
        const r = await updateArmateurContacts({ ...baseInput, preferredLanguage: 'de' });
        expect(r.ok).toBe(false);
        expect(contactsUpdateSpy).not.toHaveBeenCalled();
    });

    it('rejette null (la colonne est NOT NULL, contrairement aux autres coordonnées)', async () => {
        const r = await updateArmateurContacts({ ...baseInput, preferredLanguage: null });
        expect(r.ok).toBe(false);
        expect(contactsUpdateSpy).not.toHaveBeenCalled();
    });

    it('accepte le somali (so) — la régression que la mig 124 corrige', async () => {
        const r = await updateArmateurContacts({ ...baseInput, preferredLanguage: 'so' });
        expect(r).toEqual({ ok: true });
        const patch = contactsUpdateSpy.mock.calls[0]![0];
        expect(patch).toMatchObject({ preferred_language: 'so' });
    });
});

// ── Délégation de l'e-mail officiel ─────────────────────────────────────────

describe('updateArmateurContacts — e-mail officiel', () => {
    it('passe toujours par upsertShipownerEmail en source PORT_OFFICER, e-mail normalisé', async () => {
        // z.email() n'accepte pas les espaces superflus (comportement hérité à
        // l'identique de l'action remplacée) : seule la casse reste à normaliser ici.
        await updateArmateurContacts({ ...baseInput, officialEmail: 'Owner@Example.COM' });
        expect(upsertEmailSpy).toHaveBeenCalledTimes(1);
        const [, ownerId, email, source] = upsertEmailSpy.mock.calls[0]!;
        expect(ownerId).toBe(SHIPOWNER_ID);
        expect(email).toBe('owner@example.com');
        expect(source).toBe('PORT_OFFICER');
    });
});

// ── Plafond de copies (round de correction 1) ───────────────────────────────
// Avant : un dépassement était absorbé en silence par normalizeCcEmails (elle
// tronquait à MAX_CC_EMAILS). Depuis, le schéma Zod refuse la requête entière
// dès que la liste BRUTE dépasse le plafond — aucune troncature, aucun succès
// partiel non signalé.

describe('updateArmateurContacts — plafond de copies', () => {
    it('refuse un dépassement du plafond au lieu de tronquer en silence', async () => {
        const many = Array.from({ length: MAX_CC_EMAILS + 1 }, (_, i) => `cc${i}@x.com`);
        const r = await updateArmateurContacts({ ...baseInput, billingCcEmails: many });
        expect(r.ok).toBe(false);
        expect(contactsUpdateSpy).not.toHaveBeenCalled();
    });

    it('accepte exactement le plafond', async () => {
        const exactlyMax = Array.from({ length: MAX_CC_EMAILS }, (_, i) => `cc${i}@x.com`);
        const r = await updateArmateurContacts({ ...baseInput, billingCcEmails: exactlyMax });
        expect(r).toEqual({ ok: true });
        const patch = contactsUpdateSpy.mock.calls[0]![0];
        expect(patch.billing_cc_emails).toHaveLength(MAX_CC_EMAILS);
    });
});

// ── Le piège : mise à jour partielle des coordonnées ────────────────────────

describe('updateArmateurContacts — pas d\'écrasement des coordonnées', () => {
    it("n'inclut aucune des coordonnées annexes quand l'e-mail et une liste de copies explicite (même vide) sont fournis", async () => {
        // baseInput fournit `billingCcEmails: []` explicitement — donc `!== undefined`,
        // donc écrit tel quel. Ce n'est plus ce qu'envoient les écrans d'édition
        // rapide aujourd'hui (voir les deux tests suivants : ils omettent
        // désormais la clé) ; ce test verrouille le comportement pour un appelant
        // qui voudrait explicitement vider la liste.
        await updateArmateurContacts(baseInput);
        expect(contactsUpdateSpy).toHaveBeenCalledTimes(1);
        const patch = contactsUpdateSpy.mock.calls[0]![0];
        expect(patch).toEqual({ billing_cc_emails: [] });
        expect(patch).not.toHaveProperty('ops_email');
        expect(patch).not.toHaveProperty('finance_email');
        expect(patch).not.toHaveProperty('phone_e164');
        expect(patch).not.toHaveProperty('address');
        expect(patch).not.toHaveProperty('preferred_language');
        expect(patch).not.toHaveProperty('notes');
    });

    it("édition rapide (clé billingCcEmails absente, comme ArmateursCockpit.tsx/AirlineDetail.tsx/AirlinesCockpit.tsx) : ne touche pas aux copies existantes et ne déclenche aucun second écrit si rien d'autre n'est fourni", async () => {
        const quickEdit = { shipownerId: SHIPOWNER_ID, officialEmail: 'owner@example.com' };
        const r = await updateArmateurContacts(quickEdit);
        expect(r).toEqual({ ok: true });
        // Rien à écrire côté coordonnées : le second aller-retour PostgREST est
        // sauté plutôt que d'envoyer .update({}), qui ne correspond à aucune colonne.
        expect(contactsUpdateSpy).not.toHaveBeenCalled();
    });

    it("édition rapide : n'inclut pas billing_cc_emails dans le patch ni dans l'audit quand d'autres coordonnées sont fournies", async () => {
        const r = await updateArmateurContacts({
            shipownerId: SHIPOWNER_ID, officialEmail: 'owner@example.com', notes: 'ping',
        });
        expect(r).toEqual({ ok: true });
        expect(contactsUpdateSpy).toHaveBeenCalledTimes(1);
        const patch = contactsUpdateSpy.mock.calls[0]![0];
        expect(patch).not.toHaveProperty('billing_cc_emails');
        expect(patch).toMatchObject({ notes: 'ping' });

        const auditPayload = auditInsertSpy.mock.calls[0]![0];
        const details = auditPayload.details_json as { fields: string[] };
        expect(details.fields).not.toContain('billingCcEmails');
        expect(details.fields).toEqual(['officialEmail', 'notes']);
    });

    it('applique une valeur explicite fournie', async () => {
        await updateArmateurContacts({ ...baseInput, notes: 'Contact prioritaire' });
        const patch = contactsUpdateSpy.mock.calls[0]![0];
        expect(patch).toMatchObject({ notes: 'Contact prioritaire' });
    });

    it('efface un champ quand la valeur explicite est null', async () => {
        await updateArmateurContacts({ ...baseInput, phoneE164: null });
        const patch = contactsUpdateSpy.mock.calls[0]![0];
        expect(patch).toHaveProperty('phone_e164', null);
    });

    it('inclut toutes les coordonnées fournies simultanément', async () => {
        await updateArmateurContacts({
            ...baseInput,
            opsEmail: 'ops@armateur.com',
            financeEmail: 'finance@armateur.com',
            phoneE164: '+253771234567',
            address: '12 Port Road',
            preferredLanguage: 'fr',
            notes: 'VIP',
        });
        const patch = contactsUpdateSpy.mock.calls[0]![0];
        expect(patch).toMatchObject({
            ops_email: 'ops@armateur.com',
            finance_email: 'finance@armateur.com',
            phone_e164: '+253771234567',
            address: '12 Port Road',
            preferred_language: 'fr',
            notes: 'VIP',
        });
    });

    it('normalise les copies de facturation dans le patch', async () => {
        // z.email() rejette les espaces superflus en amont : le patch ne voit donc
        // que des entrées déjà "valides" — seules casse et doublon restent à traiter.
        await updateArmateurContacts({
            ...baseInput,
            officialEmail: 'main@x.com',
            billingCcEmails: ['Main@x.com', 'B@x.com', 'b@x.com'],
        });
        const patch = contactsUpdateSpy.mock.calls[0]![0];
        expect(patch.billing_cc_emails).toEqual(['b@x.com']);
    });
});

// ── Audit ────────────────────────────────────────────────────────────────────

describe('updateArmateurContacts — audit', () => {
    it('trace les champs modifiés uniquement (jamais les valeurs) et se limite aux champs réellement fournis', async () => {
        await updateArmateurContacts({ ...baseInput, notes: 'Contact prioritaire' });
        expect(auditInsertSpy).toHaveBeenCalledTimes(1);
        const payload = auditInsertSpy.mock.calls[0]![0];
        expect(payload).toMatchObject({
            user_id: 'staff-1',
            action: 'SHIPOWNER_UPDATED',
            severity: 'INFO',
            entity_type: 'Shipowner',
            entity_id: SHIPOWNER_ID,
            jurisdiction_id: JID,
        });
        const details = payload.details_json as { event: string; fields: string[] };
        expect(details.event).toBe('CONTACTS_UPDATED');
        expect(details.fields).toEqual(expect.arrayContaining(['officialEmail', 'billingCcEmails', 'notes']));
        expect(details.fields).not.toContain('opsEmail');
        // Ce sont des données personnelles : seuls les noms de champs apparaissent, jamais leur contenu.
        expect(JSON.stringify(payload)).not.toContain('Contact prioritaire');
        expect(JSON.stringify(payload)).not.toContain('owner@example.com');
    });

    // ── Succès partiel : deux transactions PostgREST distinctes ────────────
    // upsertShipownerEmail (e-mail) et le .update(patch) (coordonnées) sont deux
    // requêtes séparées. Si la première réussit et que la seconde échoue, l'e-mail
    // est déjà écrit DURABLEMENT — la fonction ne doit ni le taire (ok:false sans
    // audit) ni le nier (message générique). Ni "rien n'a changé", ni "tout a réussi".
    it("succes partiel : l'e-mail est ecrit, les coordonnees echouent — trace quand meme et le dit", async () => {
        contactsUpdateSpy.mockImplementationOnce(() => ({ error: { message: 'db down' } }));
        const r = await updateArmateurContacts({ ...baseInput, notes: 'Contact prioritaire' });

        expect(upsertEmailSpy).toHaveBeenCalledTimes(1); // l'e-mail EST parti
        expect(r).toEqual({
            ok: false,
            reason: 'official email saved, but contacts could not be updated: db down',
        });

        // La trace reflète ce qui a RÉELLEMENT changé (l'e-mail seul), pas ce qui a
        // été demandé (notes y était aussi) — sinon l'audit mentirait à son tour.
        expect(auditInsertSpy).toHaveBeenCalledTimes(1);
        const payload = auditInsertSpy.mock.calls[0]![0];
        expect(payload).toMatchObject({ action: 'SHIPOWNER_UPDATED', severity: 'WARNING', entity_type: 'Shipowner' });
        const details = payload.details_json as { event: string; fields: string[] };
        expect(details.event).toBe('CONTACTS_PARTIALLY_UPDATED');
        expect(details.fields).toEqual(['officialEmail']);
    });

    it("double echec (coordonnees ET trace du succes partiel) : le message renvoye reste celui de l'echec des coordonnees", async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        contactsUpdateSpy.mockImplementationOnce(() => ({ error: { message: 'db down' } }));
        auditInsertSpy.mockImplementationOnce(() => ({ error: { message: 'audit db down too' } }));

        const r = await updateArmateurContacts(baseInput);
        expect(r).toEqual({
            ok: false,
            reason: 'official email saved, but contacts could not be updated: db down',
        });
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        consoleErrorSpy.mockRestore();
    });

    it("echec du seul insert d'audit apres un succes complet : ne renvoie pas ok:true", async () => {
        auditInsertSpy.mockImplementationOnce(() => ({ error: { message: 'audit db down' } }));
        const r = await updateArmateurContacts(baseInput);
        expect(r).toEqual({
            ok: false,
            reason: 'contacts updated, but the audit trail failed: audit db down',
        });
        // Les deux écritures de données ont bien eu lieu — seule la trace a échoué.
        expect(upsertEmailSpy).toHaveBeenCalledTimes(1);
        expect(contactsUpdateSpy).toHaveBeenCalledTimes(1);
    });
});
