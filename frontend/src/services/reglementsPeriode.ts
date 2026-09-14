import type { SupabaseClient } from '@supabase/supabase-js';

// Les vues de recouvrement ne sont pas dans supabase.generated.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export type ReglementPeriod = 'week' | 'month' | 'year';

export const REGLEMENT_PERIODS: readonly ReglementPeriod[] = ['week', 'month', 'year'];

export function isReglementPeriod(value: string | undefined): value is ReglementPeriod {
    return value === 'week' || value === 'month' || value === 'year';
}

/**
 * Début de la période, en UTC.
 *
 * Fenêtres CALENDAIRES, pas glissantes : « cette semaine » commence lundi, pas
 * il y a sept jours. C'est ce que calcule déjà `date_trunc` dans
 * `v_reglements_dashboard` (mig 121) ; diverger ici ferait dire deux choses
 * différentes à deux blocs du même écran.
 *
 * Pas de borne haute : la fenêtre court jusqu'à maintenant, exactement comme
 * le `created_at >= date_trunc(...)` de la vue.
 */
export function reglementPeriodStart(period: ReglementPeriod, now: Date): Date {
    const y = now.getUTCFullYear();
    if (period === 'year') return new Date(Date.UTC(y, 0, 1));
    if (period === 'month') return new Date(Date.UTC(y, now.getUTCMonth(), 1));
    // Semaine ISO : lundi. getUTCDay() rend 0 le dimanche, d'où le décalage.
    const day = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate()));
    const mondayOffset = (day.getUTCDay() + 6) % 7;
    day.setUTCDate(day.getUTCDate() - mondayOffset);
    return day;
}

export interface ReglementPeriodeResult {
    period: ReglementPeriod;
    startIso: string;
    /**
     * La cohorte : les factures ÉMISES sur la période.
     * `enAttenteUsd` = `duUsd` − `encaisseUsd`, la formule demandée.
     */
    cohorte: { duUsd: number; encaisseUsd: number; enAttenteUsd: number; invoiceCount: number };
    /** La trésorerie : l'argent ARRIVÉ sur la période, quelle que soit la date de facture. */
    tresorerie: { usd: number; count: number };
}

interface OutstandingRow {
    tax_amount_usd: number | string;
    paid_usd: number | string;
    outstanding_usd: number | string;
    is_claimable: boolean;
}

/**
 * Deux lectures d'une même période, pilotées par le même filtre.
 *
 * La COHORTE répond « ce qui a été facturé sur la période, et ce qu'il en
 * reste » ; la TRÉSORERIE répond « combien d'argent est rentré ». Les deux
 * diffèrent — un règlement de septembre sur une facture de juillet compte dans
 * la seconde, jamais dans la première — et les confondre donnerait une image
 * fausse du recouvrement.
 *
 * L'encours n'est jamais recalculé : il vient de `v_transaction_outstanding`
 * (mig 132/134/159), source unique, parce que `transactions.partial_paid_usd`
 * est gelée et vaut zéro sur toute facture en cours.
 */
export async function getReglementsPeriode(
    db: Client,
    period: ReglementPeriod,
    now: Date = new Date(),
): Promise<ReglementPeriodeResult> {
    const startIso = reglementPeriodStart(period, now).toISOString();

    const [cohortRes, cashRes] = await Promise.all([
        db.from('v_transaction_outstanding')
            .select('tax_amount_usd, paid_usd, outstanding_usd, is_claimable')
            .eq('document_type', 'PROFORMA')
            .eq('mode', 'MARITIME')
            .gte('created_at', startIso),
        db.from('payments')
            .select('amount_usd_minor, transactions!inner(document_type, mode)')
            .eq('status', 'CONFIRMED')
            .gte('confirmed_at', startIso)
            .eq('transactions.document_type', 'PROFORMA')
            .eq('transactions.mode', 'MARITIME'),
    ]);

    if (cohortRes.error) throw new Error(`getReglementsPeriode (cohorte): ${cohortRes.error.message}`);
    if (cashRes.error) throw new Error(`getReglementsPeriode (tresorerie): ${cashRes.error.message}`);

    let duUsd = 0, encaisseUsd = 0, enAttenteUsd = 0, invoiceCount = 0;
    for (const r of (cohortRes.data ?? []) as OutstandingRow[]) {
        // Une facture annulée ou exonérée n'est pas une créance : elle sort du
        // facturé et de l'encaissé. L'encours, lui, vaut déjà zéro dans la vue
        // pour ces statuts — le refiltrer masquerait un trop-perçu.
        if (r.is_claimable === true) {
            duUsd += Number(r.tax_amount_usd ?? 0);
            encaisseUsd += Number(r.paid_usd ?? 0);
            invoiceCount += 1;
        }
        enAttenteUsd += Number(r.outstanding_usd ?? 0);
    }

    const cash = (cashRes.data ?? []) as { amount_usd_minor: number | string }[];

    return {
        period,
        startIso,
        cohorte: { duUsd, encaisseUsd, enAttenteUsd, invoiceCount },
        tresorerie: {
            usd: cash.reduce((s, p) => s + Number(p.amount_usd_minor ?? 0), 0) / 100,
            count: cash.length,
        },
    };
}
