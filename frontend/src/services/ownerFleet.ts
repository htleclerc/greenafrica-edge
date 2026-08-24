import type { SupabaseClient } from '@supabase/supabase-js';
import { OPEN_STATUSES, daysToDue, urgencyOf, type WorkUrgency } from './ownerWorkQueue';
import { confirmedPaidUsdByTransaction } from '@/services/confirmedPayments';

/**
 * État d'un navire du point de vue de l'armateur.
 *
 * Deux niveaux de lecture sur l'écran flotte : les navires qui exigent une
 * action sont des **cartes**, les autres des **lignes de tableau**. Un navire
 * qui ne demande rien n'a pas besoin d'une carte — c'est `needsAction` qui
 * tranche, pas le statut brut.
 */
export type FleetStatus = 'overdue' | 'toPay' | 'proforma' | 'compliant' | 'exempt';

export interface FleetVessel {
    id: string;
    name: string;
    imoNumber: string | null;
    category: string | null;
    /** Dernière zone AIS connue — « Quai 3 · Berbera », « Golfe d'Aden ». */
    position: string | null;
    status: FleetStatus;
    /** Reste dû sur les factures ouvertes de ce navire. */
    outstandingUsd: number;
    /** Échéance la plus proche parmi ses factures ouvertes. */
    nextDueDate: string | null;
    daysToDue: number | null;
    urgency: WorkUrgency | null;
    /** Émissions cumulées sur les factures ouvertes, en t CO₂e. */
    emissionsTco2: number;
    paidYtdUsd: number;
    /** Vrai quand le navire porte une carte plutôt qu'une ligne de tableau. */
    needsAction: boolean;
}

export type FleetTab = 'all' | 'action' | 'inPort' | 'compliant' | 'exempt';

export interface OwnerFleet {
    vessels: FleetVessel[];
    counts: Record<FleetTab, number>;
    actionCount: number;
}

/** Zones qui valent « en escale ». Le libellé AIS est libre, on cherche le port. */
const IN_PORT_HINTS = ['berbera', 'quai', 'berth', 'zeila', 'port'];

export function isInPort(position: string | null): boolean {
    if (!position) return false;
    const p = position.toLowerCase();
    return IN_PORT_HINTS.some((h) => p.includes(h));
}

export function matchesFleetTab(v: FleetVessel, tab: FleetTab): boolean {
    switch (tab) {
        case 'all':       return true;
        case 'action':    return v.needsAction;
        case 'inPort':    return isInPort(v.position);
        case 'compliant': return v.status === 'compliant';
        case 'exempt':    return v.status === 'exempt';
    }
}

interface RawVessel {
    id: string;
    name: string;
    imo_number: string | null;
    category: string | null;
    last_zone: string | null;
    compliance_status: string | null;
}

interface RawTxn {
    id?: string;
    vessel_id: string | null;
    vessel_imo: string | null;
    tax_amount_usd: number | string | null;
    /** Gelee par la mig 089, jamais ecrite : vaut zero sur toute facture en cours. */
    partial_paid_usd: number | string | null;
    /** Encaisse reel, lu dans les paiements CONFIRMED (services/confirmedPayments). */
    confirmed_paid_usd?: number | null;
    emissions_tco2: number | string | null;
    due_date: string | null;
    document_type: string | null;
    status: string;
}

/**
 * Croise navires et factures pour donner à chaque navire son état et son dû.
 *
 * Le rapprochement passe par `vessel_id` quand il est posé, et retombe sur
 * l'IMO sinon : les factures antérieures au rattachement des navires ne portent
 * que l'IMO, et les ignorer afficherait un navire « conforme » alors qu'il doit.
 */
