import type { SupabaseClient } from '@supabase/supabase-js';
import type {
    JurisdictionRow, JurisdictionModeConfigRow, TariffRow, SplitRuleRow, SettlementRow, JurisdictionBillingCcRow,
} from '@/components/dashboard/admin/AdminJurisdictions';
import type { IssuerProfileRow } from '@/components/dashboard/admin/IssuerProfilePanel';

export interface JurisdictionSettings {
    jurisdictions: JurisdictionRow[];
    modeConfigs: JurisdictionModeConfigRow[];
    tariffs: TariffRow[];
    splitRules: SplitRuleRow[];
    settlement: SettlementRow[];
    ccByJurisdiction: Record<string, { cc_emails: string[]; bailiff_cc_emails: string[] }>;
    issuerProfiles: IssuerProfileRow[];
}

/**
 * Tout ce que les volets Fiscalité et Documents affichent. Extrait de
 * l'ancienne page /admin/jurisdictions, à l'identique : registre, matrice des
 * modes, barèmes versionnés, règles de répartition, règlement, copies, profil
 * émetteur. Client plateforme : ces tables sont le référentiel de la
 * plateforme, pas un périmètre de juridiction.
 */
export async function loadJurisdictionSettings(platform: SupabaseClient): Promise<JurisdictionSettings> {
    const [jurisdictionsRes, modeConfigsRes, tariffsRes, splitRulesRes, settlementRes, billingCcRes, issuerProfilesRes] = await Promise.all([
        platform.from('jurisdictions').select('id, code, name, default_currency, locales, status').order('code'),
        platform.from('jurisdiction_mode_config').select('jurisdiction_id, mode, enabled, activated_at'),
        platform
            .from('tariffs')
            .select('id, jurisdiction_id, mode, asset_category, rate_per_tco2, currency, effective_from, effective_to, status, decree_ref')
            .order('jurisdiction_id').order('mode').order('effective_from', { ascending: false }),
        platform
            .from('revenue_split_rule')
            .select('id, jurisdiction_id, concessionaire_pct, sovereign_pct, contract_ref, effective_from, effective_to')
            .is('effective_to', null)
            .order('effective_from', { ascending: false }),
        platform.from('v_revenue_split_settlement').select('*').order('month', { ascending: false }),
        platform.from('jurisdiction_billing_cc').select('jurisdiction_id, cc_emails, bailiff_cc_emails'),
        platform.from('jurisdiction_issuer_profile').select('*'),
    ]);

    const failed = [
        ['jurisdictions', jurisdictionsRes.error], ['mode configs', modeConfigsRes.error], ['tariffs', tariffsRes.error],
        ['split rules', splitRulesRes.error], ['settlement', settlementRes.error], ['recovery CC lists', billingCcRes.error],
        ['issuer profiles', issuerProfilesRes.error],
    ].find(([, e]) => e);
    if (failed) throw new Error(`Failed to load ${failed[0]}: ${(failed[1] as { message: string }).message}`);

    const ccByJurisdiction: JurisdictionSettings['ccByJurisdiction'] = {};
    for (const row of (billingCcRes.data ?? []) as JurisdictionBillingCcRow[]) {
        ccByJurisdiction[row.jurisdiction_id] = {
            cc_emails: row.cc_emails ?? [],
            bailiff_cc_emails: row.bailiff_cc_emails ?? [],
        };
    }

    return {
        jurisdictions: (jurisdictionsRes.data ?? []) as JurisdictionRow[],
        modeConfigs: (modeConfigsRes.data ?? []) as JurisdictionModeConfigRow[],
        tariffs: (tariffsRes.data ?? []) as TariffRow[],
        splitRules: (splitRulesRes.data ?? []) as SplitRuleRow[],
        settlement: (settlementRes.data ?? []) as SettlementRow[],
        ccByJurisdiction,
        issuerProfiles: (issuerProfilesRes.data ?? []) as unknown as IssuerProfileRow[],
    };
}
