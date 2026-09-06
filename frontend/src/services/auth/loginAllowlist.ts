import { type SupabaseClient } from '@supabase/supabase-js';

export type LoginScope = 'OWNER' | 'MEMBER' | 'REPRESENTATIVE' | 'BILLING_CC';

export interface LoginTarget {
    shipownerId: string;
    shipownerName: string;
    /** Adresse d'envoi — toujours issue de la base, jamais de la saisie. */
    deliveryEmail: string;
    scope: LoginScope;
    isOfacSdn: boolean;
    isUnProhibited: boolean;
}

const OWNER_COLUMNS =
    'id, name, official_email, is_placeholder, is_ofac_sdn, is_un_prohibited';

/**
 * Résout une adresse en un armateur ouvrable.
 *
 * Quatre sources, par priorité décroissante :
 *   1. l'adresse officielle de l'armateur ;
 *   2. un membre du compte, actif (owner_members, mig 135) — revendication plus
 *      forte qu'un rattachement : ses droits sont explicitement cochés ;
 *   3. un représentant rattaché et actif (owner_agent_mappings) ;
 *   4. un destinataire en copie de facturation
 *      (`shipowners.billing_cc_emails`, colonne TEXT[] de la mig 122 — ce
 *      n'est pas une table).
 *
 * Deux invariants tenus ici plutôt que chez l'appelant :
 *   — un armateur fictif n'est jamais une cible ;
 *   — l'adresse de livraison vient de la base. La saisie sert à chercher,
 *     jamais à recevoir : sans cela, connaître une adresse d'armateur
 *     suffirait à détourner son lien vers une boîte tierce.
 *
 * Un SEUL armateur est rendu. La plateforme suppose partout un profil pour un
 * armateur : `current_shipowner_id()` fait `LIMIT 1` sans `ORDER BY` et porte
 * le RLS, `requirePrincipal` fait `.maybeSingle()` et échoue sur deux lignes.
 * Les dossiers supplémentaires joignables à la même adresse — le cas
 * faros@farosshipping.example, qui couvre PRO-CONS-2026-008 et -021 — passent par
 * un rattachement, pas par un sélecteur.
 *
 * Les drapeaux de sanctions sont REMONTÉS, pas appliqués : c'est l'appelant
 * qui décide d'envoyer ou non, et qui journalise le blocage.
 */
export async function resolveLoginTarget(
    admin: SupabaseClient,
    rawEmail: string,
): Promise<LoginTarget | null> {
    const email = rawEmail.trim().toLowerCase();
    // Une saisie qui n'est pas une adresse ne doit produire aucune requête :
    // le formulaire est public et sert de surface d'énumération.
    if (!email.includes('@') || email.length < 5) return null;

    // PAS de .maybeSingle() ici. Une adresse couvre legitimement plusieurs
    // dossiers — faros@farosshipping.example porte PRO-CONS-2026-008 et -021, soit
    // 56 518,80 USD — et maybeSingle() ECHOUE des que deux lignes
    // correspondent : l'armateur ne pouvait plus se connecter du tout, sans le
    // moindre message. On ordonne pour un choix stable et on prend le premier.
    //
    // Le dossier retenu est celui du compte ; les autres se rattachent par
    // owner_agent_mappings, la plateforme supposant partout un profil pour un
    // armateur (current_shipowner_id() fait LIMIT 1 sans ORDER BY).
    const { data: owners } = await admin
        .from('shipowners')
        .select(OWNER_COLUMNS)
        .eq('official_email', email)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(2);
    const ownerRows = (owners ?? []) as Record<string, unknown>[];
    if (ownerRows.length > 0) return toTarget(ownerRows[0], 'OWNER', email);

    // Membre du compte (mig 135). Passe AVANT le rattachement : un membre a des
    // droits explicites, un représentant n'a qu'un lien de correspondance.
    //
    // La CLÉ ÉTRANGÈRE EST NOMMÉE, et ce n'est pas décoratif : `owner_members`
    // en porte DEUX vers `profiles` — `profile_id` et `invited_by`. Un embed
    // `profiles!inner(...)` est alors ambigu, PostgREST refuse la requête
    // entière (PGRST201) et rend `data: null`. Aucun membre ne pouvait recevoir
    // de lien de connexion, sans le moindre message : l'erreur n'était pas lue
    // et le code passait à la source suivante. Même piège sur
    // `owner_agent_mappings` juste en dessous (`agent_profile_id`/`created_by`).
    const { data: member, error: memberErr } = await admin
        .from('owner_members')
        .select(`shipowner_id, active, profiles!owner_members_profile_id_fkey!inner(email), shipowners!inner(${OWNER_COLUMNS})`)
        .eq('profiles.email', email)
        .eq('active', true)
        .maybeSingle();
    // Une erreur ici n'est pas « pas de correspondance » : c'est une requête qui
    // n'a pas tourné. La journaliser est ce qui manquait pour voir le PGRST201.
    if (memberErr) console.error('[loginAllowlist] requête membre en échec :', memberErr.message);
    if (member) {
        const row = member as Record<string, unknown>;
        const so = (row.shipowners ?? row) as Record<string, unknown>;
        return toTarget(so, 'MEMBER', email);
    }

    const { data: rep, error: repErr } = await admin
        .from('owner_agent_mappings')
        .select(`shipowner_id, active, profiles!owner_agent_mappings_agent_profile_id_fkey!inner(email), shipowners!inner(${OWNER_COLUMNS})`)
        .eq('profiles.email', email)
        .eq('active', true)
        .maybeSingle();
    if (repErr) console.error('[loginAllowlist] requête représentant en échec :', repErr.message);
    if (rep) {
        const row = rep as Record<string, unknown>;
        const so = (row.shipowners ?? row) as Record<string, unknown>;
        return toTarget(so, 'REPRESENTATIVE', email);
    }

    // Même raison qu'au-dessus : une adresse peut être en copie sur plusieurs
    // dossiers, et maybeSingle() la rendrait alors introuvable.
    const { data: ccRows } = await admin
        .from('shipowners')
        .select(OWNER_COLUMNS)
        .contains('billing_cc_emails', [email])
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1);
    const cc = ((ccRows ?? []) as Record<string, unknown>[])[0];
    if (cc) return toTarget(cc, 'BILLING_CC', email);

    return null;
}

