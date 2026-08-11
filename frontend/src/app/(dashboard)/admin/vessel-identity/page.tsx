import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { isValidImo } from '@/services/vesselIdentity/imo';
import VesselIdentityPanel, { type UnidentifiedVessel, type Candidate } from './VesselIdentityPanel';

export const metadata: Metadata = {
    title: 'Vessel Identity | Green Gate',
    description: 'Match unidentified vessels to real vessels from a VesselFinder port-call export.',
};

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export default async function VesselIdentityPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) redirect('/dashboard');

    const admin = createPlatformClient();

    // Les navires non identifiés ne se filtrent pas en SQL : le prédicat est la
    // somme de contrôle IMO, pas un motif textuel. On charge puis on filtre.
    const { data: vessels } = await admin
        .from('vessels')
        .select('id, imo_number, name, shipowner_id, shipowner:shipowners(name)')
        .order('name');
    const unidentified = ((vessels ?? []) as unknown as UnidentifiedVessel[]).filter(
        (v) => !isValidImo(String(v.imo_number)),
    );

    const { data: candidates } = await admin
        .from('vessel_identity_candidates')
        .select('*')
        .eq('status', 'PENDING')
        .order('vessel_name');

    const t = await getTranslations('AdminVesselIdentity');

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <VesselIdentityPanel unidentified={unidentified} candidates={(candidates ?? []) as unknown as Candidate[]} />
        </div>
    );
}
