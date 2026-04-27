'use client';

import * as React from 'react';
import { FileText, Leaf, ArrowRight, AlertTriangle, CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useVessels } from '@/hooks/useVessels';
import { useKpis } from '@/hooks/useKpis';
import { useRole } from '@/lib/RoleContext';
import { UserRole, VesselComplianceStatus } from '@/types/secure';

export function PendingActionsPanel() {
    const t = useTranslations('Overview');
    const { role } = useRole();
    const { data: vessels } = useVessels();
    const { data: kpis } = useKpis();
    const isArmateur = role === UserRole.SHIPPING_AGENT;
    const unpaid = vessels.filter(
        (v) => v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE ||
               v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT
    );

    // Armateur view: pay-due vessels only. No sovereign protocol/decree work,
    // no government carbon projects, no staff alert summary — those concern
    // the authority side. Hide the whole right column when there's nothing
    // pending so we don't render an empty card.
    if (isArmateur) {
        if (unpaid.length === 0) return null;
        return (
            <div className="flex flex-col gap-4">
                <div className="os-card p-3 sm:p-5">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-4">{t('pending_actions_title')}</h3>
                    <div className="flex flex-col gap-2">
                        {unpaid.map((v) => (
                            <ActionItem
                                key={v.id}
                                icon={<CreditCard className="w-4 h-4" />}
                                title={t('action_pay_proforma_for', { name: v.name })}
                                sub={t('action_proforma_sub', { amount: v.taxLiabilityUsd.toLocaleString(), imo: v.imoNumber })}
                                href={`/dashboard/invoices?vessel=${v.imoNumber}`}
                                color="#EF4444"
                            />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Pending Actions card */}
            <div className="os-card p-3 sm:p-5">
                <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-4">{t('pending_actions_title')}</h3>
                <div className="flex flex-col gap-2">
                    <ActionItem
                        icon={<FileText className="w-4 h-4" />}
                        title={t('action_sign_mou')}
                        sub={t('action_sign_mou_sub')}
                        href="/dashboard/reports"
                        color="#38BDF8"
                    />
                    <ActionItem
                        icon={<Leaf className="w-4 h-4" />}
                        title={t('action_adopt_decree')}
                        sub={t('action_adopt_decree_sub')}
                        href="/dashboard/projects"
                        color="#00D97E"
                    />
                    {unpaid.map((v) => (
                        <ActionItem
                            key={v.id}
                            icon={<AlertTriangle className="w-4 h-4" />}
                            title={t('action_generate_proforma', { name: v.name })}
                            sub={t('action_proforma_sub', { amount: v.taxLiabilityUsd.toLocaleString(), imo: v.imoNumber })}
                            href={`/dashboard/invoices?vessel=${v.imoNumber}`}
                            color="#EF4444"
                        />
                    ))}
                </div>
            </div>

            {/* Project Certification mini */}
            <div className="os-card p-3 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('project_certification_title')}</h3>
                    <span className="text-[10px] font-bold text-[#22C55E] bg-[rgba(34,197,94,0.08)] px-2 py-0.5 rounded-full border border-[#22C55E]/20">
                        74%
                    </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 rounded-full bg-[var(--os-surface-3)] mb-3">
                    <div className="h-full rounded-full bg-[#22C55E] transition-all" style={{ width: '74%' }} />
                </div>

                <div className="flex flex-col gap-3">
                    <ProjectMini
                        name={t('project_mangrove')}
                        sub={t('project_mangrove_sub')}
                        progress={74}
                        status={t('project_status_on_track')}
                        statusColor="#22C55E"
                    />
                    <ProjectMini
                        name={t('project_solar')}
                        sub={t('project_solar_sub')}
                        progress={38}
                        status={t('project_status_active')}
                        statusColor="#38BDF8"
                    />
                </div>

                <a href="/dashboard/projects" className="flex items-center gap-1 mt-4 text-xs font-semibold text-[#38BDF8] hover:underline">
                    {t('manage_projects')} <ArrowRight className="w-3 h-3" />
                </a>
            </div>

            {/* Alert summary */}
            <div className="os-card p-4 border-l-2 border-l-[#EF4444]">
                <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                    <span className="text-xs font-bold text-[#EF4444] uppercase tracking-wide">
                        {t('alert_non_compliant', { count: kpis.nonCompliantCount })}
                    </span>
                </div>
                <p className="text-[11px] text-[var(--os-text-muted)]">
                    {t('alert_review_pending', { count: kpis.pendingReviewCount })}
                </p>
                <a href="/dashboard/alerts" className="text-xs text-[#EF4444] font-semibold mt-2 inline-block hover:underline">
                    {t('alert_view_alerts')}
                </a>
            </div>
        </div>
    );
}

function ActionItem({ icon, title, sub, href, color }: { icon: React.ReactNode; title: string; sub: string; href: string; color: string }) {
    return (
        <a
            href={href}
            className="flex items-start gap-3 p-3 rounded-xl border border-[var(--os-border)] hover:border-[var(--os-border-strong)] hover:bg-[var(--os-surface-2)] transition-all group"
        >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}14`, color }}>
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[var(--os-text-primary)] truncate">{title}</p>
                <p className="text-[10px] text-[var(--os-text-muted)] truncate">{sub}</p>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[var(--os-text-muted)] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
        </a>
    );
}

function ProjectMini({ name, sub, progress, status, statusColor }: { name: string; sub: string; progress: number; status: string; statusColor: string }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[var(--os-text-primary)]">{name}</p>
                <span className="text-[9px] font-bold uppercase" style={{ color: statusColor }}>{status}</span>
            </div>
            <p className="text-[10px] text-[var(--os-text-muted)]">{sub}</p>
            <div className="w-full h-1 rounded-full bg-[var(--os-surface-3)]">
                <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: statusColor }} />
            </div>
        </div>
    );
}
