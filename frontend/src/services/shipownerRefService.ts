import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

/**
 * Forme d'une référence publique : `arm_` suivi de 12 caractères hexadécimaux
 * (mig 144). Vérifiée avant toute requête pour qu'une URL fantaisiste soit
 * écartée sans aller déranger la base.
 */
const REF_SHAPE = /^arm_[0-9a-f]{12}$/;

export function isShipownerRef(value: string): boolean {
    return REF_SHAPE.test(value);
}

/**
 * Référence publique → identifiant interne.
 *
 * Renvoie `null` quand la référence est mal formée, inconnue, ou hors du
 * périmètre de l'appelant : la RLS s'applique, donc une référence valide qui
 * appartient à une autre juridiction est indistinguable d'une référence
 * inexistante. C'est voulu — l'écran répond « introuvable » dans les deux cas
 * plutôt que de révéler l'existence d'un armateur qu'on n'a pas le droit de
 * voir.
 */
export async function resolveShipownerByRef(db: Client, ref: string): Promise<string | null> {
    if (!isShipownerRef(ref)) return null;
    const { data, error } = await db
        .from('shipowners')
        .select('id')
        .eq('public_ref', ref)
        .maybeSingle();
    if (error) throw new Error(`resolveShipownerByRef: ${error.message}`);
    return (data?.id as string | undefined) ?? null;
}

/**
 * Identifiants internes → références publiques, pour les écrans dont la vue
 * source ne porte pas la colonne.
 *
 * Une liste vide en entrée ne déclenche aucune requête. Un identifiant absent
 * de la carte signifie que l'appelant n'a pas le droit de le voir : le lien
 * doit alors être omis, jamais construit avec l'identifiant brut en repli —
 * ce serait remettre l'UUID dans l'URL par la porte de derrière.
 */
export async function getShipownerRefs(db: Client, ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return {};
    const { data, error } = await db
        .from('shipowners')
        .select('id, public_ref')
        .in('id', unique);
    if (error) throw new Error(`getShipownerRefs: ${error.message}`);
    const out: Record<string, string> = {};
    for (const row of (data ?? []) as { id: string; public_ref: string | null }[]) {
        if (row.public_ref) out[row.id] = row.public_ref;
    }
    return out;
}
