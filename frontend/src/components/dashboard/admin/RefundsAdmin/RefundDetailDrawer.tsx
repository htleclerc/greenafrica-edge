'use client';

import * as React from 'react';
import { X, CheckCircle2, XCircle, RefreshCw, Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { approveRefund } from '@/actions/approveRefund';
import { executeRefund } from '@/actions/executeRefund';
import { rejectRefund } from '@/actions/rejectRefund';
import { revealOwnerRefundIban } from '@/actions/revealOwnerRefundIban';
import type { RefundWithRefs } from '@/services/refundService';
import type { PaymentRail } from '@/services/paymentService';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 9: Refund detail drawer
//
// Renders status-aware controls:
//   - REQUESTED: rail picker (10 rails) + WALLET 1-click execute OR
//     Approve/Reject for other rails. WIRE shows IBAN reveal + optional proof
//     path. STRIPE is displayed read-only (the original PI is looked up by
//     the server during execute).
//   - APPROVED: Execute + Reject buttons (rail already set on the row).
//   - EXECUTED / REJECTED: read-only display.
//
// Modal pattern: inline overlay divs (NOT Radix Dialog — admin proposal
// review convention per memory). i18n keys land in Task 11 — safeTranslate
// renders the key literal if absent.
// ─────────────────────────────────────────────────────────────────────────────

function safeTranslate(
    t: (key: never, params?: never) => string,
    key: string,
    params?: Record<string, unknown>,
): string {
    try {
        return t(key as never, (params ?? {}) as never);
    } catch {
        return key;
    }
}

const ALL_RAILS: PaymentRail[] = [
    'WALLET',
    'WIRE_TRANSFER',
    'STRIPE',
    'CASH',
    'CHEQUE',
    'MOBILE_MONEY',
    'THIRD_PARTY',
    'BANK_GUARANTEE',
    'NETTING',
    'LETTER_OF_CREDIT',
];

interface Props {
    refundId: string;
    onClose: () => void;
    onUpdated: () => void;
}

export function RefundDetailDrawer({ refundId, onClose, onUpdated }: Props) {
    const t = useTranslations();
    const [refund, setRefund] = React.useState<RefundWithRefs | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    // REQUESTED-state controls
    const [selectedRail, setSelectedRail] = React.useState<PaymentRail>('WALLET');
    const [proofPath, setProofPath] = React.useState('');
    const [ibanRevealed, setIbanRevealed] = React.useState<string | null>(null);
    const [revealing, setRevealing] = React.useState(false);

    // Reject reason
    const [showRejectReason, setShowRejectReason] = React.useState(false);
    const [rejectReason, setRejectReason] = React.useState('');

    const [busyAction, setBusyAction] = React.useState<'approve' | 'execute' | 'reject' | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/admin/refunds/${refundId}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (cancelled) return;
                setRefund(data.refund as RefundWithRefs);
                // Default rail picker to the row's rail if already set
                const row = data.refund as RefundWithRefs;
                if (row.refund_rail) setSelectedRail(row.refund_rail);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [refundId]);

    async function doReveal() {
        if (!refund) return;
        setRevealing(true);
        setError(null);
        try {
            const result = await revealOwnerRefundIban({ shipownerId: refund.shipowner_id });
            if (result.ok) {
                setIbanRevealed(result.iban);
            } else {
                setError(result.error);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Reveal failed');
        } finally {
            setRevealing(false);
        }
    }

    async function doApprove() {
        if (!refund) return;
        setBusyAction('approve');
        setError(null);
        try {
            const railDetails: Record<string, unknown> = {};
            if (selectedRail === 'WIRE_TRANSFER' && proofPath) {
                railDetails.proof_storage_path = proofPath;
            }
            await approveRefund({ refundId: refund.id, refundRail: selectedRail, railDetails });
            onUpdated();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Approve failed');
        } finally {
            setBusyAction(null);
        }
    }

    async function doExecute() {
        if (!refund) return;
        setBusyAction('execute');
        setError(null);
        try {
            // For REQUESTED + WALLET, we pass refundRail to trigger 1-click combo.
            // For APPROVED, refundRail is already on the row — omit from input.
            const isOneClickWallet = refund.status === 'REQUESTED' && selectedRail === 'WALLET';
            const input: Parameters<typeof executeRefund>[0] = { refundId: refund.id };
            if (isOneClickWallet) input.refundRail = 'WALLET';
            if (refund.refund_rail === 'WIRE_TRANSFER' && proofPath) {
                input.proofPath = proofPath;
            }
            const result = await executeRefund(input);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            onUpdated();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Execute failed');
        } finally {
            setBusyAction(null);
        }
    }

    async function doReject() {
        if (!refund) return;
        if (rejectReason.trim().length < 5) {
            setError(safeTranslate(t, 'AdminRefunds.error.reasonTooShort'));
            return;
        }
        setBusyAction('reject');
        setError(null);
        try {
            await rejectRefund({ refundId: refund.id, reason: rejectReason.trim() });
            onUpdated();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Reject failed');
        } finally {
            setBusyAction(null);
        }
    }

    return (
        <>
            <div
                className="fixed inset-0 z-40 bg-black/60 transition-opacity"
                onClick={onClose}
            />
            <aside
                className="fixed top-0 right-0 z-50 h-screen w-[520px] max-w-full overflow-y-auto p-5"
                style={{
                    backgroundColor: 'var(--os-surface-1)',
                    borderLeft: '1px solid var(--os-border)',
                }}
            >
                <header className="flex items-start justify-between mb-4">
                    <div>
                        <h2 className="text-base font-semibold">
                            {safeTranslate(t, 'AdminRefunds.drawer.title')}
                        </h2>
                        {refund && (
                            <p className="text-[10px] font-mono text-[var(--os-text-muted)] mt-0.5">{refund.id}</p>
                        )}
                    </div>
                    <button onClick={onClose} aria-label="Close">
                        <X className="w-4 h-4 text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]" />
                    </button>
                </header>

                {loading && (
                    <div className="flex items-center gap-2 text-xs text-[var(--os-text-muted)]">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        {safeTranslate(t, 'AdminRefunds.loading')}
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 p-2 rounded-md bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20 mb-3">
                        <p className="text-xs text-[#EF4444]">{error}</p>
                    </div>
                )}

                {refund && (
                    <>
                        {/* Metadata */}
                        <Section label={safeTranslate(t, 'AdminRefunds.drawer.status')}>
                            <span className="text-sm font-mono">{refund.status}</span>
                        </Section>
                        <Section label={safeTranslate(t, 'AdminRefunds.drawer.invoice')}>
                            <span className="text-sm font-mono">
                                {refund.transaction?.invoice_ref ?? '—'}
                            </span>
                        </Section>
                        <Section label={safeTranslate(t, 'AdminRefunds.drawer.vessel')}>
                            <span className="text-xs">
                                {refund.transaction?.vessel_name ?? '—'}
                            </span>
                        </Section>
                        <Section label={safeTranslate(t, 'AdminRefunds.drawer.owner')}>
                            <span className="text-xs">
                                {refund.shipowner?.name ?? '—'}
                            </span>
                        </Section>
                        <Section label={safeTranslate(t, 'AdminRefunds.drawer.amount')}>
                            <span className="text-sm font-mono tabular-nums">
                                ${(refund.amount_usd_minor / 100).toFixed(2)}
                            </span>
                        </Section>
                        <Section label={safeTranslate(t, 'AdminRefunds.drawer.requestedAt')}>
                            <span className="text-xs">
                                {new Date(refund.created_at).toLocaleString()}
                            </span>
                        </Section>
                        {refund.refund_rail && (
                            <Section label={safeTranslate(t, 'AdminRefunds.drawer.rail')}>
                                <span className="text-xs font-mono">{refund.refund_rail}</span>
                            </Section>
                        )}

                        {/* REQUESTED — rail picker + actions */}
                        {refund.status === 'REQUESTED' && !showRejectReason && (
                            <div className="mt-4 pt-4 border-t border-[var(--os-border)]">
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">
                                    {safeTranslate(t, 'AdminRefunds.drawer.railPicker')}
                                </p>
                                <div className="flex flex-col gap-1.5 mb-3">
                                    {ALL_RAILS.map((r) => (
                                        <label
                                            key={r}
                                            className="flex items-center gap-2 text-xs cursor-pointer"
                                        >
                                            <input
                                                type="radio"
                                                name="rail"
                                                value={r}
                                                checked={selectedRail === r}
                                                onChange={() => setSelectedRail(r)}
                                            />
                                            <span className="font-mono">{r}</span>
                                            <span className="text-[10px] text-[var(--os-text-muted)]">
                                                {safeTranslate(t, `AdminRefunds.drawer.rail.${r}`)}
                                            </span>
                                        </label>
                                    ))}
                                </div>

                                {/* WIRE — IBAN reveal + optional proof path */}
                                {selectedRail === 'WIRE_TRANSFER' && (
                                    <div className="mb-3 p-2 rounded-md bg-[var(--os-surface-2)] border border-[var(--os-border)]">
                                        {ibanRevealed ? (
                                            <p className="text-xs font-mono break-all">
                                                {safeTranslate(t, 'AdminRefunds.drawer.ibanRevealed', { iban: ibanRevealed })}
                                            </p>
                                        ) : (
                                            <OsButton
                                                variant="secondary"
                                                size="sm"
                                                icon={<Eye className="w-3.5 h-3.5" />}
                                                onClick={doReveal}
                                                disabled={revealing}
                                            >
                                                {revealing
                                                    ? safeTranslate(t, 'AdminRefunds.drawer.revealing')
                                                    : safeTranslate(t, 'AdminRefunds.drawer.ibanReveal')}
                                            </OsButton>
                                        )}
                                        <div className="mt-2">
                                            <p className="text-[10px] text-[var(--os-text-muted)] mb-1">
                                                {safeTranslate(t, 'AdminRefunds.drawer.proofUpload')}
                                            </p>
                                            <OsInput
                                                value={proofPath}
                                                onChange={(e) => setProofPath(e.target.value)}
                                                placeholder="refund-proofs/<refund-id>/<file>"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Action buttons */}
                                <div className="flex flex-col gap-2">
                                    {selectedRail === 'WALLET' ? (
                                        <OsButton
                                            variant="primary"
                                            size="sm"
                                            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                                            onClick={doExecute}
                                            disabled={busyAction !== null}
                                        >
                                            {busyAction === 'execute'
                                                ? safeTranslate(t, 'AdminRefunds.drawer.executing')
                                                : safeTranslate(t, 'AdminRefunds.drawer.actions.executeWallet')}
                                        </OsButton>
                                    ) : (
                                        <OsButton
                                            variant="primary"
                                            size="sm"
                                            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                                            onClick={doApprove}
                                            disabled={busyAction !== null}
                                        >
                                            {busyAction === 'approve'
                                                ? safeTranslate(t, 'AdminRefunds.drawer.approving')
                                                : safeTranslate(t, 'AdminRefunds.drawer.actions.approve')}
                                        </OsButton>
                                    )}
                                    <OsButton
                                        variant="secondary"
                                        size="sm"
                                        icon={<XCircle className="w-3.5 h-3.5" />}
                                        onClick={() => setShowRejectReason(true)}
                                        disabled={busyAction !== null}
                                    >
                                        {safeTranslate(t, 'AdminRefunds.drawer.actions.reject')}
                                    </OsButton>
                                </div>
                            </div>
                        )}

                        {/* APPROVED — Execute + Reject */}
                        {refund.status === 'APPROVED' && !showRejectReason && (
                            <div className="mt-4 pt-4 border-t border-[var(--os-border)]">
                                {refund.refund_rail === 'WIRE_TRANSFER' && (
                                    <div className="mb-3">
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-1">
                                            {safeTranslate(t, 'AdminRefunds.drawer.proofUpload')}
                                        </p>
                                        <OsInput
                                            value={proofPath}
                                            onChange={(e) => setProofPath(e.target.value)}
                                            placeholder="refund-proofs/<refund-id>/<file>"
                                        />
                                    </div>
                                )}
                                <div className="flex flex-col gap-2">
                                    <OsButton
                                        variant="primary"
                                        size="sm"
                                        icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                                        onClick={doExecute}
                                        disabled={busyAction !== null}
                                    >
                                        {busyAction === 'execute'
                                            ? safeTranslate(t, 'AdminRefunds.drawer.executing')
                                            : safeTranslate(t, 'AdminRefunds.drawer.actions.execute')}
                                    </OsButton>
                                    <OsButton
                                        variant="secondary"
                                        size="sm"
                                        icon={<XCircle className="w-3.5 h-3.5" />}
                                        onClick={() => setShowRejectReason(true)}
                                        disabled={busyAction !== null}
                                    >
                                        {safeTranslate(t, 'AdminRefunds.drawer.actions.reject')}
                                    </OsButton>
                                </div>
                            </div>
                        )}

                        {/* Reject reason input — shared by REQUESTED + APPROVED */}
                        {showRejectReason && (
                            <div className="mt-4 pt-4 border-t border-[var(--os-border)]">
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#EF4444] mb-1.5">
                                    {safeTranslate(t, 'AdminRefunds.drawer.rejectReason')}
                                </p>
                                <OsInput
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    placeholder={safeTranslate(t, 'AdminRefunds.drawer.rejectReasonPlaceholder')}
                                />
                                <div className="mt-2 flex flex-col gap-2">
                                    <OsButton
                                        variant="primary"
                                        size="sm"
                                        icon={<XCircle className="w-3.5 h-3.5" />}
                                        onClick={doReject}
                                        disabled={busyAction !== null}
                                    >
                                        {busyAction === 'reject'
                                            ? safeTranslate(t, 'AdminRefunds.drawer.rejecting')
                                            : safeTranslate(t, 'AdminRefunds.drawer.actions.confirmReject')}
                                    </OsButton>
                                    <OsButton
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => { setShowRejectReason(false); setRejectReason(''); setError(null); }}
                                        disabled={busyAction !== null}
                                    >
                                        {safeTranslate(t, 'AdminRefunds.drawer.actions.cancelReject')}
                                    </OsButton>
                                </div>
                            </div>
                        )}

                        {/* EXECUTED — read-only summary */}
                        {refund.status === 'EXECUTED' && (
                            <div className="mt-4 pt-4 border-t border-[var(--os-border)]">
                                <Section label={safeTranslate(t, 'AdminRefunds.drawer.executedAt')}>
                                    <span className="text-xs">
                                        {refund.executed_at ? new Date(refund.executed_at).toLocaleString() : '—'}
                                    </span>
                                </Section>
                                {Object.keys(refund.rail_details ?? {}).length > 0 && (
                                    <Section label={safeTranslate(t, 'AdminRefunds.drawer.details')}>
                                        <pre className="text-[10px] font-mono text-[var(--os-text-secondary)] whitespace-pre-wrap">
                                            {JSON.stringify(refund.rail_details, null, 2)}
                                        </pre>
                                    </Section>
                                )}
                            </div>
                        )}

                        {/* REJECTED — read-only summary */}
                        {refund.status === 'REJECTED' && (
                            <div className="mt-4 pt-4 border-t border-[var(--os-border)]">
                                <Section label={safeTranslate(t, 'AdminRefunds.drawer.rejectedReason')}>
                                    <span className="text-xs">{refund.rejection_reason ?? '—'}</span>
                                </Section>
                                {refund.approved_by && (
                                    <Section label={safeTranslate(t, 'AdminRefunds.drawer.previouslyApprovedBy')}>
                                        <span className="text-xs font-mono">{refund.approved_by}</span>
                                    </Section>
                                )}
                            </div>
                        )}
                    </>
                )}
            </aside>
        </>
    );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between py-1.5 border-b border-[var(--os-border)] last:border-0 gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] flex-shrink-0">
                {label}
            </span>
            <div className="text-right">{children}</div>
        </div>
    );
}
