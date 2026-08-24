import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArrivalAlertWithVessel } from '@/types/secure/arrivalAlert';
import { listUnclaimedAlerts } from './arrivalAlertService';

/**
 * Imminence d'un accostage, telle que l'opérateur la vit sur le quai.
 *
 * Les seuils ne sont pas décoratifs : sous une heure il faut être au poste,
 * sous six heures il faut avoir préparé l'escale, au-delà c'est de la
 * planification. C'est ce qui décide de l'ordre des cartes et de leur accent.
 */
export type Imminence = 'now' | 'soon' | 'later' | 'unknown';

export const IMMINENT_MINUTES = 60;
export const SOON_HOURS = 6;

export interface OperatorArrival {
    alertId: string;
    vesselName: string;
    imoNumber: string;
    /** Minutes avant l'ETA. Négatif si l'ETA est dépassée, `null` si inconnue. */
    minutesToEta: number | null;
    etaIso: string | null;
    distanceNm: number;
    imminence: Imminence;
    ownerName: string | null;
    /** Encours de l'armateur, en USD. `0` s'il est à jour, `null` si inconnu. */
    ownerOutstandingUsd: number | null;
    /** Vrai quand l'armateur a des factures échues : l'appareillage est alors conditionné. */
    ownerInDefault: boolean;
}

export function imminenceOf(minutesToEta: number | null): Imminence {
    if (minutesToEta === null) return 'unknown';
    if (minutesToEta <= IMMINENT_MINUTES) return 'now';
    if (minutesToEta <= SOON_HOURS * 60) return 'soon';
    return 'later';
}

/** Minutes restantes avant l'ETA, ou `null` si elle est absente ou illisible. */
export function minutesToEta(etaIso: string | null, now: Date = new Date()): number | null {
    if (!etaIso) return null;
    const eta = new Date(etaIso);
    if (Number.isNaN(eta.getTime())) return null;
    return Math.round((eta.getTime() - now.getTime()) / 60_000);
}

/**
 * Trie par imminence d'accostage, jamais par ordre alphabétique.
 *
 * Le navire qui accoste dans quarante minutes passe devant celui de demain,
 * quel que soit son nom : sur le quai, l'ordre de la liste est l'ordre du
 * travail. Les ETA inconnues ferment la marche — on ne peut rien en faire.
 */
export function sortByImminence(arrivals: OperatorArrival[]): OperatorArrival[] {
    return [...arrivals].sort((a, b) => {
        if (a.minutesToEta === null && b.minutesToEta === null) return a.distanceNm - b.distanceNm;
        if (a.minutesToEta === null) return 1;
        if (b.minutesToEta === null) return -1;
        return a.minutesToEta - b.minutesToEta;
    });
}

interface OwnerExposure { name: string | null; outstandingUsd: number; overdueCount: number }

/**
 * Charge les arrivées du quart, chacune avec la solvabilité de son armateur.
 *
 * L'exposition de l'armateur est le seul renseignement que l'opérateur ne peut
 * pas obtenir seul sur le quai, et c'est celui qui change son geste : encaisser
 * avant l'appareillage plutôt qu'après. Elle est donc chargée ici, pas laissée
 * à un second écran.
 */
export async function listOperatorArrivals(
    db: SupabaseClient,
    now: Date = new Date(),
): Promise<OperatorArrival[]> {
    const alerts = await listUnclaimedAlerts(db);
    if (alerts.length === 0) return [];

    // Les alertes ne portent pas l'armateur : il passe par le navire.
    const vesselIds = [...new Set(alerts.map((a) => a.vessel_id))];
    const { data: vessels } = await db
        .from('vessels')
        .select('id, shipowner_id')
        .in('id', vesselIds);

    const ownerByVessel = new Map<string, string>();
    for (const v of (vessels ?? []) as { id: string; shipowner_id: string | null }[]) {
        if (v.shipowner_id) ownerByVessel.set(v.id, v.shipowner_id);
    }

    const ownerIds = [...new Set([...ownerByVessel.values()])];
    const exposures = new Map<string, OwnerExposure>();
    if (ownerIds.length > 0) {
        const { data: owners } = await db
            .from('v_armateur_recouvrement')
            .select('id, name, total_outstanding_usd, overdue_count')
            .in('id', ownerIds);
        for (const o of (owners ?? []) as Record<string, unknown>[]) {
            exposures.set(String(o.id), {
                name: (o.name as string | null) ?? null,
                outstandingUsd: Number(o.total_outstanding_usd ?? 0),
                overdueCount: Number(o.overdue_count ?? 0),
            });
        }
    }

    return sortByImminence(alerts.map((a) => toArrival(a, ownerByVessel, exposures, now)));
}

function toArrival(
    alert: ArrivalAlertWithVessel,
    ownerByVessel: Map<string, string>,
    exposures: Map<string, OwnerExposure>,
    now: Date,
): OperatorArrival {
    const ownerId = ownerByVessel.get(alert.vessel_id);
    const exposure = ownerId ? exposures.get(ownerId) : undefined;
    const minutes = minutesToEta(alert.estimated_eta, now);

    return {
        alertId: alert.id,
        vesselName: alert.vessel?.name ?? alert.imo_number,
        imoNumber: alert.imo_number,
        minutesToEta: minutes,
        etaIso: alert.estimated_eta,
        distanceNm: alert.distance_to_port_nm,
        imminence: imminenceOf(minutes),
        ownerName: exposure?.name ?? null,
        ownerOutstandingUsd: exposure ? exposure.outstandingUsd : null,
        // « En défaut » veut dire des factures échues, pas un simple encours :
        // un armateur qui doit une facture pas encore échue est à jour.
        ownerInDefault: (exposure?.overdueCount ?? 0) > 0,
    };
}
