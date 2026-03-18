'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    Search, Scale, AlertTriangle, Clock, CheckCircle, XCircle,
    ChevronRight, ArrowLeft, Plus, FileText, ExternalLink,
} from 'lucide-react';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { useDisputes } from '@/hooks/useDisputes';
import { useRole } from '@/lib/RoleContext';
import { Dispute, DisputeStatus, DisputeReason, UserRole } from '@/types/secure';
import { DisputeFormModal } from './DisputeFormModal';
import type { BadgeVariant } from '@/lib/badgeUtils';

// ── Badge variant mapping ────────────────────────────────────────────────────

const DISPUTE_STATUS_VARIANT: Record<DisputeStatus, BadgeVariant> = {
    [DisputeStatus.OPEN]:         'pending',
    [DisputeStatus.UNDER_REVIEW]: 'processing',
    [DisputeStatus.ACCEPTED]:     'compliant',
    [DisputeStatus.REJECTED]:     'non_compliant',
    [DisputeStatus.ESCALATED]:    'warning',
};

const DISPUTE_REASON_VARIANT: Record<DisputeReason, BadgeVariant> = {
    [DisputeReason.EMISSION_CALCULATION]: 'info',
    [DisputeReason.TAX_RATE]:             'warning',
    [DisputeReason.ZONE_CLASSIFICATION]:  'processing',
    [DisputeReason.VESSEL_DATA]:          'approaching',
    [DisputeReason.OTHER]:                'draft',
};

const STATUS_ICON: Record<DisputeStatus, React.ReactNode> = {
    [DisputeStatus.OPEN]:         <Clock className="w-3.5 h-3.5 text-[#F59E0B]" />,
    [DisputeStatus.UNDER_REVIEW]: <Scale className="w-3.5 h-3.5 text-[#F97316]" />,
    [DisputeStatus.ACCEPTED]:     <CheckCircle className="w-3.5 h-3.5 text-[#22C55E]" />,
    [DisputeStatus.REJECTED]:     <XCircle className="w-3.5 h-3.5 text-[#EF4444]" />,
    [DisputeStatus.ESCALATED]:    <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B]" />,
};

type TabFilter = 'ALL' | DisputeStatus;