/**
 * Rôles qui ouvrent une session STAFF par lien de connexion.
 *
 * `SHIPPING_AGENT` en est exclu : c'est un rôle d'opérateur, ouvert en
 * self-service par /signup, pas un agent de la plateforme. `SHIPOWNER` l'est
 * aussi — un armateur passe par `resolveLoginTarget`, qui le rattache à son
 * dossier et applique la garde des sanctions.
 */
const STAFF_LOGIN_ROLES = ['SUPERADMIN', 'PORT_OFFICER', 'FINANCE_ADMIN', 'MANAGER'] as const;

export interface StaffLoginTarget {
    profileId: string;
    fullName: string | null;
    /** Adresse d'envoi — issue de la base, jamais de la saisie. */
    deliveryEmail: string;
    role: string;
}

/**
 * Résout une adresse en un compte STAFF ouvrable.
 *
 * Le staff n'avait aucun rail de lien de connexion : le formulaire ne servait
 * que les armateurs, et une adresse d'administration y recevait le même
 * message neutre que n'importe quelle inconnue — indiscernable d'un mailer en
 * panne. Les comptes staff étant créés sans mot de passe, il n'existait
 * aucune façon d'entrer sans intervention en base.
 *
 * Le profil de risque est celui du chemin armateur : on n'écrit qu'à une
 * adresse DÉJÀ enregistrée, et l'adresse de livraison vient de la base.
 *
 * PAS de `.maybeSingle()` — il ÉCHOUE dès que deux lignes correspondent, et
 * rendrait le compte introuvable sans le moindre message. On ordonne pour un
 * choix stable et on prend le premier.
 */
export async function resolveStaffLoginTarget(
    admin: SupabaseClient,
    rawEmail: string,
): Promise<StaffLoginTarget | null> {
    const email = rawEmail.trim().toLowerCase();
    if (!email.includes('@') || email.length < 5) return null;

    const { data, error } = await admin
        .from('profiles')
        .select('id, email, full_name, role, is_active')
        .eq('email', email)
        .eq('is_active', true)
        .in('role', STAFF_LOGIN_ROLES as unknown as string[])
        .order('created_at', { ascending: true })
        .limit(1);

    // Une erreur n'est pas « pas de correspondance » : c'est une requête qui
    // n'a pas tourné. Sans cette ligne, un PGRST se lirait comme une absence.
    if (error) {
        console.error('[loginAllowlist] requête staff en échec :', error.message);
        return null;
    }

    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    const deliveryEmail = String(row.email ?? '').trim().toLowerCase();
    if (!deliveryEmail) return null;

    return {
        profileId: String(row.id),
        fullName: row.full_name ? String(row.full_name) : null,
        deliveryEmail,
        role: String(row.role),
    };
}

/**
 * `deliveryEmail` vaut l'adresse officielle pour un armateur, et l'adresse
 * reconnue pour un représentant ou une copie : envoyer le lien d'un
 * représentant à l'armateur le priverait de l'accès qu'on vient de lui
 * accorder. Dans les deux cas la valeur vient de la base.
 */
function toTarget(
    row: Record<string, unknown>,
    scope: LoginScope,
    matchedEmail: string,
): LoginTarget | null {
    if (row.is_placeholder === true) return null;

    const officialEmail = String(row.official_email ?? '').trim().toLowerCase();
    const deliveryEmail = scope === 'OWNER' ? officialEmail : matchedEmail;
    if (!deliveryEmail) return null;

    return {
        shipownerId: String(row.id),
        shipownerName: String(row.name),
        deliveryEmail,
        scope,
        isOfacSdn: row.is_ofac_sdn === true,
        isUnProhibited: row.is_un_prohibited === true,
    };
}
