'use client';

import * as React from 'react';
import { Ship, DollarSign, Wind, Leaf, TrendingUp, TrendingDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DashboardKpis } from '@/types/secure';

function formatUsd(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}K`;
    return `$${n}`;
}

function formatNum(n: number): string {
    return n.toLocaleString('en-US');
}

interface KpiCardProps {
    label: string;
    value: string;
    sub: string;
    delta?: number;
    deltaLabel?: string;
    icon: React.ReactNode;
    accentColor: string;
    tag?: string;
    tagColor?: string;
}

function KpiCard({ label, value, sub, delta, deltaLabel, icon, accentColor, tag, tagColor }: KpiCardProps) {
    const isPositive = delta !== undefined && delta >= 0;
    return (
        <div className="os-card p-5 flex flex-col gap-3 relative overflow-hidden">
            {/* Accent bar top */}
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: accentColor }} />

            <div className="flex items-start justify-between">
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{label}</p>
                    {tag && (
                        <span
                            className="inline-block mt-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md"
                            style={{ backgroundColor: `${tagColor}18`, color: tagColor, border: `1px solid ${tagColor}28` }}
                        >
                            {tag}
                        </span>
                    )}
                </div>
                <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${accentColor}14` }}
                >
                    <span style={{ color: accentColor }}>{icon}</span>
                </div>
            </div>

            <div>
                <p className="text-3xl font-bold tabular-nums" style={{ color: accentColor }}>{value}</p>
                <p className="text-xs text-[var(--os-text-muted)] mt-0.5">{sub}</p>
            </div>

            {delta !== undefined && (
                <div className={`flex items-center gap-1 text-xs font-semibold ${isPositive ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                    {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {isPositive ? '+' : ''}{delta}% {deltaLabel}
                </div>
            )}
        </div>
    );
}

export function DashboardKpiRow({ kpis }: { kpis: DashboardKpis }) {
    const t = useTranslations('Overview');

    return (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard
                label={t('kpi_active_vessels')}
                value={formatNum(kpis.activeVesselsInEez)}
                sub={t('kpi_high_density')}
                icon={<Ship className="w-5 h-5" />}
                accentColor="#38BDF8"
                tag={t('kpi_tag_live')}
                tagColor="#38BDF8"
            />
            <KpiCard
                label={t('kpi_tax_revenue')}
                value={formatUsd(kpis.monthlyRevenueUsd)}
                sub={t('kpi_on_target')}
                delta={kpis.monthlyRevenueDelta}
                deltaLabel={t('kpi_vs_last_month')}
                icon={<DollarSign className="w-5 h-5" />}
                accentColor="#00D97E"
                tag={t('kpi_tag_collection_day')}
                tagColor="#00D97E"
            />
            <KpiCard
                label={t('kpi_est_emissions')}
                value={formatNum(kpis.estCo2TrackingTons)}
                sub={t('kpi_mtd_tracking')}
                deltaLabel={t('kpi_vs_last_month')}
                icon={<Wind className="w-5 h-5" />}
                accentColor="#F59E0B"
                tag={t('kpi_tag_threshold')}
                tagColor="#F59E0B"
            />
            <KpiCard
                label={t('kpi_carbon_credits')}
                value={formatNum(kpis.creditsRetiredTons)}
                sub={t('kpi_avg_price')}
                icon={<Leaf className="w-5 h-5" />}
                accentColor="#A78BFA"
                tag={t('kpi_tag_price_unit')}
                tagColor="#A78BFA"
            />
        </div>
    );
}
