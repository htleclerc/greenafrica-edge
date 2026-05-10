import { requireOwner } from '@/lib/auth/requireOwner';
import { signInvoiceRef } from '@/services/invoiceService';
import { InvoicesTable, type InvoiceRow } from './InvoicesTable';

export const metadata = {
    title: 'Owner portal — invoices',
};

export const dynamic = 'force-dynamic';

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

export default async function OwnerInvoicesPage() {
    const session = await requireOwner();

    const [txnRes, walletRes, receiptRes] = await Promise.all([
        session.supabase
            .from('transactions')
            .select(
                'id, invoice_ref, content_hash, document_type, vessel_name, tax_amount_usd, status, paid_at, created_at',
            )
            .order('created_at', { ascending: false })
            .limit(200),
        // Wallet balance for this shipowner (may not exist yet → maybeSingle).
        session.supabase
            .from('wallets')
            .select('balance_usd_minor')
            .eq('shipowner_id', session.shipowner.id)
            .maybeSingle(),
        // Confirmed payments with receipts, scoped to this shipowner via RLS
        // (mig 058 payments_owner_select). Order ascending so latest wins when
        // we build the per-transaction map below.
        session.supabase
            .from('payments')
            .select('transaction_id, receipt_ref, confirmed_at')
            .eq('shipowner_id', session.shipowner.id)
            .eq('status', 'CONFIRMED')
            .not('receipt_ref', 'is', null)
            .order('confirmed_at', { ascending: true }),
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

    const rows: InvoiceRow[] = txns.map((t) => ({
        ...t,
        download_url:
            t.invoice_ref && t.content_hash
                ? buildDownloadUrl(t.invoice_ref, t.content_hash)
                : null,
        receipt_ref: receiptByTxn.get(t.id) ?? null,
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
