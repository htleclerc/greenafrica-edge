import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase.generated';
import type { CollectionAdminFilters, CollectionTier } from './collectionAdminService';

type Client = SupabaseClient<Database>;

/**
 * Étapes de la procédure de recouvrement, dans l'ordre où l'agent les fait
 * avancer. Ce ne sont pas les paliers de la rampe (J3…JUDICIAL) mais leurs
 * regroupements métier : un dossier en J3 et un dossier en J7 attendent le même
 * geste, et l'écran doit les présenter ensemble.
 */
export type FunnelStage = 'reminder' | 'formal' | 'authority' | 'settled';

/** Paliers de la rampe rattachés à chaque étape. `settled` se lit sur le statut. */
export const STAGE_TIERS: Record<Exclude<FunnelStage, 'settled'>, CollectionTier[]> = {
    reminder:  ['J3', 'J7'],
    formal:    ['J15', 'J30'],
    authority: ['J45', 'BAILIFF', 'JUDICIAL'],
};

/** Fenêtre de la colonne « Réglés cette semaine ». */
export const SETTLED_WINDOW_DAYS = 7;

/**
 * Plafond de balayage pour les montants et les aperçus.
 *
 * Les comptes affichés en gros sont exacts (requêtes `count` dédiées) ; les
 * montants cumulés et les deux dossiers en aperçu viennent d'un balayage borné.
 * Au-delà de ce plafond `truncated` passe à vrai et l'écran le dit — un cumul
 * silencieusement partiel se lirait comme un cumul complet.
 */
export const FUNNEL_SCAN_LIMIT = 1000;

export interface FunnelPreview {
    transactionId: string;
    debtorName: string;
    invoiceRef: string | null;
    outstandingUsd: number;
    /** Palier atteint — sert au détail « Après relance 1 · 6 » de la colonne réglée. */
    tier: string | null;
}

export interface FunnelColumn {
    stage: FunnelStage;
    /** Compte exact, indépendant du plafond de balayage. */
    count: number;
    /** Cumul des encours des dossiers balayés. */
    outstandingUsd: number;
    /** Les dossiers les plus lourds de l'étape, pour l'aperçu. */
    previews: FunnelPreview[];
    /** Dossiers de l'étape non montrés en aperçu (« +3 autres »). */
    others: number;
}

export interface CollectionFunnel {
    columns: Record<FunnelStage, FunnelColumn>;
    /** Dossiers à faire avancer : tout sauf la colonne des réglés. */
    actionable: number;
    /** Vrai si le balayage a été plafonné : les cumuls sont alors partiels. */
    truncated: boolean;
    /** Dossier le plus grave et le plus ancien — celui du panneau prioritaire. */
    priorityTransactionId: string | null;
}

const PREVIEW_COUNT = 2;
/** Du plus grave au moins grave — décide du dossier prioritaire. */
const STAGE_SEVERITY: FunnelStage[] = ['authority', 'formal', 'reminder', 'settled'];

interface ScanRow {
    transaction_id: string;
    debtor_name: string | null;
    invoice_ref: string | null;
    outstanding_usd: number;
    status: string;
    latest_tier: CollectionTier | null;
    latest_sent_at: string | null;
    latest_response_at: string | null;
}

/**
 * Classe une ligne dans une étape, ou `null` si elle n'entre dans aucune : un
 * dossier sans palier envoyé n'est pas encore dans la procédure, et un dossier
 * réglé il y a trois semaines n'est plus « réglé cette semaine ».
 */
export function stageOf(row: ScanRow, now: Date = new Date()): FunnelStage | null {
    if (row.status === 'PAID') {
        const at = row.latest_response_at ?? row.latest_sent_at;
        if (!at) return null;
        const settledAt = new Date(at);
        if (Number.isNaN(settledAt.getTime())) return null;
        const days = (now.getTime() - settledAt.getTime()) / 86_400_000;
        return days >= 0 && days <= SETTLED_WINDOW_DAYS ? 'settled' : null;
    }
    if (!row.latest_tier) return null;
    for (const [stage, tiers] of Object.entries(STAGE_TIERS)) {
        if (tiers.includes(row.latest_tier)) return stage as FunnelStage;
    }
    return null;
}

