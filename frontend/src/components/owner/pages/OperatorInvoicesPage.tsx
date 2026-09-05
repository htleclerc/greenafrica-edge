// Reusable server component for the operator invoices view.
// Used by /owner/invoices (via thin wrapper) and /dashboard/invoices when the
// principal is an operator. Always fetches via principal.supabase (RLS-scoped).
// Preserves the PayDialog owner flow (3-step wizard) and ?stripe= / ?paypal= banners.

import { getTranslations } from 'next-intl/server';
import type { Principal } from '@/lib/auth/requirePrincipal';
import { buildInvoiceDownloadUrl } from '@/services/invoiceDownloadLink';
import { InvoicesTable, type InvoiceRow } from '@/components/owner/invoices/InvoicesTable';
import { confirmedPaidUsdByTransaction } from '@/services/confirmedPayments';
import { RAILS_REQUIRING_PROOF } from '@/lib/payments/proofRequirement';
import { StatementDownload } from '@/components/owner/StatementDownload';

interface RawTxn {
    id: string;
    invoice_ref: string | null;
    content_hash: string | null;
    invoice_pdf_url: string | null;
    document_type: 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND' | null;
    vessel_name: string;
    tax_amount_usd: number;
    status: string;
    paid_at: string | null;
    created_at: string;
    // Le panneau de détail montre la décomposition émissions × tarif, pas le
    // seul montant : c'est elle qui rend la facture contestable ou acceptable.
    due_date: string | null;
    partial_paid_usd: number | null;
    emissions_tco2: number | null;
    breakdown_json: unknown;
}

/**
 * Issues possibles d'un retour PayPal. Quatre valeurs, contre deux pour Stripe :
 * la capture PayPal est un appel explicite, elle peut rester en attente (filet
 * webhook/cron) ou échouer sans qu'aucun montant n'ait été prélevé.
 */
export const PAYPAL_RETURNS = ['success', 'cancel', 'pending', 'failed'] as const;
export type PaypalReturn = typeof PAYPAL_RETURNS[number];

/**
 * Teintes des bannières de retour PayPal, alignées sur celles de Stripe :
 * vert = encaissé, ambre = en attente ou annulé, rouge = échec.
 */
const PAYPAL_BANNER_STYLE: Record<PaypalReturn, string> = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    cancel: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    pending: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    failed: 'border-red-500/30 bg-red-500/10 text-red-200',
};

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
    stripeReturn?: 'success' | 'cancel' | null;
    paypalReturn?: PaypalReturn | null;
}

