'use client';

import { DashboardKpiRow } from '@/components/dashboard/overview/DashboardKpiRow';
import { LiveMapPanel } from '@/components/dashboard/overview/LiveMapPanel';
import { RecentActivitiesTable } from '@/components/dashboard/overview/RecentActivitiesTable';
import { PendingActionsPanel } from '@/components/dashboard/overview/PendingActionsPanel';
import { useKpis } from '@/hooks/useKpis';

export default function DashboardPage() {
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