export function buildFleet(
    vessels: RawVessel[],
    open: RawTxn[],
    paid: RawTxn[],
    now: Date = new Date(),
): OwnerFleet {
    const byId = new Map<string, RawTxn[]>();
    const byImo = new Map<string, RawTxn[]>();
    for (const txn of open) {
        if (txn.vessel_id) push(byId, txn.vessel_id, txn);
        else if (txn.vessel_imo) push(byImo, txn.vessel_imo, txn);
    }

    const paidById = new Map<string, number>();
    const paidByImo = new Map<string, number>();
    for (const txn of paid) {
        const amount = Number(txn.tax_amount_usd ?? 0);
        if (txn.vessel_id) paidById.set(txn.vessel_id, (paidById.get(txn.vessel_id) ?? 0) + amount);
        else if (txn.vessel_imo) paidByImo.set(txn.vessel_imo, (paidByImo.get(txn.vessel_imo) ?? 0) + amount);
    }

    const built = vessels.map((v): FleetVessel => {
        const txns = [
            ...(byId.get(v.id) ?? []),
            ...(v.imo_number ? byImo.get(v.imo_number) ?? [] : []),
        ];

        // Le reste du se lit dans les paiements CONFIRMED, pas dans
        // `partial_paid_usd` : cette colonne vaut zero sur toute facture en
        // cours, si bien que l'armateur voyait la dette pleine d'une facture
        // qu'il avait deja reglee en partie.
        const outstandingUsd = txns.reduce(
            (sum, txn) => sum + outstandingLine(txn),
            0,
        );
        const emissionsTco2 = txns.reduce((sum, txn) => sum + Number(txn.emissions_tco2 ?? 0), 0);

        const dueDates = txns.map((txn) => txn.due_date).filter((d): d is string => !!d).sort();
        const nextDueDate = dueDates[0] ?? null;
        const days = daysToDue(nextDueDate, now);

        const status = fleetStatus(v, txns, outstandingUsd, days);
        return {
            id: v.id,
            name: v.name,
            imoNumber: v.imo_number,
            category: v.category,
            position: v.last_zone,
            status,
            outstandingUsd,
            nextDueDate,
            daysToDue: days,
            urgency: outstandingUsd > 0 ? urgencyOf(days) : null,
            emissionsTco2,
            paidYtdUsd: (paidById.get(v.id) ?? 0) + (v.imo_number ? paidByImo.get(v.imo_number) ?? 0 : 0),
            // Une pro-forma en attente d'escale demande un regard, pas un paiement :
            // elle porte une carte au même titre qu'un impayé, avec une autre action.
            needsAction: status === 'overdue' || status === 'toPay' || status === 'proforma',
        };
    });

    // Les cartes d'abord, du plus urgent au moins urgent ; les lignes ensuite,
    // par nom. L'ordre de l'écran est l'ordre du travail, comme partout ailleurs.
    const vesselsSorted = [...built].sort((a, b) => {
        if (a.needsAction !== b.needsAction) return a.needsAction ? -1 : 1;
        if (a.needsAction) {
            const da = a.daysToDue ?? Number.MAX_SAFE_INTEGER;
            const db = b.daysToDue ?? Number.MAX_SAFE_INTEGER;
            if (da !== db) return da - db;
        }
        return a.name.localeCompare(b.name);
    });

    const count = (tab: FleetTab) => vesselsSorted.filter((v) => matchesFleetTab(v, tab)).length;
    return {
        vessels: vesselsSorted,
        counts: {
            all: vesselsSorted.length,
            action: count('action'),
            inPort: count('inPort'),
            compliant: count('compliant'),
            exempt: count('exempt'),
        },
        actionCount: count('action'),
    };
}

function fleetStatus(
    v: RawVessel,
    txns: RawTxn[],
    outstandingUsd: number,
    days: number | null,
): FleetStatus {
    if (v.compliance_status === 'EXEMPT') return 'exempt';
    if (outstandingUsd <= 0) return 'compliant';
    if (days !== null && days < 0) return 'overdue';
    // Une pro-forma n'est due qu'à l'escale : tant qu'aucune échéance n'est
    // posée, ce n'est pas un retard de paiement, c'est une estimation.
    if (days === null && txns.every((t) => t.document_type === 'PROFORMA')) return 'proforma';
    return 'toPay';
}

/** Reste du d'une ligne : montant taxe moins l'encaissement le mieux connu. */
function outstandingLine(txn: RawTxn): number {
    const paid = Math.max(Number(txn.partial_paid_usd ?? 0), Number(txn.confirmed_paid_usd ?? 0));
    return Math.max(0, Number(txn.tax_amount_usd ?? 0) - paid);
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
}

/**
 * Charge la flotte de l'armateur.
 *
 * Les navires sont bornés EXPLICITEMENT à son dossier. S'en remettre à la
 * seule RLS ne suffit pas : celle-ci autorise aussi la lecture d'un navire
 * dont `owner_id` vaut l'utilisateur courant (« Shipping agents see own
 * fleet », mig 073), un lien hérité du modèle agent antérieur aux dossiers
 * armateurs. Un navire rattaché par cette seule voie apparaissait donc ici et
 * nulle part ailleurs — l'écran « Ma flotte », lui, filtre sur `shipowner_id`
 * et annonçait « aucun navire » quand celui-ci en montrait deux, avec une
 * somme due. Une flotte, une définition.
 *
 * Les factures restent bornées par la RLS de `transactions`, qui passe déjà
 * par `shipowners.profile_id` : même périmètre, pas de filtre à doubler.
 */
export async function getOwnerFleet(
    db: SupabaseClient,
    shipownerId: string,
    now: Date = new Date(),
): Promise<OwnerFleet> {
    const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();
    const TXN_COLUMNS =
        'id, vessel_id, vessel_imo, tax_amount_usd, partial_paid_usd, emissions_tco2, due_date, document_type, status';

    const [vesselsRes, openRes, paidRes] = await Promise.all([
        db.from('vessels')
            .select('id, name, imo_number, category, last_zone, compliance_status')
            .eq('shipowner_id', shipownerId)
            .order('name'),
        db.from('transactions').select(TXN_COLUMNS).in('status', OPEN_STATUSES).limit(500),
        db.from('transactions').select(TXN_COLUMNS).eq('status', 'PAID').gte('paid_at', startOfYear).limit(500),
    ]);

    const open = (openRes.data ?? []) as RawTxn[];
    // Un seul aller-retour pour tout l'encaissement des factures ouvertes.
    const paidByTxn = await confirmedPaidUsdByTransaction(
        db,
        open.map((t) => String(t.id ?? '')).filter(Boolean),
    );
    for (const t of open) t.confirmed_paid_usd = paidByTxn.get(String(t.id ?? '')) ?? 0;

    return buildFleet(
        (vesselsRes.data ?? []) as RawVessel[],
        open,
        (paidRes.data ?? []) as RawTxn[],
        now,
    );
}
