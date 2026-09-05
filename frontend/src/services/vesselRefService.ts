import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

/**
 * Forme d'une référence publique de navire : `ves_` suivi de 12 caractères
 * hexadécimaux (mig 147). Vérifiée avant toute requête pour qu'une URL
 * fantaisiste — ou l'ancien UUID — soit écartée sans déranger la base.
 */
const REF_SHAPE = /^ves_[0-9a-f]{12}$/;

export function isVesselRef(value: string): boolean {
    return REF_SHAPE.test(value);
}

/**
 * Référence publique → identifiant interne.
 *
 * Renvoie `null` quand la référence est mal formée, inconnue, ou hors du
 * périmètre de l'appelant : la RLS s'applique, donc une référence valide d'un
 * navire qu'on n'a pas le droit de voir est indistinguable d'une référence
 * inexistante. C'est voulu — l'écran répond « introuvable » dans les deux cas.
 *
 * `shipownerId`, quand il est donné, resserre encore : la RLS seule laisserait
 * passer un navire rattaché par le lien agent hérité (`owner_id`, mig 073),
 * qui ne figure dans aucune liste de l'armateur.
 */
export async function resolveVesselByRef(
    db: Client,
    ref: string,
    shipownerId?: string,
): Promise<string | null> {
    if (!isVesselRef(ref)) return null;
    let query = db.from('vessels').select('id').eq('public_ref', ref);
    if (shipownerId) query = query.eq('shipowner_id', shipownerId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`resolveVesselByRef: ${error.message}`);
    return (data?.id as string | undefined) ?? null;
}
