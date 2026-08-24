import { type SupabaseClient } from '@supabase/supabase-js';
import type { VesselIdentifier } from '@/lib/vessels/identifier';

/** Statuts qui laissent une somme à devoir — seuls ceux-là ouvrent un accès. */
const OUTSTANDING = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];

export interface VesselOwner {
    id: string;
    name: string;
    officialEmail: string;
    /** Nom du navire retenu, pour rappeler à l'armateur de quoi on parle. */
    vesselName: string | null;
    isOfacSdn: boolean;
    isUnProhibited: boolean;
}

/**
 * Résout un navire (IMO ou MMSI) vers l'armateur à qui l'accès peut être
 * ouvert.
 *
 * IMPLÉMENTATION UNIQUE, volontairement partagée. Deux résolutions parallèles
 * finiraient par porter sur des sous-ensembles différents : l'une ouvrirait un
 * accès que l'autre refuse, sur la même saisie. C'est déjà arrivé entre cette
 * résolution et le RPC `vessel_payment_teaser`.
 *
 * Rend `null` sans distinguer les causes — navire inconnu, aucun avis en
 * souffrance, armateur de regroupement, adresse absente. L'appelant décide
 * quoi en dire ; ici on ne fabrique pas d'oracle.
 */
export async function resolveOwnerByVesselIdentifier(
    admin: SupabaseClient,
    identifier: VesselIdentifier,
): Promise<VesselOwner | null> {
    // `transactions` ne porte que `vessel_imo` — pas de colonne MMSI. Une
    // recherche par MMSI doit donc passer par `vessels` pour obtenir l'IMO.
    let imo = identifier.value;
    let vesselName: string | null = null;

    if (identifier.kind === 'MMSI') {
        const { data: vessel } = await admin
            .from('vessels').select('imo_number, name').eq('mmsi', identifier.value).maybeSingle();
        if (!vessel?.imo_number) return null;
        imo = String(vessel.imo_number);
        vesselName = vessel.name ? String(vessel.name) : null;
    }

    // Résolution via `transactions.shipowner_id` — first-write-only (trigger de
    // la mig 089), donc porteuse de l'attribution fiscale faisant foi. Ne pas
    // « simplifier » vers `vessels.shipowner_id`, librement modifiable.
    //
    // `.not('shipowner_id', 'is', null)` : sans ce filtre, une pro-forma AIR
    // récente auto-émise pour un navire non apparié devient la ligne « la plus
    // récente » retenue ici et fait échouer la résolution — alors même que le
    // RPC `vessel_payment_teaser` a déjà écarté cette ligne et annoncé un avis
    // attribué plus ancien. Les deux résolutions doivent porter sur le même
    // sous-ensemble.
    //
    // `.neq('status', 'VOID')` est implicite : VOID n'est pas dans OUTSTANDING.
    // Une pro-forma annulée par la rebascule du livre n'ouvre donc aucun accès.
    const { data: txn } = await admin
        .from('transactions')
        .select('shipowner_id, vessel_name')
        .eq('vessel_imo', imo)
        .in('status', OUTSTANDING)
        .not('shipowner_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!txn?.shipowner_id) return null;
    vesselName = vesselName ?? (txn.vessel_name ? String(txn.vessel_name) : null);

    const { data: owner } = await admin
        .from('shipowners')
        .select('id, name, official_email, is_placeholder, is_ofac_sdn, is_un_prohibited')
        .eq('id', txn.shipowner_id)
        .maybeSingle();

    // Un armateur de regroupement est refusé AVANT tout envoi, indépendamment
    // de la présence d'une adresse sur la ligne : ouvrir « À identifier »
    // donnerait accès au portefeuille de plusieurs armateurs à la fois.
    if (!owner || owner.is_placeholder) return null;

    const officialEmail = String(owner.official_email ?? '').trim().toLowerCase();
    if (!officialEmail) return null;

    return {
        id: String(owner.id),
        name: String(owner.name),
        officialEmail,
        vesselName,
        isOfacSdn: owner.is_ofac_sdn === true,
        isUnProhibited: owner.is_un_prohibited === true,
    };
}