export async function OperatorInvoicesPage({
    principal,
    stripeReturn = null,
    paypalReturn = null,
}: Props) {
    const t = await getTranslations('OwnerPortal.invoices');

    const [txnRes, walletRes, receiptRes, pendingWireRes] = await Promise.all([
        principal.supabase
            .from('transactions')
            .select(
                // Chaîne littérale d'un seul tenant : PostgREST infère le type
                // des lignes depuis ce littéral, une concaténation le lui retire.
                'id, invoice_ref, content_hash, invoice_pdf_url, document_type, vessel_name, tax_amount_usd, status, paid_at, created_at, due_date, partial_paid_usd, emissions_tco2, breakdown_json',
            )
            .order('created_at', { ascending: false })
            .limit(200),
        // Wallet balance for this shipowner (may not exist yet → maybeSingle).
        principal.supabase
            .from('wallets')
            .select('balance_usd_minor')
            .eq('shipowner_id', principal.shipowner.id)
            .maybeSingle(),
        // Confirmed payments with receipts, scoped to this shipowner via RLS
        // (mig 058 payments_owner_select). Order ascending so latest wins when
        // we build the per-transaction map below.
        principal.supabase
            .from('payments')
            .select('transaction_id, receipt_ref, confirmed_at')
            .eq('shipowner_id', principal.shipowner.id)
            .eq('status', 'CONFIRMED')
            .not('receipt_ref', 'is', null)
            .order('confirmed_at', { ascending: true }),
        // Paiements DECLARES encore en attente de rapprochement. Tous les rails
        // declaratifs, pas seulement le virement : le mobile money et le
        // paiement par un tiers appellent la meme piece justificative.
        principal.supabase
            .from('payments')
            .select('id, transaction_id')
            .eq('shipowner_id', principal.shipowner.id)
            .in('rail', RAILS_REQUIRING_PROOF)
            .in('status', ['INITIATED', 'PROCESSING'])
            .not('transaction_id', 'is', null),
    ]);

    const walletBalanceUsdMinor =
        (walletRes.data?.balance_usd_minor as number | null) ?? 0;

    const txns: RawTxn[] = (txnRes.data ?? []) as RawTxn[];

    // Map transaction_id → receipt_ref (latest wins because the query is
    // ordered ascending by confirmed_at, so subsequent assignments overwrite).
    const receiptByTxn = new Map<string, string>();
    for (const p of (receiptRes.data ?? []) as {
        transaction_id: string;
        receipt_ref: string | null;
    }[]) {
        if (p.receipt_ref) {
            receiptByTxn.set(p.transaction_id, p.receipt_ref);
        }
    }

    const pendingByTxn = new Map<string, string>(); // transaction_id → payment_id
    for (const p of (pendingWireRes.data ?? []) as {
        id: string;
        transaction_id: string;
    }[]) {
        pendingByTxn.set(p.transaction_id, p.id);
    }

    // Quels de ces paiements portent DEJA une piece ? La distinction change le
    // sens du geste offert a l'armateur : completer une declaration
    // incomplete, ou revoir une piece deja fournie. Les confondre laissait
    // l'ecran reclamer un justificatif sans jamais dire s'il en manquait un.
    const paymentIds = [...pendingByTxn.values()];
    const provenPayments = new Set<string>();
    if (paymentIds.length > 0) {
        const { data: proofRows } = await principal.supabase
            .from('payment_proofs')
            .select('payment_id')
            .in('payment_id', paymentIds);
        for (const r of (proofRows ?? []) as { payment_id: string }[]) {
            provenPayments.add(r.payment_id);
        }
    }

    // Ce qui a ete encaisse se lit dans `payments`, jamais dans
    // `partial_paid_usd` : cette colonne est gelee par la migration 089 et vaut
    // zero sur toute facture en cours, si bien que l'armateur voyait reclamer
    // le montant plein d'une facture qu'il avait deja reglee en partie.
    const confirmedPaidByTxn = await confirmedPaidUsdByTransaction(
        principal.supabase,
        txns.map((t) => t.id),
    );

    const rows: InvoiceRow[] = txns.map((txn) => ({
        ...txn,
        download_url: buildInvoiceDownloadUrl(txn),
        receipt_ref: receiptByTxn.get(txn.id) ?? null,
        pending_declared_payment_id: pendingByTxn.get(txn.id) ?? null,
        pending_payment_has_proof: provenPayments.has(pendingByTxn.get(txn.id) ?? ''),
        confirmed_paid_usd: confirmedPaidByTxn.get(txn.id) ?? 0,
    }));

    const { data: statementsRaw } = await principal.supabase
        .from('owner_statements')
        .select('id, period_month, total_outstanding_usd, generated_at')
        .order('period_month', { ascending: false })
        .limit(24);
    const statements = (statementsRaw ?? []) as {
        id: string; period_month: string; total_outstanding_usd: number; generated_at: string;
    }[];

    return (
        <div className="mx-auto flex max-w-6xl flex-col gap-[18px] p-4 sm:p-6">
            {stripeReturn === 'success' && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 mb-4 text-sm text-emerald-200">
                    {t('stripeReturn.success')}
                </div>
            )}
            {stripeReturn === 'cancel' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 mb-4 text-sm text-amber-200">
                    {t('stripeReturn.cancel')}
                </div>
            )}
            {paypalReturn && (
                <div className={`rounded-xl border p-3 mb-4 text-sm ${PAYPAL_BANNER_STYLE[paypalReturn]}`}>
                    {t(`paypalReturn.${paypalReturn}`)}
                </div>
            )}

            {txnRes.error ? (
                <div className="os-card p-4 text-sm" style={{ color: '#FCA5A5' }}>
                    Failed to load invoices: {txnRes.error.message}
                </div>
            ) : (
                <InvoicesTable
                    rows={rows}
                    walletBalanceUsdMinor={walletBalanceUsdMinor}
                    privileges={principal.privileges}
                    isMember={principal.isMember}
                />
            )}

            <div className="mt-8">
                <StatementDownload />
            </div>

            {statements.length > 0 && (
                <section>
                    <h2 className="text-lg font-semibold text-[var(--os-text-primary)] mb-3">{t('statements_title')}</h2>
                    <div className="os-card divide-y divide-[var(--os-border)]">
                        {statements.map((s) => (
                            <div key={s.id} className="flex items-center justify-between px-4 py-3">
                                <span className="text-sm text-[var(--os-text-primary)]">{s.period_month.slice(0, 7)}</span>
                                <span className="text-sm font-mono tabular-nums text-[var(--os-text-secondary)]">${Number(s.total_outstanding_usd).toLocaleString()}</span>
                                <a href={`/api/owner/statements/${s.period_month.slice(0, 7)}/download`} target="_blank" rel="noopener noreferrer"
                                   className="text-xs text-emerald-400 hover:underline">{t('statements_download')}</a>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
