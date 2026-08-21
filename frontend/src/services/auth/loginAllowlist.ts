import { type SupabaseClient } from '@supabase/supabase-js';

export type LoginScope = 'OWNER' | 'REPRESENTATIVE' | 'BILLING_CC';

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
 * Trois sources, par priorité décroissante :
 *   1. l'adresse officielle de l'armateur ;
 *   2. un représentant rattaché et actif (owner_agent_mappings) ;
 *   3. un destinataire en copie de facturation
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

    const { data: rep } = await admin
        .from('owner_agent_mappings')
        .select(`shipowner_id, active, profiles!inner(email), shipowners!inner(${OWNER_COLUMNS})`)
        .eq('profiles.email', email)
        .eq('active', true)
        .maybeSingle();
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
