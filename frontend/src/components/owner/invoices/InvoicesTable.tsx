'use client';

import * as React from 'react';
import { Download, CreditCard, Scale, Receipt, Paperclip, FileClock } from 'lucide-react';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { PayDialog } from '@/components/owner/PayDialog';
import { OpenDisputeDialog } from './OpenDisputeDialog';
import { AttachProofDialog } from './AttachProofDialog';

export interface InvoiceRow {
    id: string;
    invoice_ref: string | null;
    content_hash: string | null;
    document_type: 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND' | null;
    vessel_name: string;
    tax_amount_usd: number;
    status: string;
    paid_at: string | null;
    created_at: string;
    /** Server-side pre-computed signed URL or null if no PDF available. */
    download_url: string | null;
    /** Receipt reference of the latest CONFIRMED payment, or null if none. */
    receipt_ref: string | null;
    /** Payment id of an INITIATED/PROCESSING wire payment for this invoice, or null. */
    pending_wire_payment_id: string | null;
}

const docVariant = (docType: InvoiceRow['document_type']): BadgeVariant => {
    if (docType === 'PROFORMA') return 'warning';
    if (docType === 'FINAL') return 'active';
    if (docType === 'COMPLEMENT') return 'info';
    if (docType === 'REFUND') return 'archived';
    return 'draft';
};

const statusVariant = (status: string): BadgeVariant => {
    if (status === 'PAID') return 'active';
    if (status === 'PENDING') return 'warning';
    if (status === 'OVERDUE') return 'critical';
    if (status === 'PARTIAL') return 'warning';
    if (status === 'CANCELLED') return 'archived';
    return 'info';
};

function formatUsd(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format(amount);
}

interface Props {
    rows: InvoiceRow[];
    walletBalanceUsdMinor: number;
}

export function InvoicesTable({ rows, walletBalanceUsdMinor }: Props) {
    const [payTarget, setPayTarget] = React.useState<InvoiceRow | null>(null);
    const [disputeTarget, setDisputeTarget] = React.useState<InvoiceRow | null>(null);
    const [proofTarget, setProofTarget] = React.useState<InvoiceRow | null>(null);

    const isPayable = (r: InvoiceRow) =>
        r.document_type === 'PROFORMA' && r.status === 'PENDING';
    const isDisputable = (r: InvoiceRow) =>
        (r.document_type === 'PROFORMA' || r.document_type === 'FINAL' || r.document_type === 'COMPLEMENT') &&
        r.status !== 'CANCELLED';
    // A charge the authority is expected to have issued a PDF for. Refunds are
    // credit notes settled through the wallet — they carry no such document, so
    // a missing PDF on a refund row is normal, not a gap.
    const expectsDocument = (r: InvoiceRow) =>
        r.document_type === 'PROFORMA' || r.document_type === 'FINAL' || r.document_type === 'COMPLEMENT';

    const columns: OsColumn<InvoiceRow>[] = [
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
            render: (r) => (
                <OsBadge variant={statusVariant(r.status)} label={r.status} />
            ),
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
            render: (r) => (
                <div className="flex justify-end items-center gap-3">
                    {r.download_url ? (
                        <a
                            href={r.download_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:underline"
                            aria-label={`Download PDF for ${r.invoice_ref ?? r.id}`}
                        >
                            <Download className="w-3.5 h-3.5" />
                            PDF
                        </a>
                    ) : (
                        expectsDocument(r) && (
                            <span
                                className="inline-flex items-center gap-1.5 text-xs text-[var(--os-text-muted)]"
                                title="The port authority has not issued the PDF for this charge yet. You can still pay or dispute it."
                            >
                                <FileClock className="w-3.5 h-3.5" />
                                PDF not issued
                            </span>
                        )
                    )}
                    {r.receipt_ref && (
                        <a
                            href={`/api/receipts/${encodeURIComponent(r.receipt_ref)}/download`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:underline"
                            aria-label={`Download receipt ${r.receipt_ref}`}
                        >
                            <Receipt className="w-3.5 h-3.5" />
                            Receipt
                        </a>
                    )}
                    {isDisputable(r) && (
                        <button
                            onClick={() => setDisputeTarget(r)}
                            className="inline-flex items-center gap-1 text-xs text-[var(--os-text-muted)] hover:text-[#F59E0B] transition-colors"
                            aria-label={`Dispute ${r.invoice_ref ?? r.id}`}
                            title="Open a dispute on this charge"
                        >
                            <Scale className="w-3.5 h-3.5" />
                            Dispute
                        </button>
                    )}
                    {r.pending_wire_payment_id && (
                        <button
                            onClick={() => setProofTarget(r)}
                            className="inline-flex items-center gap-1 text-xs text-[var(--os-text-muted)] hover:text-[#10B981] transition-colors"
                            aria-label={`Attach proof for ${r.invoice_ref ?? r.id}`}
                            title="Attach proof of payment"
                        >
                            <Paperclip className="w-3.5 h-3.5" />
                            Proof
                        </button>
                    )}
                    {isPayable(r) && (
                        <OsButton
                            size="sm"
                            variant="primary"
                            onClick={() => setPayTarget(r)}
                            icon={<CreditCard className="w-3.5 h-3.5" />}
                        >
                            Pay
                        </OsButton>
                    )}
                </div>
            ),
        },
    ];

    return (
        <>
            <OsTable
                columns={columns}
                rows={rows}
                keyExtractor={(r) => r.id}
                emptyMessage="No invoices on file yet."
            />
            {payTarget && (
                <PayDialog
                    open={true}
                    onOpenChange={(o) => !o && setPayTarget(null)}
                    transactionId={payTarget.id}
                    invoiceRef={payTarget.invoice_ref ?? payTarget.id.slice(0, 8)}
                    amountUsd={Number(payTarget.tax_amount_usd)}
                    currency="USD"
                    walletBalanceUsdMinor={walletBalanceUsdMinor}
                />
            )}
            {disputeTarget && (
                <OpenDisputeDialog
                    open={true}
                    onOpenChange={(o) => !o && setDisputeTarget(null)}
                    transactionId={disputeTarget.id}
                    invoiceRef={disputeTarget.invoice_ref ?? disputeTarget.id.slice(0, 8)}
                />
            )}
            {proofTarget?.pending_wire_payment_id && (
                <AttachProofDialog
                    open={true}
                    onOpenChange={(o) => !o && setProofTarget(null)}
                    paymentId={proofTarget.pending_wire_payment_id}
                    invoiceRef={proofTarget.invoice_ref ?? proofTarget.id.slice(0, 8)}
                />
            )}
        </>
    );
}
