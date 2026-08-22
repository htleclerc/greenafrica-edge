import type { SupabaseClient } from '@supabase/supabase-js';
import { confirmedPaidUsdByTransaction } from '@/services/confirmedPayments';

/**
 * Niveau d'urgence d'une ligne de file de travail.
 *
 * C'est la refonte en un mot : l'armateur ouvre l'application et voit ce qu'il
 * doit payer, ordonné par ce qui presse. Les trois niveaux portent les trois
 * accents et les trois formes de bouton — une seule action pleine par écran,
 * sur la ligne la plus urgente.
 */
export type WorkUrgency = 'overdue' | 'dueSoon' | 'upcoming';

/** Une échéance à moins de deux semaines est « proche » : c'est le délai de virement. */
export const DUE_SOON_DAYS = 14;

/** Statuts d'une facture encore due. Alignés sur REMINDABLE_STATUSES côté recouvrement. */
export const OPEN_STATUSES = ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] as const;

export interface WorkItem {
    transactionId: string;
    invoiceRef: string | null;
    vesselName: string | null;
    documentType: string | null;
    dueDate: string | null;
    /** Jours avant l'échéance. Négatif si dépassée, `null` si aucune échéance. */
    daysToDue: number | null;
    /** Reste dû, pénalités et acomptes déduits. */
    amountUsd: number;
    urgency: WorkUrgency;
}

export interface OwnerOverview {
    queue: WorkItem[];
    outstandingUsd: number;
    openCount: number;
    activeVessels: number;
    paidYtdUsd: number;
    walletBalanceUsd: number;
}

/** Jours pleins avant l'échéance ; négatif quand elle est passée. */
export function daysToDue(dueDate: string | null, now: Date = new Date()): number | null {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return null;
    return Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
}

export function urgencyOf(days: number | null): WorkUrgency {
    if (days === null) return 'upcoming';
    if (days < 0) return 'overdue';
    return days <= DUE_SOON_DAYS ? 'dueSoon' : 'upcoming';
}

/**
 * Ordonne la file : le plus en retard d'abord, puis le plus proche de l'échéance.
 *
 * Les factures sans échéance ferment la marche, classées par montant : on ne
 * peut rien dire de leur urgence, seulement de leur poids.
 */
export function sortWorkQueue(items: WorkItem[]): WorkItem[] {
    return [...items].sort((a, b) => {
        if (a.daysToDue === null && b.daysToDue === null) return b.amountUsd - a.amountUsd;
        if (a.daysToDue === null) return 1;
        if (b.daysToDue === null) return -1;
        return a.daysToDue - b.daysToDue;
    });
}

interface RawTxn {
    id: string;
    invoice_ref: string | null;
    vessel_name: string | null;
    document_type: string | null;
    tax_amount_usd: number | string | null;
    /** Gelee par la mig 089, jamais ecrite : vaut zero sur toute facture en cours. */
    partial_paid_usd: number | string | null;
    /** Encaisse reel, lu dans les paiements CONFIRMED (services/confirmedPayments). */
    confirmed_paid_usd?: number | null;
    due_date: string | null;
    status: string;
}

/** Construit la file à partir des factures ouvertes. Séparé de l'accès Supabase pour être testable. */
export function buildWorkQueue(rows: RawTxn[], now: Date = new Date()): WorkItem[] {
    const items = rows.map((r): WorkItem => {
        const days = daysToDue(r.due_date, now);
        // Le reste dû, pas le montant facturé : un paiement partiel a déjà
        // réduit ce que l'armateur doit sortir, et c'est ce chiffre qu'il
        // reconnaît sur son relevé. L'encaissement se lit dans les paiements
        // CONFIRMED — `partial_paid_usd` est gelée par la mig 089 et vaut zéro
        // sur toute facture en cours.
        const paid = Math.max(Number(r.partial_paid_usd ?? 0), Number(r.confirmed_paid_usd ?? 0));
        const outstanding = Number(r.tax_amount_usd ?? 0) - paid;
        return {
            transactionId: r.id,
            invoiceRef: r.invoice_ref,
            vesselName: r.vessel_name,
            documentType: r.document_type,
            dueDate: r.due_date,
            daysToDue: days,
            amountUsd: outstanding,
            urgency: urgencyOf(days),
        };
    });
    return sortWorkQueue(items.filter((i) => i.amountUsd > 0));
}

/**
 * Vue d'ensemble de l'armateur : la file de travail et les agrégats de contexte.
 *
 * Un seul chargement, pas quatre : la page ne doit pas se peupler par morceaux
 * sous les yeux de l'armateur. Toutes les requêtes passent par le client du
 * principal, donc bornées par RLS à son propre périmètre.
 */
export async function getOwnerOverview(
    db: SupabaseClient,
    shipownerId: string,
    now: Date = new Date(),
): Promise<OwnerOverview> {
    const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();

    const [openRes, vesselsRes, paidRes, walletRes] = await Promise.all([
        db.from('transactions')
            .select('id, invoice_ref, vessel_name, document_type, tax_amount_usd, partial_paid_usd, due_date, status')
            .in('status', OPEN_STATUSES)
            .order('due_date', { ascending: true, nullsFirst: false })
            .limit(100),
        db.from('vessels').select('id', { count: 'exact', head: true }),
        db.from('transactions')
            .select('tax_amount_usd')
            .eq('status', 'PAID')
            .gte('paid_at', startOfYear),
        db.from('wallets')
            .select('balance_usd_minor')
            .eq('shipowner_id', shipownerId)
            .maybeSingle(),
    ]);

    const open = (openRes.data ?? []) as RawTxn[];
    // Un seul aller-retour pour l'encaissement de toutes les factures ouvertes.
    const paidByTxn = await confirmedPaidUsdByTransaction(db, open.map((r) => r.id));
    for (const r of open) r.confirmed_paid_usd = paidByTxn.get(r.id) ?? 0;

    const queue = buildWorkQueue(open, now);

    return {
        queue,
        outstandingUsd: queue.reduce((sum, i) => sum + i.amountUsd, 0),
        openCount: queue.length,
        activeVessels: vesselsRes.count ?? 0,
        paidYtdUsd: ((paidRes.data ?? []) as { tax_amount_usd: number | string | null }[])
            .reduce((sum, r) => sum + Number(r.tax_amount_usd ?? 0), 0),
        // Les soldes de portefeuille sont stockés en centimes — les additionner
        // en dollars flottants ferait dériver le solde affiché.
        walletBalanceUsd: ((walletRes.data?.balance_usd_minor as number | null) ?? 0) / 100,
    };
}

/**
 * Scinde la file entre le dossier qui mérite la bande d'action et le reste.
 *
 * Un seul dossier peut la porter, et seulement s'il est réellement en retard :
 * la bande sort le nombre de jours en 44 px, ce qui n'a de sens qu'une fois
 * l'échéance dépassée. Comme la file est triée par urgence, le candidat ne peut
 * être que sa tête — si elle n'est pas en retard, personne ne la porte, et
 * l'écran retombe sur trois lignes égales.
 */
export function splitActionBand(queue: WorkItem[]): { band: WorkItem | null; rows: WorkItem[] } {
    const [head, ...rest] = queue;
    return head?.urgency === 'overdue'
        ? { band: head, rows: rest }
        : { band: null, rows: queue };
}
