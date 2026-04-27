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

    const [txnRes, intentRes] = await Promise.all([
        session.supabase
            .from('transactions')
            .select(
                'id, invoice_ref, content_hash, document_type, vessel_name, tax_amount_usd, status, paid_at, created_at',
            )
            .order('created_at', { ascending: false })
            .limit(200),
        // Latest pending intent per transaction. RLS scopes to declared_by=auth.uid()
        // so we only see our own.
        session.supabase
            .from('shipowner_payment_intents')
            .select('transaction_id, status')
            .eq('status', 'DECLARED'),
    ]);

    const txns: RawTxn[] = (txnRes.data ?? []) as RawTxn[];
    const pendingByTxn = new Set(
        ((intentRes.data ?? []) as { transaction_id: string }[]).map(
            (i) => i.transaction_id,
        ),
    );

    const rows: InvoiceRow[] = txns.map((t) => ({
        ...t,
        download_url:
            t.invoice_ref && t.content_hash
                ? buildDownloadUrl(t.invoice_ref, t.content_hash)
                : null,
        has_pending_intent: pendingByTxn.has(t.id),
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
                <InvoicesTable rows={rows} />
            )}
        </div>
    );
}
