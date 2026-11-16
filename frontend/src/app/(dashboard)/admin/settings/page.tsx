import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getAdminScope } from '@/lib/auth/jurisdictionAdmin';
import { listConfigByPrefix, type AppConfigEntry } from '@/services/appConfigService';
import { loadJurisdictionSettings } from '@/services/jurisdictionSettingsLoader';
import { AdminJurisdictions } from '@/components/dashboard/admin/AdminJurisdictions';
import { IssuerProfilePanel } from '@/components/dashboard/admin/IssuerProfilePanel';
import { PaymentProvidersPanel } from '@/components/dashboard/admin/PaymentProvidersPanel';
import { CarbonTaxPipelineSection } from '@/components/dashboard/tax/CarbonTaxPipelineSection';
import {
    PIPELINE_KEYS_BY_TAB, SETTINGS_TABS, SUPERADMIN_ONLY_TABS, parseSettingsTab, type SettingsTab,
} from '@/lib/admin/settingsTabs';

export const metadata: Metadata = {
    title: 'Settings | Green Gate',
    description: 'Tariffs, documents, reminders, detection, owner portal and system settings, one intent per tab.',
};

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPERADMIN', 'FINANCE_ADMIN', 'PORT_OFFICER']);
const PIPELINE_PREFIXES = ['carbon_tax.', 'arrival.', 'reconciliation.', 'owner_escalation.', 'proforma.', 'feature.', 'queue.'];

/**
 * Hub des réglages : six volets par intention (voir lib/admin/settingsTabs).
 *
 * Les panneaux existants sont déménagés, pas réécrits : barèmes et
 * juridictions, profil émetteur, éditeur de clés (borné au volet), fournisseurs
 * de paiement. Les anciennes URL redirigent ici. PORT_OFFICER lit sans
 * modifier (règle RBAC existante) ; Système n'existe que pour le SUPERADMIN.
 */
export default async function AdminSettingsRoute({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    const role = profile?.role as string | undefined;
    if (!role || !ALLOWED_ROLES.has(role)) redirect('/dashboard');

    const { tab: rawTab } = await searchParams;
    let tab = parseSettingsTab(rawTab);
    if (SUPERADMIN_ONLY_TABS.has(tab) && role !== 'SUPERADMIN') tab = 'fiscalite';

    const canEdit = role === 'SUPERADMIN';
    const t = await getTranslations('AdminSettings');
    const platform = createPlatformClient();
    // Pays que la personne administre (mig 174) : elle y modifie tarifs et profil
    // quel que soit son role. Le droit est reverifie par chaque action.
    const administeredJurisdictionIds = role === 'SUPERADMIN'
        ? []
        : (await getAdminScope(platform, auth.user.id, role)).jurisdictionIds;

    const visibleTabs = SETTINGS_TABS.filter((k) => role === 'SUPERADMIN' || !SUPERADMIN_ONLY_TABS.has(k));

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-1 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-sm text-[var(--os-text-muted)] mb-5">{t('subtitle')}</p>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
                <nav aria-label={t('title')} className="flex flex-row flex-wrap gap-1.5 lg:flex-col lg:gap-1">
                    {visibleTabs.map((k) => {
                        const active = k === tab;
                        return (
                            <Link
                                key={k}
                                href={`/admin/settings?tab=${k}`}
                                aria-current={active ? 'page' : undefined}
                                className={`rounded-[10px] px-3 py-2 text-[13px] transition-colors ${
                                    active
                                        ? 'bg-[var(--os-surface-2)] font-semibold text-[var(--os-text-primary)] border border-[var(--os-border-strong)]'
                                        : 'text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-2)] border border-transparent'
                                }`}
                            >
                                <span className="block">{t(`tab.${k}.label`)}</span>
                                <span className="hidden text-[11px] font-normal text-[var(--os-text-muted)] lg:block">
                                    {t(`tab.${k}.hint`)}
                                </span>
                            </Link>
                        );
                    })}
                </nav>

                <section className="min-w-0 flex flex-col gap-5">
                    <TabContent
                        tab={tab} role={role} canEdit={canEdit} platform={platform} supabase={supabase}
                        administeredJurisdictionIds={administeredJurisdictionIds}
                    />
                </section>
            </div>
        </div>
    );
}

async function TabContent({
    tab, role, canEdit, platform, supabase, administeredJurisdictionIds,
}: {
    tab: SettingsTab; role: string; canEdit: boolean; administeredJurisdictionIds: string[];
    platform: ReturnType<typeof createPlatformClient>; supabase: Awaited<ReturnType<typeof createClient>>;
}) {
    const t = await getTranslations('AdminSettings');
    const keys = PIPELINE_KEYS_BY_TAB[tab];

    let entries: AppConfigEntry[] = [];
    if (keys.length > 0) {
        try {
            entries = await listConfigByPrefix(supabase, PIPELINE_PREFIXES);
        } catch {
            entries = [];
        }
    }

    const pipeline = keys.length > 0 ? (
        <CarbonTaxPipelineSection
            entries={entries}
            canEdit={canEdit}
            keys={[...keys]}
            title={t(`tab.${tab}.label`)}
            subtitle={t(`tab.${tab}.hint`)}
        />
    ) : null;

    if (tab === 'fiscalite' || tab === 'documents') {
        const data = await loadJurisdictionSettings(platform);
        if (tab === 'fiscalite') {
            return (
                <AdminJurisdictions
                    jurisdictions={data.jurisdictions}
                    modeConfigs={data.modeConfigs}
                    tariffs={data.tariffs}
                    splitRules={data.splitRules}
                    settlement={data.settlement}
                    viewerRole={role}
                    administeredJurisdictionIds={administeredJurisdictionIds}
                    ccByJurisdiction={data.ccByJurisdiction}
                />
            );
        }
        return (
            <>
                <IssuerProfilePanel
                    jurisdictions={data.jurisdictions.map((j) => ({ id: j.id, code: j.code, name: j.name }))}
                    profiles={data.issuerProfiles}
                    viewerRole={role}
                    administeredJurisdictionIds={administeredJurisdictionIds}
                />
                {pipeline}
            </>
        );
    }

    if (tab === 'portail') {
        // Le panneau des fournisseurs interroge une API réservée à la finance :
        // un PORT_OFFICER n'y verrait qu'une erreur.
        const canSeeProviders = role === 'SUPERADMIN' || role === 'FINANCE_ADMIN';
        return (
            <>
                {pipeline}
                {canSeeProviders && <PaymentProvidersPanel />}
            </>
        );
    }

    return pipeline;
}
