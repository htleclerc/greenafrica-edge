import type { SupabaseClient } from '@supabase/supabase-js';
import type { StatementLine, StatementPayment } from './invoiceService';

export interface OwnerStatementResult {
    openLines: StatementLine[];
    payments: StatementPayment[];
    totalOutstandingUsd: number;
    paymentsInMonthUsd: number;
    openCount: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/** Bornes du mois écoulé : [1er du mois précédent, 1er du mois courant) + libellé. */
export function periodBounds(now: Date): { periodStart: Date; periodEnd: Date; label: string } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const periodEnd = new Date(Date.UTC(y, m, 1));
    const periodStart = new Date(Date.UTC(y, m - 1, 1));
    const label = `${MONTHS[periodStart.getUTCMonth()]} ${periodStart.getUTCFullYear()}`;
    return { periodStart, periodEnd, label };
}

/** statements/<shipownerId>/<YYYY-MM>.pdf */
export function statementStoragePath(shipownerId: string, periodStart: Date): string {
    const ym = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}`;
    return `statements/${shipownerId}/${ym}.pdf`;
}

function ageDays(createdAtIso: string, now: Date): number {
    return Math.max(0, Math.floor((now.getTime() - new Date(createdAtIso).getTime()) / 86_400_000));
}

export interface ComposeInput {
    shipownerId: string; periodStart: Date; periodEnd: Date; now: Date;
}

/**
 * Compose les données du relevé : pro-formas ouvertes (PENDING, OVERDUE,
 * PARTIALLY_PAID) + paiements confirmés du mois.
 */
export async function composeOwnerStatement(
    admin: SupabaseClient,
    input: ComposeInput,
): Promise<OwnerStatementResult> {
    const { data: txRaw } = await admin
        .from('transactions')
        .select('invoice_ref, vessel_name, created_at, tax_amount_usd, partial_paid_usd')
        .eq('document_type', 'PROFORMA')
        .eq('shipowner_id', input.shipownerId)
        .in('status', ['PENDING', 'OVERDUE', 'PARTIALLY_PAID']);
    const openLines: StatementLine[] = ((txRaw ?? []) as Record<string, unknown>[]).map((r) => {
        const outstanding = Number(r.tax_amount_usd) - Number(r.partial_paid_usd ?? 0);
        return {
            invoiceRef: String(r.invoice_ref ?? '—'),
            vesselName: String(r.vessel_name ?? ''),
            issuedAt: String(r.created_at).slice(0, 10),
            ageDays: ageDays(String(r.created_at), input.now),
            outstandingUsd: outstanding,
        };
    });
    const totalOutstandingUsd = openLines.reduce((s, l) => s + l.outstandingUsd, 0);

    const { data: payRaw } = await admin
        .from('payments')
        .select('confirmed_at, receipt_ref, amount_usd_minor')
        .eq('shipowner_id', input.shipownerId)
        .eq('status', 'CONFIRMED')
        .gte('confirmed_at', input.periodStart.toISOString())
        .lt('confirmed_at', input.periodEnd.toISOString());
    const payments: StatementPayment[] = ((payRaw ?? []) as Record<string, unknown>[]).map((r) => ({
        confirmedAt: String(r.confirmed_at),
        receiptRef: (r.receipt_ref as string | null) ?? null,
        amountUsd: Number(r.amount_usd_minor) / 100,
    }));
    const paymentsInMonthUsd = payments.reduce((s, p) => s + p.amountUsd, 0);

    return { openLines, payments, totalOutstandingUsd, paymentsInMonthUsd, openCount: openLines.length };
}
