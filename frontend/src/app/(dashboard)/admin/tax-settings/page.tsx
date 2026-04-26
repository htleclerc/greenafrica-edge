import type { Metadata } from 'next';
import { CarbonTaxSettingsPage } from '@/components/dashboard/tax/CarbonTaxSettingsPage';
import { CarbonTaxPipelineSection } from '@/components/dashboard/tax/CarbonTaxPipelineSection';
import { createClient } from '@/lib/supabase/server';
import {
    listConfigByPrefix,
    type AppConfigEntry,
} from '@/services/appConfigService';

export const metadata: Metadata = {
    title: 'Carbon Tax Settings | Green Gate',
    description:
        'Configure maritime carbon tax rates, monitor collection, and manage exemptions.',
};

// Refresh on every request — entries are edited in-place and we want to see
// the new value after a server-action round-trip.
export const dynamic = 'force-dynamic';

const PIPELINE_PREFIXES = [
    'carbon_tax.',
    'arrival.',
    'reconciliation.',
    'owner_escalation.',
    'proforma.',
    'feature.',
    'queue.',
];

export default async function TaxSettingsRoute() {
    const supabase = await createClient();

    let entries: AppConfigEntry[] = [];
    try {
        entries = await listConfigByPrefix(supabase, PIPELINE_PREFIXES);
    } catch {
        // Surface an empty section rather than crash the whole settings page.
        entries = [];
    }

    let role: string | null = null;
    const { data: auth } = await supabase.auth.getUser();
    if (auth?.user) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', auth.user.id)
            .maybeSingle();
        role = (profile?.role as string | undefined) ?? null;
    }
    const canEdit = role === 'SUPERADMIN';

    return (
        <div className="flex flex-col gap-5">
            <CarbonTaxSettingsPage />
            <div className="px-3 sm:px-5 pb-5">
                <CarbonTaxPipelineSection entries={entries} canEdit={canEdit} />
            </div>
        </div>
    );
}