export function DisputesPage() {
    const t = useTranslations('Disputes');
    const { data: disputes } = useDisputes();
    const { role } = useRole();
    const [tab, setTab]             = React.useState<TabFilter>('ALL');
    const [search, setSearch]       = React.useState('');
    const [selected, setSelected]   = React.useState<Dispute | null>(null);
    const [showNewForm, setShowNewForm] = React.useState(false);

    const STATUS_LABEL: Record<DisputeStatus, string> = {
        [DisputeStatus.OPEN]:         t('status_open'),
        [DisputeStatus.UNDER_REVIEW]: t('status_under_review'),
        [DisputeStatus.ACCEPTED]:     t('status_accepted'),
        [DisputeStatus.REJECTED]:     t('status_rejected'),
        [DisputeStatus.ESCALATED]:    t('status_escalated'),
    };

    const REASON_LABEL: Record<DisputeReason, string> = {
        [DisputeReason.EMISSION_CALCULATION]: t('reason_emission'),
        [DisputeReason.TAX_RATE]:             t('reason_tax_rate'),
        [DisputeReason.ZONE_CLASSIFICATION]:  t('reason_zone'),
        [DisputeReason.VESSEL_DATA]:          t('reason_vessel_data'),
        [DisputeReason.OTHER]:                t('reason_other'),
    };

    const filtered = disputes.filter((d) => {
        const matchTab = tab === 'ALL' || d.status === tab;
        const matchSearch = search === '' ||
            d.vesselName.toLowerCase().includes(search.toLowerCase()) ||
            d.ref.toLowerCase().includes(search.toLowerCase()) ||
            d.transactionRef.toLowerCase().includes(search.toLowerCase());
        return matchTab && matchSearch;
    });

    // KPIs
    const totalCount      = disputes.length;
    const openCount       = disputes.filter((d) => d.status === DisputeStatus.OPEN).length;
    const underReviewCount = disputes.filter((d) => d.status === DisputeStatus.UNDER_REVIEW).length;
    const resolvedCount   = disputes.filter((d) => d.status === DisputeStatus.ACCEPTED || d.status === DisputeStatus.REJECTED).length;

    const isReviewer = role === UserRole.PORT_OFFICER || role === UserRole.FINANCE_ADMIN || role === UserRole.SUPERADMIN;
    const isAgent    = role === UserRole.SHIPPING_AGENT;

    return (
        <div className="flex flex-col" style={{ height: 'calc(100vh - 3.5rem - 2rem)' }}>
            {/* Top KPI bar */}
            <div className="border-b border-[var(--os-border)] px-3 sm:px-5 py-2.5 flex items-center gap-3 sm:gap-6 overflow-x-auto">
                <div className="flex-shrink-0">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('kpi_total')}</p>
                    <p className="text-base font-bold text-[var(--os-text-primary)] tabular-nums">{totalCount}</p>
                </div>
                <div className="flex-shrink-0">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('kpi_open')}</p>
                    <p className="text-base font-bold text-[#F59E0B] tabular-nums">{openCount}</p>
                </div>
                <div className="flex-shrink-0">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('kpi_under_review')}</p>
                    <p className="text-base font-bold text-[#F97316] tabular-nums">{underReviewCount}</p>
                </div>
                <div className="flex-shrink-0 hidden sm:block">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('kpi_resolved')}</p>
                    <p className="text-base font-bold text-[#22C55E] tabular-nums">{resolvedCount}</p>
                </div>
                {isAgent && (
                    <div className="ml-auto flex-shrink-0">
                        <OsButton variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowNewForm(true)}>
                            {t('new_dispute')}
                        </OsButton>
                    </div>
                )}
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Left list */}
                <div className={`w-full sm:w-72 md:w-80 border-r border-[var(--os-border)] flex flex-col flex-shrink-0 ${selected ? 'hidden sm:flex' : 'flex'}`}>
                    {/* Tab filters */}
                    <div className="px-3 pt-3 pb-2 flex gap-1 flex-wrap overflow-x-auto">
                        {(['ALL', DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW, DisputeStatus.ACCEPTED, DisputeStatus.REJECTED] as TabFilter[]).map((f) => (
                            <button
                                key={f}
                                onClick={() => setTab(f)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide transition-all ${
                                    tab === f
                                        ? 'bg-[var(--os-surface-3)] text-[var(--os-text-primary)] border border-[var(--os-border-strong)]'
                                        : 'text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]'
                                }`}
                            >
                                {f === 'ALL' ? t('filter_all') : STATUS_LABEL[f as DisputeStatus]}
                            </button>
                        ))}
                    </div>

                    {/* Search */}
                    <div className="px-3 pb-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('search_placeholder')}
                                className="w-full h-8 pl-8 pr-3 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/50 transition-colors"
                            />
                        </div>
                    </div>

                    {/* Dispute list */}
                    <div className="flex-1 overflow-y-auto divide-y divide-[var(--os-border)]">
                        {filtered.map((d) => {
                            const isSelected = selected?.id === d.id;
                            const date = new Date(d.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                            return (
                                <button
                                    key={d.id}
                                    onClick={() => setSelected(d)}
                                    className={`w-full text-left px-4 py-3 transition-colors ${
                                        isSelected ? 'bg-[var(--os-surface-2)]' : 'hover:bg-[rgba(255,255,255,0.02)]'
                                    }`}
                                >
                                    <div className="flex items-start justify-between mb-1">
                                        <div className="flex items-center gap-1.5">
                                            {STATUS_ICON[d.status]}
                                            <span className="text-[10px] font-mono text-[var(--os-text-muted)]">{d.ref}</span>
                                        </div>
                                        <span className="text-[10px] text-[var(--os-text-muted)]">{date}</span>
                                    </div>
                                    <p className="text-xs font-semibold text-[var(--os-text-primary)] truncate">{d.vesselName}</p>
                                    <div className="flex items-center justify-between mt-1">
                                        <OsBadge variant={DISPUTE_REASON_VARIANT[d.reason]} label={REASON_LABEL[d.reason]} size="sm" />
                                        <span className="text-xs font-bold tabular-nums text-[var(--os-text-primary)]">
                                            ${d.originalAmountUsd.toLocaleString()}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                        {filtered.length === 0 && (
                            <div className="px-4 py-8 text-center text-xs text-[var(--os-text-muted)]">{t('no_disputes_found')}</div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-4 py-2 border-t border-[var(--os-border)] text-[10px] text-[var(--os-text-muted)]">
                        {t('showing_disputes', { from: 1, to: filtered.length, total: disputes.length })}
                    </div>
                </div>

                {/* Right detail */}
                <div className={`flex-1 overflow-y-auto ${selected ? 'flex flex-col' : 'hidden sm:flex'}`}>
                    {selected ? (
                        <>
                            {/* Mobile back button */}
                            <button
                                onClick={() => setSelected(null)}
                                className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] border-b border-[var(--os-border)] sm:hidden"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                {t('filter_all')}
                            </button>
                            <DisputeDetail
                                dispute={selected}
                                statusLabel={STATUS_LABEL}
                                reasonLabel={REASON_LABEL}
                                isReviewer={isReviewer}
                            />
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-[var(--os-text-muted)] text-sm">
                            {t('select_dispute_prompt')}
                        </div>
                    )}
                </div>
            </div>

            {/* New dispute modal */}
            {showNewForm && <DisputeFormModal onClose={() => setShowNewForm(false)} />}
        </div>
    );
}

// ── Dispute Detail Panel ─────────────────────────────────────────────────────

function DisputeDetail({
    dispute: d,
    statusLabel,
    reasonLabel,
    isReviewer,
}: {
    dispute: Dispute;
    statusLabel: Record<DisputeStatus, string>;
    reasonLabel: Record<DisputeReason, string>;
    isReviewer: boolean;
}) {
    const t = useTranslations('Disputes');
    const [reviewNote, setReviewNote] = React.useState('');
    const canReview = isReviewer && (d.status === DisputeStatus.OPEN || d.status === DisputeStatus.UNDER_REVIEW);

    // Timeline entries
    const timeline: { label: string; sub: string; time: string; color: string }[] = [
        {
            label: t('timeline_submitted'),
            sub: d.submittedByName,
            time: new Date(d.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
            color: '#F59E0B',
        },
    ];

    if (d.status !== DisputeStatus.OPEN) {
        timeline.push({
            label: t('timeline_review_started'),
            sub: d.reviewerName ?? t('timeline_system'),
            time: new Date(d.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
            color: '#F97316',
        });
    }

    if (d.status === DisputeStatus.ACCEPTED) {
        timeline.push({
            label: t('timeline_accepted'),
            sub: d.reviewNote ?? '',
            time: new Date(d.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
            color: '#22C55E',
        });
    }

    if (d.status === DisputeStatus.REJECTED) {
        timeline.push({
            label: t('timeline_rejected'),
            sub: d.reviewNote ?? '',
            time: new Date(d.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
            color: '#EF4444',
        });
    }

    return (
        <div className="p-3 sm:p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-[var(--os-text-primary)]">{d.ref}</span>
                        <OsBadge variant={DISPUTE_STATUS_VARIANT[d.status]} label={statusLabel[d.status]} />
                    </div>
                    <p className="text-xs text-[var(--os-text-muted)]">
                        {t('linked_to_invoice', { ref: d.transactionRef })} &middot; {d.vesselName}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <OsBadge variant={DISPUTE_REASON_VARIANT[d.reason]} label={reasonLabel[d.reason]} />
                </div>
            </div>

            {/* Description */}
            <div className="os-card p-5">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">{t('description')}</h4>
                <p className="text-sm text-[var(--os-text-secondary)] leading-relaxed">{d.description}</p>
            </div>

            {/* Amount comparison */}
            <div className="os-card p-5">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-4">{t('amount_details')}</h4>
                <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-sm py-1 border-b border-[var(--os-border)]">
                        <span className="text-[var(--os-text-secondary)]">{t('original_amount')}</span>
                        <span className="font-mono font-medium text-[var(--os-text-primary)]">${d.originalAmountUsd.toLocaleString()}</span>
                    </div>
                    {d.revisedAmountUsd !== null && (
                        <div className="flex justify-between text-sm py-1 border-b border-[var(--os-border)]">
                            <span className="text-[var(--os-text-secondary)]">{t('revised_amount')}</span>
                            <span className="font-mono font-medium text-[#22C55E]">${d.revisedAmountUsd.toLocaleString()}</span>
                        </div>
                    )}
                    {d.revisedAmountUsd !== null && (
                        <div className="flex justify-between items-center pt-2">
                            <span className="text-sm font-bold text-[var(--os-text-primary)]">{t('savings')}</span>
                            <span className="text-xl font-bold text-[#00D97E] tabular-nums">
                                -${(d.originalAmountUsd - d.revisedAmountUsd).toLocaleString()}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Evidence */}
            {d.evidenceUrls.length > 0 && (
                <div className="os-card p-5">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">{t('evidence')}</h4>
                    <div className="flex flex-col gap-2">
                        {d.evidenceUrls.map((url, i) => (
                            <a
                                key={i}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 p-2.5 rounded-xl border border-[var(--os-border)] hover:border-[var(--os-border-strong)] hover:bg-[var(--os-surface-2)] transition-all text-xs"
                            >
                                <FileText className="w-4 h-4 text-[var(--os-text-muted)]" />
                                <span className="flex-1 text-[#38BDF8] truncate">{url.split('/').pop()}</span>
                                <ExternalLink className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* Timeline */}
            <div className="os-card p-5">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-4">{t('timeline')}</h4>
                <div className="flex flex-col gap-3">
                    {timeline.map(({ label, sub, time, color }) => (
                        <div key={label + time} className="flex items-start gap-3">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: `${color}14` }}>
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                            </div>
                            <div className="flex-1">
                                <p className="text-xs font-semibold text-[var(--os-text-primary)]">{label}</p>
                                <p className="text-[10px] text-[var(--os-text-muted)]">{sub}</p>
                            </div>
                            <span className="text-[10px] text-[var(--os-text-muted)] flex-shrink-0">{time}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Review note (if resolved) */}
            {d.reviewNote && (
                <div className="os-card p-5">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">{t('reviewer_note')}</h4>
                    <p className="text-sm text-[var(--os-text-secondary)] leading-relaxed">{d.reviewNote}</p>
                    <p className="text-[10px] text-[var(--os-text-muted)] mt-2">&mdash; {d.reviewerName}</p>
                </div>
            )}

            {/* Reviewer actions */}
            {canReview && (
                <div className="os-card p-5">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">{t('review_actions')}</h4>
                    <textarea
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        placeholder={t('review_note_placeholder')}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/50 transition-colors resize-none mb-3"
                    />
                    <div className="flex items-center gap-2">
                        <OsButton variant="primary" size="sm" icon={<CheckCircle className="w-3.5 h-3.5" />}>
                            {t('accept_dispute')}
                        </OsButton>
                        <OsButton variant="danger" size="sm" icon={<XCircle className="w-3.5 h-3.5" />}>
                            {t('reject_dispute')}
                        </OsButton>
                    </div>
                </div>
            )}
        </div>
    );
}
