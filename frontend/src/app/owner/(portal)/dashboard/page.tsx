import { Ship, AlertTriangle, FileText, TrendingUp } from 'lucide-react';
import { requireOwner } from '@/lib/auth/requireOwner';
import { OsStatCard } from '@/components/ui/OsStatCard';
import { getOwnerCounters, formatUsd } from '@/services/ownerPortalService';

export const metadata = {
    title: 'Owner portal — dashboard',
};

export const dynamic = 'force-dynamic';

export default async function OwnerDashboardPage() {
    const session = await requireOwner();
    const counters = await getOwnerCounters(session.supabase);

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">
                    {session.shipowner.name}
                </h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">
                    Snapshot of your fleet and obligations.
                </p>
            </header>

            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <OsStatCard
                    label="Active vessels"
                    value={String(counters.activeVessels)}
                    icon={<Ship className="w-4 h-4" />}
                />
                <OsStatCard
                    label="Open alerts"
                    value={String(counters.openAlerts)}
                    icon={<AlertTriangle className="w-4 h-4" />}
                />
                <OsStatCard
                    label="Unpaid pro-formas"
                    value={formatUsd(counters.unpaidProformaUsd)}
                    icon={<FileText className="w-4 h-4" />}
                    highlight={counters.unpaidProformaUsd > 0}
                />
                <OsStatCard
                    label="Paid YTD"
                    value={formatUsd(counters.paidYtdUsd)}
                    icon={<TrendingUp className="w-4 h-4" />}
                />
            </section>

            <section className="os-card p-6">
                <h2 className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                    Quick actions
                </h2>
                <p className="text-sm text-[var(--os-text-muted)]">
                    Use the navigation above to explore your{' '}
                    <a href="/owner/vessels" className="text-emerald-400 hover:underline">
                        vessels
                    </a>
                    , review{' '}
                    <a href="/owner/invoices" className="text-emerald-400 hover:underline">
                        invoices
                    </a>
                    , or check active{' '}
                    <a href="/owner/alerts" className="text-emerald-400 hover:underline">
                        alerts
                    </a>
                    .
                </p>
            </section>
        </div>
    );
}