/** Agrège un lot de lignes déjà balayées. Séparé de l'accès Supabase pour être testable. */
export function buildFunnel(rows: ScanRow[], counts: Record<FunnelStage, number>, truncated: boolean, now: Date = new Date()): CollectionFunnel {
    const buckets: Record<FunnelStage, ScanRow[]> = { reminder: [], formal: [], authority: [], settled: [] };
    for (const row of rows) {
        const stage = stageOf(row, now);
        if (stage) buckets[stage].push(row);
    }

    const columns = {} as Record<FunnelStage, FunnelColumn>;
    for (const stage of STAGE_SEVERITY) {
        const inStage = [...buckets[stage]].sort((a, b) => b.outstanding_usd - a.outstanding_usd);
        columns[stage] = {
            stage,
            count: counts[stage],
            outstandingUsd: inStage.reduce((sum, r) => sum + r.outstanding_usd, 0),
            previews: inStage.slice(0, PREVIEW_COUNT).map((r) => ({
                transactionId: r.transaction_id,
                debtorName: r.debtor_name ?? '—',
                invoiceRef: r.invoice_ref,
                outstandingUsd: r.outstanding_usd,
                tier: r.latest_tier,
            })),
            others: Math.max(0, counts[stage] - Math.min(PREVIEW_COUNT, inStage.length)),
        };
    }

    // Le dossier prioritaire est le plus lourd de l'étape la plus grave : c'est
    // celui dont l'escalade change le plus la trésorerie de la juridiction.
    let priorityTransactionId: string | null = null;
    for (const stage of STAGE_SEVERITY) {
        if (stage === 'settled') break;
        const top = columns[stage].previews[0];
        if (top) { priorityTransactionId = top.transactionId; break; }
    }

    return {
        columns,
        actionable: counts.reminder + counts.formal + counts.authority,
        truncated,
        priorityTransactionId,
    };
}

function applyFilters<Q extends { eq: (c: string, v: string) => Q; or: (f: string) => Q }>(
    q: Q, f: CollectionAdminFilters,
): Q {
    let out = q;
    if (f.jurisdictionId) out = out.eq('jurisdiction_id', f.jurisdictionId);
    if (f.q) {
        const s = f.q.replace(/[%,()]/g, ' ');
        out = out.or(`invoice_ref.ilike.%${s}%,debtor_name.ilike.%${s}%`);
    }
    return out;
}

/**
 * Construit la file de recouvrement par étape.
 *
 * Ne reprend de `filters` que la juridiction et la recherche : les filtres de
 * palier, de statut et de réponse pilotent la *liste* du bas, pas la file du
 * haut — une file amputée de trois de ses quatre colonnes ne montrerait plus la
 * procédure, qui est justement ce que l'écran doit rendre visible.
 */
