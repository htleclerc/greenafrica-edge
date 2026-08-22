import type { SupabaseClient } from '@supabase/supabase-js';
import type { StatementLine, StatementPayment } from './invoiceService';

export interface OwnerStatementResult {
    openLines: StatementLine[];
    payments: StatementPayment[];
    totalOutstandingUsd: number;
    paymentsInMonthUsd: number;
    openCount: number;
    /** Date d'arrete effective du solde — a reporter sur le document. */
    asOf: Date;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Statuts qui n'ouvrent aucune creance : une pro-forma annulee, exemptee ou
 * remplacee par un avoir ne se reclame pas. Tout le reste est du — une
 * contestation est une demande, pas une extinction. Meme regle que la vue
 * `v_transaction_outstanding` (migration 132) : les ecrans, la base et le
 * document ne doivent pas repondre trois chiffres differents.
 */
const NON_CLAIMABLE = ['VOID', 'EXEMPT', 'CREDIT_NOTE_ISSUED'];

/** Bornes du mois écoulé : [1er du mois précédent, 1er du mois courant) + libellé. */
export function periodBounds(now: Date): { periodStart: Date; periodEnd: Date; label: string } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const periodEnd = new Date(Date.UTC(y, m, 1));
    const periodStart = new Date(Date.UTC(y, m - 1, 1));
    const label = `${MONTHS[periodStart.getUTCMonth()]} ${periodStart.getUTCFullYear()}`;
    return { periodStart, periodEnd, label };
}

/**
 * Bornes du mois EN COURS : [1er du mois, maintenant]. Pour un récap envoyé à la
 * demande. `periodBounds` vise le mois écoulé et reste réservé au cron mensuel.
 */
export function currentMonthBounds(now: Date): { periodStart: Date; periodEnd: Date; label: string } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const periodStart = new Date(Date.UTC(y, m, 1));
    return { periodStart, periodEnd: new Date(now.getTime()), label: `${MONTHS[m]} ${y}` };
}

/** statements/<shipownerId>/<YYYY-MM>.pdf */
export function statementStoragePath(shipownerId: string, periodStart: Date): string {
    const ym = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}`;
    return `statements/${shipownerId}/${ym}.pdf`;
}

function ageDays(createdAtIso: string, asOf: Date): number {
    return Math.max(0, Math.floor((asOf.getTime() - new Date(createdAtIso).getTime()) / 86_400_000));
}

export interface ComposeInput {
    shipownerId: string;
    /** Bornes de la SECTION paiements du document (le mois couvert). */
    periodStart: Date;
    periodEnd: Date;
    now: Date;
    /**
     * Date d'arrete du SOLDE. Par defaut `now`.
     *
     * C'est ce qui rend un consolide reproductible : le solde au 31 juillet se
     * recalcule a l'identique en septembre, parce qu'il ne depend que de faits
     * dates — la facture existait (`created_at`), le paiement etait encaisse
     * (`confirmed_at`). Le STATUT courant d'une facture, lui, ne dit rien de ce
     * qu'elle valait a une date passee : s'y fier rendait le document
     * irreproductible.
     */
    asOf?: Date;
    /** Restreint le consolide a un seul navire. */
    vesselId?: string;
}

/**
 * Compose les données du relevé : pro-formas encore dues à la date d'arrêté +
 * paiements confirmés de la période.
 *
 * Le reste dû se calcule `tax_amount_usd - paiements CONFIRMED anterieurs a
 * l'arrete`, JAMAIS `tax_amount_usd - partial_paid_usd` : cette colonne est
 * gelee par la migration 089 et n'est jamais ecrite, si bien que l'ancien
 * calcul reclamait le montant plein d'une facture deja reglee en partie.
 */
export async function composeOwnerStatement(
    admin: SupabaseClient,
    input: ComposeInput,
): Promise<OwnerStatementResult> {
    const asOf = input.asOf ?? input.now;

    let q = admin
        .from('transactions')
        .select('id, invoice_ref, vessel_name, created_at, tax_amount_usd, status')
        .eq('document_type', 'PROFORMA')
        .eq('shipowner_id', input.shipownerId)
        .not('status', 'in', `(${NON_CLAIMABLE.join(',')})`)
        .lte('created_at', asOf.toISOString());
    if (input.vesselId) q = q.eq('vessel_id', input.vesselId);
    const { data: txRaw } = await q;

    const txns = (txRaw ?? []) as Record<string, unknown>[];

    // Encaissements confirmes AVANT l'arrete, par facture.
    const paidByTxn = new Map<string, number>();
    if (txns.length > 0) {
        const { data: payRaw } = await admin
            .from('payments')
            .select('transaction_id, amount_usd_minor')
            .in('transaction_id', txns.map((t) => String(t.id)))
            .eq('status', 'CONFIRMED')
            .lte('confirmed_at', asOf.toISOString());
        for (const r of (payRaw ?? []) as Record<string, unknown>[]) {
            const id = String(r.transaction_id ?? '');
            if (!id) continue;
            paidByTxn.set(id, (paidByTxn.get(id) ?? 0) + Number(r.amount_usd_minor ?? 0) / 100);
        }
    }

    const openLines: StatementLine[] = [];
    for (const r of txns) {
        const id = String(r.id ?? '');
        const outstanding = Number(r.tax_amount_usd ?? 0) - (paidByTxn.get(id) ?? 0);
        // Le centime de tolerance evite qu'un arrondi de conversion fasse
        // figurer une facture soldee dans un relevé.
        if (outstanding <= 0.005) continue;
        openLines.push({
            transactionId: id,
            invoiceRef: String(r.invoice_ref ?? '—'),
            vesselName: String(r.vessel_name ?? ''),
            issuedAt: String(r.created_at).slice(0, 10),
            ageDays: ageDays(String(r.created_at), asOf),
            outstandingUsd: outstanding,
        });
    }
    openLines.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
    const totalOutstandingUsd = openLines.reduce((s, l) => s + l.outstandingUsd, 0);

    const { data: payPeriodRaw } = await admin
        .from('payments')
        .select('confirmed_at, receipt_ref, amount_usd_minor')
        .eq('shipowner_id', input.shipownerId)
        .eq('status', 'CONFIRMED')
        .gte('confirmed_at', input.periodStart.toISOString())
        .lt('confirmed_at', input.periodEnd.toISOString());
    const payments: StatementPayment[] = ((payPeriodRaw ?? []) as Record<string, unknown>[]).map((r) => ({
        confirmedAt: String(r.confirmed_at),
        receiptRef: (r.receipt_ref as string | null) ?? null,
        amountUsd: Number(r.amount_usd_minor) / 100,
    }));
    const paymentsInMonthUsd = payments.reduce((s, p) => s + p.amountUsd, 0);

    return {
        openLines, payments, totalOutstandingUsd, paymentsInMonthUsd,
        openCount: openLines.length, asOf,
    };
}
