'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, AlertTriangle } from 'lucide-react';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge } from '@/components/ui/OsBadge';
import { resolvePaymentIntent } from '@/actions/resolvePaymentIntent';
import type { PaymentIntentRow } from '@/services/paymentIntentService';

interface Props {
    intents: PaymentIntentRow[];
}

function formatUsd(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format(amount);
}

export function PendingIntentsPanel({ intents }: Props) {
    const router = useRouter();
    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [rejectTarget, setRejectTarget] = React.useState<PaymentIntentRow | null>(null);
    const [rejectNote, setRejectNote] = React.useState('');
    const [isPending, startTransition] = React.useTransition();

    function confirm(row: PaymentIntentRow) {
        setError(null);
        setPendingId(row.id);
        startTransition(async () => {
            const result = await resolvePaymentIntent({
                intentId: row.id,
                action: 'confirm',
            });
            setPendingId(null);
            if (!result.ok) {
                setError(`${row.reference}: ${result.reason}`);
                return;
            }
            router.refresh();
        });
    }

    function submitReject() {
        if (!rejectTarget) return;
        setError(null);
        setPendingId(rejectTarget.id);
        startTransition(async () => {
            const result = await resolvePaymentIntent({
                intentId: rejectTarget.id,
                action: 'reject',
                resolutionNote: rejectNote,
            });
            setPendingId(null);
            if (!result.ok) {
                setError(`${rejectTarget.reference}: ${result.reason}`);
                return;
            }
            setRejectTarget(null);
            setRejectNote('');
            router.refresh();
        });
    }

    const columns: OsColumn<PaymentIntentRow>[] = [
        {
            key: 'declared',
            header: 'Declared',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                    {new Date(r.declared_at).toLocaleString()}
                </span>
            ),
        },
        {
            key: 'invoice',
            header: 'Invoice',
            render: (r) => (
                <div className="flex flex-col leading-tight">
                    <span className="font-mono text-xs text-emerald-400">
                        {r.txn?.invoice_ref ?? r.transaction_id.slice(0, 8)}
                    </span>
                    <span className="text-[10px] text-[var(--os-text-muted)]">
                        {r.txn?.vessel_name ?? '—'}
                    </span>
                </div>
            ),
        },
        {
            key: 'declarer',
            header: 'Declared by',
            render: (r) => (
                <div className="flex flex-col leading-tight text-xs">
                    <span className="text-[var(--os-text-primary)]">
                        {r.declarer?.full_name ?? '—'}
                    </span>
                    <span className="text-[10px] text-[var(--os-text-muted)]">
                        {r.declarer?.email ?? ''}
                    </span>
                </div>
            ),
        },
        {
            key: 'reference',
            header: 'Bank ref',
            render: (r) => (
                <span className="font-mono text-xs">{r.reference}</span>
            ),
        },
        {
            key: 'amount',
            header: 'Declared',
            className: 'text-right',
            render: (r) => {
                const declared = Number(r.amount_usd);
                const invoiced = Number(r.txn?.tax_amount_usd ?? 0);
                const mismatch = Math.abs(declared - invoiced) > 0.01;
                return (
                    <div className="flex flex-col items-end leading-tight">
                        <span className="font-mono text-sm tabular-nums">
                            {formatUsd(declared)}
                        </span>
                        {mismatch && (
                            <span
                                className="text-[10px] flex items-center gap-1"
                                style={{ color: '#F59E0B' }}
                                title={`Invoice amount is ${formatUsd(invoiced)}`}
                            >
                                <AlertTriangle className="w-3 h-3" />
                                vs {formatUsd(invoiced)}
                            </span>
                        )}
                    </div>
                );
            },
        },
        {
            key: 'notes',
            header: 'Notes',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)] line-clamp-2 max-w-[200px]">
                    {r.notes ?? '—'}
                </span>
            ),
        },
        {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (r) => (
                <div className="flex justify-end gap-2">
                    <OsButton
                        size="sm"
                        variant="primary"
                        onClick={() => confirm(r)}
                        loading={isPending && pendingId === r.id}
                        disabled={isPending}
                        icon={<Check className="w-3.5 h-3.5" />}
                    >
                        Confirm
                    </OsButton>
                    <OsButton
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                            setRejectTarget(r);
                            setRejectNote('');
                        }}
                        disabled={isPending}
                        icon={<X className="w-3.5 h-3.5" />}
                    >
                        Reject
                    </OsButton>
                </div>
            ),
        },
    ];

    return (
        <section className="mb-8">
            <div className="flex items-baseline justify-between mb-3">
                <div>
                    <h2 className="text-base font-semibold text-[var(--os-text-primary)]">
                        Pending payment declarations
                    </h2>
                    <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                        Shipowners declared they paid via bank transfer.
                        Reconcile against the bank statement, then confirm or reject.
                    </p>
                </div>
                <OsBadge
                    variant={intents.length > 0 ? 'warning' : 'archived'}
                    label={`${intents.length} pending`}
                />
            </div>

            {error && (
                <div
                    className="mb-3 px-3 py-2 rounded-lg text-xs"
                    style={{
                        backgroundColor: 'rgba(239,68,68,0.10)',
                        border: '1px solid rgba(239,68,68,0.35)',
                        color: '#FCA5A5',
                    }}
                >
                    {error}
                </div>
            )}

            <OsTable
                columns={columns}
                rows={intents}
                keyExtractor={(r) => r.id}
                emptyMessage="No pending payment declarations."
            />

            {/* Reject dialog — inline so we don't need another file for v0+1 */}
            {rejectTarget && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center px-4"
                    style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                    onClick={() => !isPending && setRejectTarget(null)}
                >
                    <div
                        className="w-full max-w-md rounded-2xl p-5"
                        style={{
                            backgroundColor: 'var(--os-surface-2)',
                            border: '1px solid var(--os-border)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-base font-semibold text-[var(--os-text-primary)] mb-1">
                            Reject declaration
                        </h3>
                        <p className="text-sm text-[var(--os-text-muted)] mb-4">
                            Reject{' '}
                            <span className="font-mono text-emerald-400">
                                {rejectTarget.reference}
                            </span>{' '}
                            for invoice{' '}
                            <span className="font-mono">
                                {rejectTarget.txn?.invoice_ref ?? '—'}
                            </span>
                            ? The transaction will stay PENDING. The owner can submit a
                            new declaration.
                        </p>
                        <textarea
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                            rows={3}
                            placeholder="Reason — e.g. 'Reference not found in bank statement'"
                            className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                            style={{
                                backgroundColor: 'var(--os-surface)',
                                border: '1px solid var(--os-border)',
                                color: 'var(--os-text-primary)',
                            }}
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <OsButton
                                variant="ghost"
                                onClick={() => setRejectTarget(null)}
                                disabled={isPending}
                            >
                                Cancel
                            </OsButton>
                            <OsButton
                                variant="danger"
                                onClick={submitReject}
                                loading={isPending}
                                disabled={isPending}
                            >
                                Reject
                            </OsButton>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
