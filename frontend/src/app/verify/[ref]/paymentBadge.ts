import { CheckCircle2, Clock, AlertTriangle, Shield, XCircle } from 'lucide-react';

/**
 * Statuts de `transaction_status`. La page n'en connaissait que cinq ; la
 * rebascule du livre du 19/08/2026 (mig 128) fait apparaître VOID sur les
 * pro-formas du seed annulées au profit des factures réellement envoyées.
 */
export type VerifyStatus =
    | 'PAID' | 'PENDING' | 'PARTIALLY_PAID' | 'OVERDUE'
    | 'EXEMPT' | 'DISPUTED' | 'CREDIT_NOTE_ISSUED' | 'VOID';

export interface PaymentBadge {
    label: string;
    color: string;
    bg: string;
    Icon: typeof CheckCircle2;
}

/**
 * Associe (type de document, statut) à une pastille lisible par le vérificateur.
 *
 * Pour une pro-forma, la pastille dit ce que l'agent doit faire :
 *   PENDING → « To Pay », OVERDUE → « Overdue », PAID → « Paid in Advance ».
 * Pour un reçu (FINAL/COMPLEMENT), elle dit l'état du règlement :
 *   PAID → « Paid », PENDING → « Unpaid », OVERDUE → « In Default of Payment ».
 * Un remboursement n'a pas d'état de paiement — l'appelant saute la pastille.
 *
 * VOID et CREDIT_NOTE_ISSUED sont traités AVANT le repli sur PENDING. Sans
 * cette branche, le repli `status ?? 'PENDING'` faisait afficher « To Pay »
 * sur une facture annulée : on annonçait à un vérificateur qu'une créance
 * éteinte restait exigible.
 */
export function paymentBadge(
    descriptor: { kind: 'proforma' | 'receipt' | 'refund' },
    status: VerifyStatus | undefined,
): PaymentBadge | null {
    if (descriptor.kind === 'refund') return null;
    const s = status ?? 'PENDING';

    if (s === 'VOID' || s === 'CREDIT_NOTE_ISSUED') {
        return { label: 'Cancelled', color: '#64748B', bg: 'rgba(100,116,139,0.1)', Icon: XCircle };
    }
    if (s === 'EXEMPT') {
        return { label: 'Exempt', color: '#0EA5E9', bg: 'rgba(14,165,233,0.1)', Icon: Shield };
    }
    if (s === 'DISPUTED') {
        return { label: 'Disputed', color: '#F97316', bg: 'rgba(249,115,22,0.1)', Icon: AlertTriangle };
    }

    if (descriptor.kind === 'receipt') {
        if (s === 'PAID')    return { label: 'Paid',                  color: '#10B981', bg: 'rgba(16,185,129,0.1)', Icon: CheckCircle2 };
        if (s === 'OVERDUE') return { label: 'In Default of Payment', color: '#DC2626', bg: 'rgba(220,38,38,0.1)',  Icon: AlertTriangle };
        return                       { label: 'Unpaid',               color: '#EAB308', bg: 'rgba(234,179,8,0.1)',  Icon: Clock };
    }

    // pro-forma
    if (s === 'PAID')    return { label: 'Paid in Advance', color: '#10B981', bg: 'rgba(16,185,129,0.1)', Icon: CheckCircle2 };
    if (s === 'OVERDUE') return { label: 'Overdue',         color: '#DC2626', bg: 'rgba(220,38,38,0.1)',  Icon: AlertTriangle };
    return                       { label: 'To Pay',         color: '#EAB308', bg: 'rgba(234,179,8,0.1)',  Icon: Clock };
}
