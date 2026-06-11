import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { AdminJurisdictions } from '@/components/dashboard/admin/AdminJurisdictions';
import type { JurisdictionRow, JurisdictionModeConfigRow, TariffRow, SplitRuleRow, SettlementRow } from '@/components/dashboard/admin/AdminJurisdictions';

export const metadata: Metadata = {
    title: 'Jurisdictions | Green Gate',
    description: 'Registry, mode activation matrix, and versioned tariff management per jurisdiction.',
};

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPERADMIN', 'FINANCE_ADMIN', 'PORT_OFFICER']);

export default async function AdminJurisdictionsRoute() {
    const supabase = await createClient();

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile?.role || !ALLOWED_ROLES.has(profile.role)) {
        redirect('/dashboard');
    }

    const platform = createPlatformClient();

    const [jurisdictionsRes, modeConfigsRes, tariffsRes, splitRulesRes, settlementRes] = await Promise.all([
        platform
            .from('jurisdictions')
            .select('id, code, name, default_currency, locales, status')
            .order('code'),
        platform
            .from('jurisdiction_mode_config')
            .select('jurisdiction_id, mode, enabled, activated_at'),
        platform
            .from('tariffs')
            .select('id, jurisdiction_id, mode, asset_category, rate_per_tco2, currency, effective_from, effective_to, status, decree_ref')
            .order('jurisdiction_id')
            .order('mode')
            .order('effective_from', { ascending: false }),
        platform
            .from('revenue_split_rule')
            .select('id, jurisdiction_id, concessionaire_pct, sovereign_pct, contract_ref, effective_from, effective_to')
            .is('effective_to', null)
            .order('effective_from', { ascending: false }),
        platform
            .from('v_revenue_split_settlement')
            .select('*')
            .order('month', { ascending: false }),
    ]);

    if (jurisdictionsRes.error) {
        throw new Error(`Failed to load jurisdictions: ${jurisdictionsRes.error.message}`);
    }
    if (modeConfigsRes.error) {
        throw new Error(`Failed to load mode configs: ${modeConfigsRes.error.message}`);
    }
    if (tariffsRes.error) {
        throw new Error(`Failed to load tariffs: ${tariffsRes.error.message}`);
    }
    if (splitRulesRes.error) {
        throw new Error(`Failed to load split rules: ${splitRulesRes.error.message}`);
    }
    if (settlementRes.error) {
        throw new Error(`Failed to load settlement data: ${settlementRes.error.message}`);
    }

    return (
        <div className="px-6 py-4">
            <AdminJurisdictions
                jurisdictions={(jurisdictionsRes.data ?? []) as JurisdictionRow[]}
                modeConfigs={(modeConfigsRes.data ?? []) as JurisdictionModeConfigRow[]}
                tariffs={(tariffsRes.data ?? []) as TariffRow[]}
                splitRules={(splitRulesRes.data ?? []) as SplitRuleRow[]}
                settlement={(settlementRes.data ?? []) as SettlementRow[]}
                viewerRole={profile.role}
            />
        </div>
    );
}