export async function loadCollectionFunnel(
    db: Client,
    filters: CollectionAdminFilters,
    now: Date = new Date(),
): Promise<CollectionFunnel> {
    const settledFrom = new Date(now.getTime() - SETTLED_WINDOW_DAYS * 86_400_000).toISOString();

    async function countStage(stage: FunnelStage): Promise<number> {
        let q = db.from('v_collection_admin').select('transaction_id', { count: 'exact', head: true });
        q = applyFilters(q, filters);
        if (stage === 'settled') {
            q = q.eq('status', 'PAID').gte('latest_sent_at', settledFrom);
        } else {
            q = q.in('latest_tier', STAGE_TIERS[stage]).neq('status', 'PAID');
        }
        const { count, error } = await q;
        if (error) throw new Error(`loadCollectionFunnel(${stage}): ${error.message}`);
        return count ?? 0;
    }

    // Colonnes en clair et non via une constante : `select()` n’infère les
    // types que sur un littéral.
    let scan = db.from('v_collection_admin').select(
        'transaction_id, debtor_name, invoice_ref, outstanding_usd, status, latest_tier, latest_sent_at, latest_response_at',
        { count: 'exact' },
    );
    scan = applyFilters(scan, filters);

    const [reminder, formal, authority, settled, scanned] = await Promise.all([
        countStage('reminder'),
        countStage('formal'),
        countStage('authority'),
        countStage('settled'),
        scan.order('outstanding_usd', { ascending: false }).limit(FUNNEL_SCAN_LIMIT),
    ]);

    if (scanned.error) throw new Error(`loadCollectionFunnel(scan): ${scanned.error.message}`);

    const rows = (scanned.data ?? []).map((r): ScanRow => ({
        transaction_id: String(r.transaction_id),
        debtor_name: r.debtor_name,
        invoice_ref: r.invoice_ref,
        outstanding_usd: Number(r.outstanding_usd),
        status: r.status ?? '',
        latest_tier: r.latest_tier,
        latest_sent_at: r.latest_sent_at,
        latest_response_at: r.latest_response_at,
    }));

    return buildFunnel(
        rows,
        { reminder, formal, authority, settled },
        (scanned.count ?? rows.length) > rows.length,
        now,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dossier prioritaire
// ─────────────────────────────────────────────────────────────────────────────

export interface PriorityReminder {
    id: string;
    tier: string;
    sentAt: string;
    responseType: string;
    escalatedBailiff: boolean;
}

export interface PriorityDossier {
    transactionId: string;
    debtorName: string;
    shipownerId: string | null;
    invoiceRef: string | null;
    status: string;
    outstandingUsd: number;
    taxAmountUsd: number;
    jurisdictionName: string | null;
    reminderCount: number;
    manualCount: number;
    latestResponseType: string | null;
    reminders: PriorityReminder[];
    /** L'escalade huissier n'est ouverte qu'après J45 — la rampe est une règle, pas un réglage. */
    canBailiff: boolean;
    /** Le judiciaire n'est ouvert qu'après l'huissier. */
    canJudicial: boolean;
}

/**
 * Charge le dossier mis en avant sous la file : son historique, son exposition
 * et ce que la rampe autorise comme prochain geste.
 *
 * Les deux drapeaux `canBailiff` / `canJudicial` reprennent la garde que
 * `escalateCollection` applique côté serveur. Les recalculer ici sert à griser
 * le bouton plutôt qu'à autoriser quoi que ce soit : le serveur reste seul juge.
 */
export async function loadPriorityDossier(
    db: Client,
    transactionId: string,
): Promise<PriorityDossier | null> {
    const [{ data: row, error: rowError }, { data: rems, error: remError }] = await Promise.all([
        db.from('v_collection_admin').select('*').eq('transaction_id', transactionId).maybeSingle(),
        db.from('collection_reminders')
            .select('id, tier, sent_at, debtor_response_type, escalated_bailiff')
            .eq('transaction_id', transactionId)
            .order('sent_at', { ascending: false }),
    ]);
    if (rowError) throw new Error(`loadPriorityDossier: ${rowError.message}`);
    if (remError) throw new Error(`loadPriorityDossier(reminders): ${remError.message}`);
    if (!row) return null;

    const r = row as Record<string, unknown>;
    const reminders: PriorityReminder[] = ((rems ?? []) as Record<string, unknown>[]).map((x) => ({
        id: String(x.id),
        tier: String(x.tier),
        sentAt: String(x.sent_at),
        responseType: String(x.debtor_response_type ?? 'SILENT'),
        escalatedBailiff: Boolean(x.escalated_bailiff),
    }));
    const tiers = new Set(reminders.map((x) => x.tier));

    return {
        transactionId: String(r.transaction_id),
        debtorName: (r.debtor_name as string | null) ?? '—',
        shipownerId: (r.shipowner_id as string | null) ?? null,
        invoiceRef: (r.invoice_ref as string | null) ?? null,
        status: String(r.status ?? ''),
        outstandingUsd: Number(r.outstanding_usd),
        taxAmountUsd: Number(r.tax_amount_usd),
        jurisdictionName: (r.jurisdiction_name as string | null) ?? null,
        reminderCount: Number(r.reminder_count ?? 0),
        manualCount: Number(r.manual_count ?? 0),
        latestResponseType: (r.latest_response_type as string | null) ?? null,
        reminders,
        canBailiff: tiers.has('J45') && !tiers.has('BAILIFF'),
        canJudicial: tiers.has('BAILIFF') && !tiers.has('JUDICIAL'),
    };
}

