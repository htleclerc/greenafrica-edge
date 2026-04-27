import { Download } from 'lucide-react';
import { requireOwner } from '@/lib/auth/requireOwner';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { signInvoiceRef } from '@/services/invoiceService';
import { formatUsd } from '@/services/ownerPortalService';

export const metadata = {
    title: 'Owner portal — invoices',
};

export const dynamic = 'force-dynamic';

interface TxnRow {
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

const docVariant = (
    docType: TxnRow['document_type'],
): 'info' | 'warning' | 'critical' | 'active' | 'draft' | 'archived' => {
    if (docType === 'PROFORMA') return 'warning';
    if (docType === 'FINAL') return 'active';
    if (docType === 'COMPLEMENT') return 'info';
    if (docType === 'REFUND') return 'archived';
    return 'draft';
};

const statusVariant = (
    status: string,
): 'info' | 'warning' | 'critical' | 'active' | 'draft' | 'archived' => {
    if (status === 'PAID') return 'active';
    if (status === 'PENDING') return 'warning';
    if (status === 'OVERDUE') return 'critical';
    if (status === 'PARTIAL') return 'warning';
    if (status === 'CANCELLED') return 'archived';
    return 'info';
};

export default async function OwnerInvoicesPage() {
    const session = await requireOwner();

    const { data, error } = await session.supabase
        .from('transactions')
        .select(
            'id, invoice_ref, content_hash, document_type, vessel_name, tax_amount_usd, status, paid_at, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(200);

    const txns: TxnRow[] = (data ?? []) as TxnRow[];

    const columns: OsColumn<TxnRow>[] = [
        {
            key: 'ref',
            header: 'Reference',
            render: (r) => (
                <span className="font-mono text-xs text-[var(--os-text-primary)]">
                    {r.invoice_ref ?? r.id.slice(0, 8)}
                </span>
            ),
        },
        {
            key: 'docType',
            header: 'Type',
            render: (r) => (
                <OsBadge variant={docVariant(r.document_type)} label={r.document_type ?? '—'} />
            ),
        },
        {
            key: 'vessel',
            header: 'Vessel',
            render: (r) => <span className="text-sm">{r.vessel_name}</span>,
        },
        {
            key: 'amount',
            header: 'Amount',
            className: 'text-right',
            render: (r) => (
                <span className="font-mono text-sm tabular-nums">
                    {formatUsd(Number(r.tax_amount_usd))}
                </span>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            render: (r) => <OsBadge variant={statusVariant(r.status)} label={r.status} />,
        },
        {
            key: 'date',
            header: 'Date',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                    {r.paid_at
                        ? new Date(r.paid_at).toLocaleDateString()
                        : new Date(r.created_at).toLocaleDateString()}
                </span>
            ),
        },
        {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (r) =>
                r.invoice_ref && r.content_hash ? (
                    <a
                        href={buildDownloadUrl(r.invoice_ref, r.content_hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:underline"
                        aria-label={`Download PDF for ${r.invoice_ref}`}
                    >
                        <Download className="w-3.5 h-3.5" />
                        PDF
                    </a>
                ) : null,
        },
    ];

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

            {error ? (
                <div className="os-card p-4 text-sm" style={{ color: '#FCA5A5' }}>
                    Failed to load invoices: {error.message}
                </div>
            ) : (
                <OsTable
                    columns={columns}
                    rows={txns}
                    keyExtractor={(r) => r.id}
                    emptyMessage="No invoices on file yet."
                />
            )}
        </div>
    );
}
