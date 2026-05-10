'use client';

import * as React from 'react';
import { X, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { confirmPayment } from '@/actions/confirmPayment';
import { rejectPayment } from '@/actions/rejectPayment';
import { ProofPreview } from './ProofPreview';
import type { PaymentRow } from '@/services/paymentService';

interface Props {
    paymentId: string;
    onClose: () => void;
}

interface Proof {
    id: string;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
    signed_url: string;
}

export function PaymentReviewDrawer({ paymentId, onClose }: Props) {
    const t = useTranslations('AdminPayments.reviewDrawer');
    const [payment, setPayment] = React.useState<PaymentRow | null>(null);
    const [proofs, setProofs] = React.useState<Proof[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [busyAction, setBusyAction] = React.useState<'confirm' | 'reject' | null>(null);
    const [showRejectReason, setShowRejectReason] = React.useState(false);
    const [rejectReason, setRejectReason] = React.useState('');

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const res = await fetch(`/api/admin/payments/${paymentId}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (cancelled) return;
                setPayment(data.payment as PaymentRow);
                setProofs(data.proofs ?? []);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [paymentId]);

    async function doConfirm() {
        if (!payment) return;
        setBusyAction('confirm'); setError(null);
        try {
            await confirmPayment({ paymentId: payment.id });
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Confirm failed');
        } finally {
            setBusyAction(null);
        }
    }

    async function doReject() {
        if (!payment) return;
        if (!rejectReason || rejectReason.trim().length < 3) {
            setError(t('errors.reasonRequired'));
            return;
        }
        setBusyAction('reject'); setError(null);
        try {
            await rejectPayment({ paymentId: payment.id, reason: rejectReason.trim() });
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Reject failed');
        } finally {
            setBusyAction(null);
        }
    }

    // Note: cancelPayment is owner-self-service (requireOwner-scoped per Plan
    // 7C-1). Admins reject with a reason; owners cancel from their own UI.
    // No "Cancel" button on the admin drawer.

    const canConfirm = payment?.status === 'INITIATED' || payment?.status === 'PROCESSING';
    const canReject  = payment?.status === 'INITIATED' || payment?.status === 'PROCESSING';

    return (
        <>
            {/* Overlay */}
            <div
                className="fixed inset-0 z-40 bg-black/60 transition-opacity"
                onClick={onClose}
            />
            {/* Drawer */}
            <aside
                className="fixed top-0 right-0 z-50 h-screen w-[480px] max-w-full overflow-y-auto p-5"
                style={{
                    backgroundColor: 'var(--os-surface-1)',
                    borderLeft: '1px solid var(--os-border)',
                }}
            >
                <header className="flex items-start justify-between mb-4">
                    <div>
                        <h2 className="text-base font-semibold">{t('title')}</h2>
                        {payment && (
                            <p className="text-[10px] font-mono text-[var(--os-text-muted)] mt-0.5">{payment.id}</p>
                        )}
                    </div>
                    <button onClick={onClose}>
                        <X className="w-4 h-4 text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]" />
                    </button>
                </header>

                {loading && (
                    <div className="flex items-center gap-2 text-xs text-[var(--os-text-muted)]">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        {t('loading')}
                    </div>
                )}

                {error && (
                    <p className="text-xs text-[#EF4444] mb-3">{error}</p>
                )}

                {payment && (
                    <>
                        <Section label={t('status')}>
                            <span className="text-sm font-mono">{payment.status}</span>
                        </Section>
                        <Section label={t('rail')}>
                            <span className="text-sm font-mono">{payment.rail}</span>
                        </Section>
                        <Section label={t('amount')}>
                            <span className="text-sm font-mono tabular-nums">
                                ${(payment.amount_usd_minor / 100).toFixed(2)}
                                {payment.currency !== 'USD' && (
                                    <span className="ml-2 text-[10px] text-[var(--os-text-muted)]">
                                        ({(payment.amount_minor / 100).toFixed(2)} {payment.currency})
                                    </span>
                                )}
                            </span>
                        </Section>
                        {payment.transaction_id && (
                            <Section label={t('transaction')}>
                                <span className="text-xs font-mono">{payment.transaction_id.slice(0, 8)}</span>
                            </Section>
                        )}
                        <Section label={t('declaredBy')}>
                            <span className="text-xs font-mono">{payment.declared_by ?? '—'}</span>
                        </Section>
                        <Section label={t('createdAt')}>
                            <span className="text-xs">{new Date(payment.created_at).toLocaleString()}</span>
                        </Section>
                        {Object.keys(payment.rail_details).length > 0 && (
                            <Section label={t('details')}>
                                <pre className="text-[10px] font-mono text-[var(--os-text-secondary)] whitespace-pre-wrap">
                                    {JSON.stringify(payment.rail_details, null, 2)}
                                </pre>
                            </Section>
                        )}

                        {proofs.length > 0 && (
                            <div className="mt-4">
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                                    {t('proofs')} ({proofs.length})
                                </p>
                                <div className="flex flex-col gap-2">
                                    {proofs.map((p) => <ProofPreview key={p.id} proof={p} />)}
                                </div>
                            </div>
                        )}

                        {/* Reject reason */}
                        {showRejectReason && (
                            <div className="mt-4">
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#EF4444] mb-1.5">
                                    {t('rejectReason')}
                                </p>
                                <OsInput value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={t('rejectReasonPlaceholder')} />
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="mt-5 flex flex-col gap-2">
                            {canConfirm && !showRejectReason && (
                                <OsButton
                                    variant="primary"
                                    size="sm"
                                    icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                                    onClick={doConfirm}
                                    disabled={busyAction !== null}
                                >
                                    {busyAction === 'confirm' ? t('confirming') : t('confirm')}
                                </OsButton>
                            )}
                            {canReject && !showRejectReason && (
                                <OsButton
                                    variant="secondary"
                                    size="sm"
                                    icon={<XCircle className="w-3.5 h-3.5" />}
                                    onClick={() => setShowRejectReason(true)}
                                    disabled={busyAction !== null}
                                >
                                    {t('reject')}
                                </OsButton>
                            )}
                            {showRejectReason && (
                                <>
                                    <OsButton
                                        variant="primary"
                                        size="sm"
                                        icon={<XCircle className="w-3.5 h-3.5" />}
                                        onClick={doReject}
                                        disabled={busyAction !== null}
                                    >
                                        {busyAction === 'reject' ? t('rejecting') : t('confirmReject')}
                                    </OsButton>
                                    <OsButton
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => { setShowRejectReason(false); setRejectReason(''); setError(null); }}
                                        disabled={busyAction !== null}
                                    >
                                        {t('cancelReject')}
                                    </OsButton>
                                </>
                            )}
                        </div>
                    </>
                )}
            </aside>
        </>
    );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-[var(--os-border)] last:border-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                {label}
            </span>
            <div>{children}</div>
        </div>
    );
}
