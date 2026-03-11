import type { Metadata } from 'next';
import { DashboardKpiRow } from '@/components/dashboard/overview/DashboardKpiRow';
import { LiveMapPanel } from '@/components/dashboard/overview/LiveMapPanel';
import { RecentActivitiesTable } from '@/components/dashboard/overview/RecentActivitiesTable';
import { PendingActionsPanel } from '@/components/dashboard/overview/PendingActionsPanel';
import { mockKpis } from '@/mock/datas/secureMock';

export const metadata: Metadata = {
    title: 'Command Center | Africgreen',
    description: 'Live maritime carbon monitoring and command center.',
};

export default function DashboardPage() {
    return (
        <div className="p-5 flex flex-col gap-5">
            {/* Header */}
            <div>
                <h1 className="text-xl font-bold text-[var(--os-text-primary)]">Dashboard Overview</h1>
                <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                    Real-time monitoring of maritime carbon taxe collection.
                </p>
            </div>

            {/* KPI Row */}
            <DashboardKpiRow kpis={mockKpis} />

            {/* Map + Right panel */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <div className="xl:col-span-2">
                    <LiveMapPanel />
                </div>
                <div>
                    <PendingActionsPanel />
                </div>
            </div>

            {/* Recent activity */}
            <RecentActivitiesTable />
        </div>
    );
}
