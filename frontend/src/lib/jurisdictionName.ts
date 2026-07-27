import type { SupabaseClient } from '@supabase/supabase-js';

// Repli hérité, utilisé quand jurisdiction_id est absent (lignes antérieures à
// W2) ou quand la lecture échoue. Jamais atteint pour une transaction
// correctement estampillée (W2+).
const LEGACY_FALLBACK: JurisdictionMeta = {
    code: 'SO',
    name: 'Republic of Somaliland',
};

export interface JurisdictionMeta {
    /** Code court ISO-like ('SO', 'DJ'), utilisé comme préfixe de stockage. */
    code: string;
    /** Nom souverain imprimé sur les documents. */
    name: string;
}

// Cache mémoire de 60 s. La table jurisdictions est minuscule et sur le chemin
// chaud (chaque génération de PDF la lit), un aller-retour par identifiant et
// par minute reste largement acceptable.
const cache = new Map<string, { meta: JurisdictionMeta; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

/**
 * Résout le code et le nom souverain d'une juridiction depuis la table publique
 * `jurisdictions`. Retombe sur LEGACY_FALLBACK si l'identifiant est absent, la
 * ligne introuvable, ou la requête en échec.
 */
export async function fetchJurisdictionMeta(
    client: SupabaseClient,
    jurisdictionId: string | null | undefined,
): Promise<JurisdictionMeta> {
    if (!jurisdictionId) return LEGACY_FALLBACK;

    const now = Date.now();
    const cached = cache.get(jurisdictionId);
    if (cached && cached.expiresAt > now) return cached.meta;

    const { data, error } = await client
        .from('jurisdictions')
        .select('code, name')
        .eq('id', jurisdictionId)
        .maybeSingle();

    if (error || !data?.name || !data?.code) return LEGACY_FALLBACK;

    const meta: JurisdictionMeta = {
        code: data.code as string,
        name: data.name as string,
    };
    cache.set(jurisdictionId, { meta, expiresAt: now + CACHE_TTL_MS });
    return meta;
}

/** Adaptateur pour les appelants qui n'ont besoin que du nom souverain. */
export async function fetchJurisdictionName(
    client: SupabaseClient,
    jurisdictionId: string | null | undefined,
): Promise<string> {
    return (await fetchJurisdictionMeta(client, jurisdictionId)).name;
}

/**
 * Lit les adresses en copie des documents fiscaux d'une juridiction depuis la
 * table privée `jurisdiction_billing_cc`.
 *
 * À n'appeler qu'avec un client service-role (chemin d'émission) : la RLS de la
 * table ne laisse lire que le staff. Un client plus faible obtient zéro ligne,
 * ce qui produit ici une liste vide — jamais une erreur. L'absence de copies
 * n'empêche pas d'émettre un document, donc tout échec de lecture est traité
 * comme « aucune copie ».
 */
export async function fetchJurisdictionBillingCc(
    client: SupabaseClient,
    jurisdictionId: string | null | undefined,
): Promise<string[]> {
    if (!jurisdictionId) return [];

    const { data, error } = await client
        .from('jurisdiction_billing_cc')
        .select('cc_emails')
        .eq('jurisdiction_id', jurisdictionId)
        .maybeSingle();

    if (error || !data) return [];
    return (data.cc_emails as string[] | null) ?? [];
}

/** Exposé pour les tests uniquement — vide le cache en mémoire. */
export function _clearCacheForTest(): void {
    cache.clear();
}
