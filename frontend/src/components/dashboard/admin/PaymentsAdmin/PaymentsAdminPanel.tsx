'use client';

import * as React from 'react';
import { Plus, RefreshCw, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { useRole } from '@/lib/RoleContext';
import { canEdit } from '@/lib/rbac';
import { PaymentRow } from './PaymentRow';
import { RecordManualPaymentDialog } from './RecordManualPaymentDialog';
import { PaymentReviewDrawer } from './PaymentReviewDrawer';
import type { PaymentRow as PaymentRowType, PaymentStatusV7, PaymentRail } from '@/services/paymentService';

const ALL_STATUSES: PaymentStatusV7[] = ['INITIATED', 'PROCESSING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED'];
const ALL_RAILS: PaymentRail[] = ['STRIPE','PAYPAL','WIRE_TRANSFER','CASH','CHEQUE','LETTER_OF_CREDIT','NETTING','THIRD_PARTY','MOBILE_MONEY','BANK_GUARANTEE','WALLET'];

export function PaymentsAdminPanel() {
    const t = useTranslations('AdminPayments');
    const { role } = useRole();
    const canRecord = canEdit('tax-settings', role); // same gate as PaymentProvidersPanel

    const [rows, setRows] = React.useState<PaymentRowType[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [statusFilter, setStatusFilter] = React.useState<Set<PaymentStatusV7>>(new Set(['INITIATED', 'PROCESSING']));
    const [railFilter, setRailFilter] = React.useState<Set<PaymentRail>>(new Set());
    const [openDialog, setOpenDialog] = React.useState(false);
    const [reviewId, setReviewId] = React.useState<string | null>(null);
    const [refreshKey, setRefreshKey] = React.useState(0);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const url = new URL('/api/admin/payments', window.location.origin);
                if (statusFilter.size > 0) url.searchParams.set('status', Array.from(statusFilter).join(','));
                if (railFilter.size > 0)   url.searchParams.set('rail', Array.from(railFilter).join(','));
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!cancelled) setRows(data.payments ?? []);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [statusFilter, railFilter, refreshKey]);

    function toggleSetMember<T>(set: Set<T>, member: T): Set<T> {
        const next = new Set(set);
        if (next.has(member)) next.delete(member); else next.add(member);
        return next;
    }

    return (
        <section className="os-card p-5 mb-5">
            <header className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                    <h2 className="text-lg font-bold text-[var(--os-text-primary)]">{t('title')}</h2>
                    <p className="text-xs text-[var(--os-text-muted)]">{t('subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <OsButton
                        variant="secondary"
                        size="sm"
                        icon={<RefreshCw className="w-3.5 h-3.5" />}
                        onClick={() => setRefreshKey((k) => k + 1)}
                    >
                        {t('refresh')}
                    </OsButton>
                    {canRecord && (
                        <OsButton
                            variant="primary"
                            size="sm"
                            icon={<Plus className="w-3.5 h-3.5" />}
                            onClick={() => setOpenDialog(true)}
                        >
                            {t('recordManual')}
                        </OsButton>
                    )}
                </div>
            </header>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 mb-3">
                <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mr-1">
                        {t('filterStatus')}
                    </span>
                    {ALL_STATUSES.map((s) => {
                        const active = statusFilter.has(s);
                        return (
                            <button
                                key={s}
                                onClick={() => setStatusFilter((set) => toggleSetMember(set, s))}
                                className="text-[10px] px-2 py-0.5 rounded-md border transition-colors"
                                style={{
                                    borderColor: active ? '#10B981' : 'var(--os-border)',
                                    backgroundColor: active ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                                    color: active ? '#10B981' : 'var(--os-text-muted)',
                                }}
                            >
                                {s}
                            </button>
                        );
                    })}
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mr-1">
                        {t('filterRail')}
                    </span>
                    {ALL_RAILS.map((r) => {
                        const active = railFilter.has(r);
                        return (
                            <button
                                key={r}
                                onClick={() => setRailFilter((set) => toggleSetMember(set, r))}
                                className="text-[9px] font-mono px-2 py-0.5 rounded-md border transition-colors"
                                style={{
                                    borderColor: active ? '#38BDF8' : 'var(--os-border)',
                                    backgroundColor: active ? 'rgba(56,189,248,0.12)' : 'var(--os-surface-2)',
                                    color: active ? '#38BDF8' : 'var(--os-text-muted)',
                                }}
                            >
                                {r}
                            </button>
                        );
                    })}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20 mb-3">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                    <p className="text-xs text-[#EF4444]">{error}</p>
                </div>
            )}

            {loading ? (
                <p className="text-xs text-[var(--os-text-muted)] py-4">{t('loading')}</p>
            ) : rows.length === 0 ? (
                <p className="text-xs text-[var(--os-text-muted)] py-4">{t('empty')}</p>
            ) : (
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--os-text-muted)] border-b border-[var(--os-border)]">
                            <th className="px-3 py-2">{t('col.id')}</th>
                            <th className="px-3 py-2">{t('col.rail')}</th>
                            <th className="px-3 py-2">{t('col.amount')}</th>
                            <th className="px-3 py-2">{t('col.status')}</th>
                            <th className="px-3 py-2">{t('col.created')}</th>
                            <th className="px-3 py-2">{t('col.ref')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((p) => (
                            <PaymentRow key={p.id} payment={p} onOpen={(id) => setReviewId(id)} />
                        ))}
                    </tbody>
                </table>
            )}

            {openDialog && (
                <RecordManualPaymentDialog
                    open={openDialog}
                    onOpenChange={(o) => {
                        setOpenDialog(o);
                        if (!o) setRefreshKey((k) => k + 1);
                    }}
                />
            )}
            {reviewId && (
                <PaymentReviewDrawer
                    paymentId={reviewId}
                    onClose={() => {
                        setReviewId(null);
                        setRefreshKey((k) => k + 1);
                    }}
                />
            )}
        </section>
    );
}
