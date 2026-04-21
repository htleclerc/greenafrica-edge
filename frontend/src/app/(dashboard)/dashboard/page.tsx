'use client';

import { useTranslations } from 'next-intl';
import { DashboardKpiRow } from '@/components/dashboard/overview/DashboardKpiRow';
import { LiveMapPanel } from '@/components/dashboard/overview/LiveMapPanel';
import { RecentActivitiesTable } from '@/components/dashboard/overview/RecentActivitiesTable';
import { PendingActionsPanel } from '@/components/dashboard/overview/PendingActionsPanel';
import { NextPaymentCard } from '@/components/dashboard/overview/NextPaymentCard';
import { ArmateurKpiRow } from '@/components/dashboard/overview/ArmateurKpiRow';
import { OnboardingBanner } from '@/components/dashboard/overview/OnboardingBanner';
import { OverdueBanner } from '@/components/dashboard/overview/OverdueBanner';
import { useKpis, useArmateurKpis } from '@/hooks/useKpis';
import { useRole } from '@/lib/RoleContext';
import { UserRole } from '@/types/secure';

export default function DashboardPage() {
    const { role } = useRole();
    const isArmateur = role === UserRole.SHIPPING_AGENT;
    return isArmateur ? <ArmateurDashboard /> : <StaffDashboard />;
}

// ── Staff (PORT_OFFICER, FINANCE_ADMIN, SUPERADMIN, MANAGER) ─────────────────

function StaffDashboard() {
    const { data: kpis } = useKpis();

    return (
        <div className="p-5 flex flex-col gap-5">
            <div>
                <h1 className="text-xl font-bold text-[var(--os-text-primary)]">Dashboard Overview</h1>
                <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                    Real-time monitoring of maritime carbon taxe collection.
                </p>
            </div>
            <DashboardKpiRow kpis={kpis} />
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <div className="xl:col-span-2">
                    <LiveMapPanel />
                </div>
                <div>
                    <PendingActionsPanel />
                </div>
            </div>
            <RecentActivitiesTable />
        </div>
    );
}

// ── Armateur (SHIPPING_AGENT) ────────────────────────────────────────────────

function ArmateurDashboard() {
    const t = useTranslations('ArmateurDashboard');
    const { user } = useRole();
    const { data: kpis, loading } = useArmateurKpis();
    const hasVessels = kpis.vesselsActive > 0;
    const hasOverdue = kpis.overdueCount > 0;

    return (
        <div className="p-5 flex flex-col gap-5">
            <div>
                <h1 className="text-xl font-bold text-[var(--os-text-primary)]">
                    {t('title')}
                </h1>
                <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                    {t('sub', {
                        company: user.fullName || user.email,
                        count: kpis.vesselsActive,
                    })}
                </p>
            </div>

            {!hasVessels && <OnboardingBanner />}
            {hasOverdue && (
                <OverdueBanner
                    overdueCount={kpis.overdueCount}
                    overdueTotalUsd={kpis.outstandingTotalUsd}
                />
            )}

            {/*
              Armateur anatomy: NextPaymentCard dominates the main column (2/3),
              ArmateurKpiRow stacks vertically in the right column (1/3). On
              mobile/tablet (<xl), NextPayment comes first, KPIs collapse below
              in a 2×2 grid.
            */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <div className="xl:col-span-2">
                    <NextPaymentCard />
                </div>
                <div>
                    <ArmateurKpiRow kpis={kpis} loading={loading} />
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <div className="xl:col-span-2">
                    <LiveMapPanel />
                </div>
                <div>
                    <PendingActionsPanel />
                </div>
            </div>

            <RecentActivitiesTable />
        </div>
    );
}
