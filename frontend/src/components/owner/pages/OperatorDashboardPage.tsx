// Reusable server component for the operator overview (4 stat cards + quick-actions).
// Used by /owner/dashboard (via thin wrapper) and /dashboard when the principal
// is an operator. Fetches via principal.supabase (RLS-scoped).
// Quick-action links point to /dashboard/* (shell-unified URLs).

import { Ship, AlertTriangle, FileText, TrendingUp } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Principal } from '@/lib/auth/requirePrincipal';
import { OsStatCard } from '@/components/ui/OsStatCard';
import { getOwnerCounters, formatUsd } from '@/services/ownerPortalService';
import { KycCBanner } from '@/components/owner/KycCBanner';

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
}

export async function OperatorDashboardPage({ principal }: Props) {
    const counters = await getOwnerCounters(principal.supabase);
    const t = await getTranslations('OwnerPortal.dashboard');

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <KycCBanner kycComplete={!!principal.shipowner.kyc_level_c_completed_at} />
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">
                    {principal.shipowner.name}
                </h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">
                    {t('subtitle')}
                </p>
            </header>

            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <OsStatCard
                    label={t('stat.activeVessels')}
                    value={String(counters.activeVessels)}
                    icon={<Ship className="w-4 h-4" />}
                />
                <OsStatCard
                    label={t('stat.openAlerts')}
                    value={String(counters.openAlerts)}
                    icon={<AlertTriangle className="w-4 h-4" />}
                />
                <OsStatCard
                    label={t('stat.unpaidProforma')}
                    value={formatUsd(counters.unpaidProformaUsd)}
                    icon={<FileText className="w-4 h-4" />}
                    highlight={counters.unpaidProformaUsd > 0}
                />
                <OsStatCard
                    label={t('stat.paidYtd')}
                    value={formatUsd(counters.paidYtdUsd)}
                    icon={<TrendingUp className="w-4 h-4" />}
                />
            </section>

            <section className="os-card p-6">
                <h2 className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                    {t('quickActions')}
                </h2>
                <p className="text-sm text-[var(--os-text-muted)]">
                    {t.rich('quickActionsBody', {
                        vessels: (chunks) => (
                            <a href="/dashboard/vessels" className="text-emerald-400 hover:underline">
                                {chunks}
                            </a>
                        ),
                        invoices: (chunks) => (
                            <a href="/dashboard/invoices" className="text-emerald-400 hover:underline">
                                {chunks}
                            </a>
                        ),
                        alerts: (chunks) => (
                            <a href="/dashboard/alerts" className="text-emerald-400 hover:underline">
                                {chunks}
                            </a>
                        ),
                    })}
                </p>
            </section>
        </div>
    );
}
