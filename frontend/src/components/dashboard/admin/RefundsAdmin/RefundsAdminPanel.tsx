'use client';

import * as React from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { RefundDetailDrawer } from './RefundDetailDrawer';
import type { RefundWithRefs, RefundStatus } from '@/services/refundService';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 9: Refunds admin panel
//
// 4 status tabs (Requested / Approved / Executed / Rejected) + list table +
// click-to-drawer. Mirrors PaymentsAdminPanel (Plan 7C-3) for layout — only
// the column set + status filter differ.
//
// i18n keys land in Task 11 — safeTranslate wraps t() so missing keys render
// as the key literal rather than crashing (mirrors NotificationList pattern).
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

const TABS: { key: RefundStatus; labelKey: string }[] = [
    { key: 'REQUESTED', labelKey: 'AdminRefunds.tabs.requested' },
    { key: 'APPROVED',  labelKey: 'AdminRefunds.tabs.approved' },
    { key: 'EXECUTED',  labelKey: 'AdminRefunds.tabs.executed' },
    { key: 'REJECTED',  labelKey: 'AdminRefunds.tabs.rejected' },
];

export function RefundsAdminPanel() {
    const t = useTranslations();

    const [activeTab, setActiveTab] = React.useState<RefundStatus>('REQUESTED');
    const [rows, setRows] = React.useState<RefundWithRefs[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [refreshKey, setRefreshKey] = React.useState(0);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const url = new URL('/api/admin/refunds', window.location.origin);
                url.searchParams.set('status', activeTab);
                url.searchParams.set('limit', '50');
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!cancelled) setRows((data.refunds ?? []) as RefundWithRefs[]);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [activeTab, refreshKey]);

    function formatAmount(minor: number): string {
        return `$${(minor / 100).toFixed(2)}`;
    }

    return (
        <section className="os-card p-5 mb-5">
            <header className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                    <h2 className="text-lg font-bold text-[var(--os-text-primary)]">
                        {safeTranslate(t, 'AdminRefunds.pageTitle')}
                    </h2>
                </div>
                <div className="flex items-center gap-2">
                    <OsButton
                        variant="secondary"
                        size="sm"
                        icon={<RefreshCw className="w-3.5 h-3.5" />}
                        onClick={() => setRefreshKey((k) => k + 1)}
                    >
                        {safeTranslate(t, 'AdminRefunds.refresh')}
                    </OsButton>
                </div>
            </header>

            {/* Tabs */}
            <div className="flex items-center gap-1 mb-4 flex-wrap">
                {TABS.map((tab) => {
                    const active = activeTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className="text-xs px-3 py-1.5 rounded-md border transition-colors"
                            style={{
                                borderColor: active ? '#10B981' : 'var(--os-border)',
                                backgroundColor: active ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                                color: active ? '#10B981' : 'var(--os-text-muted)',
                            }}
                        >
                            {safeTranslate(t, tab.labelKey)}
                        </button>
                    );
                })}
            </div>

            {error && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20 mb-3">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                    <p className="text-xs text-[#EF4444]">{error}</p>
                </div>
            )}

            {loading ? (
                <p className="text-xs text-[var(--os-text-muted)] py-4">
                    {safeTranslate(t, 'AdminRefunds.loading')}
                </p>
            ) : rows.length === 0 ? (
                <p className="text-xs text-[var(--os-text-muted)] py-4">
                    {safeTranslate(t, 'AdminRefunds.empty')}
                </p>
            ) : (
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--os-text-muted)] border-b border-[var(--os-border)]">
                            <th className="px-3 py-2">{safeTranslate(t, 'AdminRefunds.table.invoice')}</th>
                            <th className="px-3 py-2">{safeTranslate(t, 'AdminRefunds.table.owner')}</th>
                            <th className="px-3 py-2">{safeTranslate(t, 'AdminRefunds.table.amount')}</th>
                            <th className="px-3 py-2">{safeTranslate(t, 'AdminRefunds.table.requestedAt')}</th>
                            <th className="px-3 py-2">{safeTranslate(t, 'AdminRefunds.table.rail')}</th>
                            <th className="px-3 py-2">{safeTranslate(t, 'AdminRefunds.table.status')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr
                                key={r.id}
                                onClick={() => setSelectedId(r.id)}
                                className="border-b border-[var(--os-border)] hover:bg-[var(--os-surface-2)] cursor-pointer transition-colors"
                            >
                                <td className="px-3 py-2 text-xs font-mono">
                                    {r.transaction?.invoice_ref ?? '—'}
                                </td>
                                <td className="px-3 py-2 text-xs">
                                    {r.shipowner?.name ?? '—'}
                                </td>
                                <td className="px-3 py-2 text-xs font-mono tabular-nums">
                                    {formatAmount(r.amount_usd_minor)}
                                </td>
                                <td className="px-3 py-2 text-xs">
                                    {new Date(r.created_at).toLocaleDateString()}
                                </td>
                                <td className="px-3 py-2 text-[10px] font-mono text-[var(--os-text-muted)]">
                                    {r.refund_rail ?? '—'}
                                </td>
                                <td className="px-3 py-2">
                                    <span
                                        className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                                        style={{
                                            backgroundColor:
                                                r.status === 'EXECUTED' ? 'rgba(16,185,129,0.12)' :
                                                r.status === 'REJECTED' ? 'rgba(239,68,68,0.12)' :
                                                r.status === 'APPROVED' ? 'rgba(56,189,248,0.12)' :
                                                'rgba(234,179,8,0.12)',
                                            color:
                                                r.status === 'EXECUTED' ? '#10B981' :
                                                r.status === 'REJECTED' ? '#EF4444' :
                                                r.status === 'APPROVED' ? '#38BDF8' :
                                                '#EAB308',
                                        }}
                                    >
                                        {r.status}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {selectedId && (
                <RefundDetailDrawer
                    refundId={selectedId}
                    onClose={() => setSelectedId(null)}
                    onUpdated={() => {
                        setSelectedId(null);
                        setRefreshKey((k) => k + 1);
                    }}
                />
            )}
        </section>
    );
}
