// Reusable server component for the operator invoices view.
// Used by /owner/invoices (via thin wrapper) and /dashboard/invoices when the
// principal is an operator. Always fetches via principal.supabase (RLS-scoped).
// Preserves the PayDialog owner flow (3-step wizard) and ?stripe= banners.

import { getTranslations } from 'next-intl/server';
import type { Principal } from '@/lib/auth/requirePrincipal';
import { signInvoiceRef } from '@/services/invoiceService';
import { InvoicesTable, type InvoiceRow } from '@/components/owner/invoices/InvoicesTable';

interface RawTxn {
    id: string;
    invoice_ref: string | null;
    content_hash: string | null;
    document_type: 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND' | null;
    vessel_name: string;
    tax_amount_usd: number;
    status: string;
    paid_at: string | null;
    created_at: string;
}

function buildDownloadUrl(ref: string, contentHash: string): string {
    const sig = signInvoiceRef(ref, contentHash);
    return `/api/invoices/${encodeURIComponent(ref)}/download?h=${contentHash}&s=${sig}`;
}

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
    stripeReturn?: 'success' | 'cancel' | null;
}

export async function OperatorInvoicesPage({ principal, stripeReturn = null }: Props) {
    const t = await getTranslations('OwnerPortal.invoices');

    const [txnRes, walletRes, receiptRes, pendingWireRes] = await Promise.all([
        principal.supabase
            .from('transactions')
            .select(
                'id, invoice_ref, content_hash, document_type, vessel_name, tax_amount_usd, status, paid_at, created_at',
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
        // Pending WIRE payments — owner can still attach/replace proofs.
        principal.supabase
            .from('payments')
            .select('id, transaction_id')
            .eq('shipowner_id', principal.shipowner.id)
            .eq('rail', 'WIRE_TRANSFER')
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

    const pendingWireByTxn = new Map<string, string>(); // transaction_id → payment_id
    for (const p of (pendingWireRes.data ?? []) as {
        id: string;
        transaction_id: string;
    }[]) {
        pendingWireByTxn.set(p.transaction_id, p.id);
    }

    const rows: InvoiceRow[] = txns.map((txn) => ({
        ...txn,
        download_url:
            txn.invoice_ref && txn.content_hash
                ? buildDownloadUrl(txn.invoice_ref, txn.content_hash)
                : null,
        receipt_ref: receiptByTxn.get(txn.id) ?? null,
        pending_wire_payment_id: pendingWireByTxn.get(txn.id) ?? null,
    }));

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">
                    Invoices
                </h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">
                    Pro-formas, final assessments, complements and refunds for your fleet.
                </p>
            </header>

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

            {txnRes.error ? (
                <div className="os-card p-4 text-sm" style={{ color: '#FCA5A5' }}>
                    Failed to load invoices: {txnRes.error.message}
                </div>
            ) : (
                <InvoicesTable
                    rows={rows}
                    walletBalanceUsdMinor={walletBalanceUsdMinor}
                />
            )}
        </div>
    );
}
