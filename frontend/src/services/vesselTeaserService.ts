import { createClient } from '@supabase/supabase-js';
import { enforceRateLimit } from '@/lib/rateLimit';
import { normalizeVesselIdentifier } from '@/lib/vessels/identifier';

export interface VesselTeaser {
    vesselName: string;
    imoNumber: string;
    portCall: string | null;
    outstandingCount: number;
    earliestDueDate: string | null;
    hasOverdue: boolean;
    claimable: boolean;
}

export type TeaserState =
    | { state: 'OUTSTANDING'; teaser: VesselTeaser }
    | { state: 'CLEAR'; teaser: VesselTeaser }
    | { state: 'UNKNOWN' };

const UNKNOWN: TeaserState = { state: 'UNKNOWN' };

interface TeaserRow {
    vessel_name: string;
    imo_number: string;
    port_call: string | null;
    outstanding_count: number;
    earliest_due_date: string | null;
    has_overdue: boolean;
    claimable: boolean;
}

/**
 * Consultation publique d'un navire par IMO ou MMSI.
 *
 * Tous les chemins d'échec — identifiant invalide, quota dépassé, navire
 * inconnu, RPC en erreur — retournent le MÊME objet UNKNOWN. C'est
 * délibéré : un espace de 7 chiffres est entièrement énumérable, et une
 * réponse distincte pour « throttlé » transformerait le rate-limit lui-même
 * en oracle. Voir /verify, durci sur le même principe après l'audit fraude
 * 2026-04.
 *
 * On projette explicitement champ par champ plutôt que d'étaler la ligne :
 * si quelqu'un ajoute un jour une colonne à la RPC, elle ne traverse pas
 * silencieusement jusqu'au navigateur.
 */
export async function lookupVesselTeaser(
    rawQuery: string,
    clientId: string,
): Promise<TeaserState> {
    const identifier = normalizeVesselIdentifier(rawQuery);
    if (!identifier) return UNKNOWN;

    const rate = await enforceRateLimit('vessel-lookup', clientId);
    if (!rate.allowed) return UNKNOWN;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return UNKNOWN;

    const anon = createClient(url, anonKey);
    const { data, error } = await anon.rpc('vessel_payment_teaser', {
        p_identifier: identifier.value,
    });

    if (error || !data || (data as TeaserRow[]).length === 0) return UNKNOWN;
    const row = (data as TeaserRow[])[0];

    const teaser: VesselTeaser = {
        vesselName: row.vessel_name,
        imoNumber: row.imo_number,
        portCall: row.port_call,
        outstandingCount: Number(row.outstanding_count),
        earliestDueDate: row.earliest_due_date,
        hasOverdue: Boolean(row.has_overdue),
        claimable: Boolean(row.claimable),
    };

    return teaser.outstandingCount > 0
        ? { state: 'OUTSTANDING', teaser }
        : { state: 'CLEAR', teaser };
}
