import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { listUnclaimedAlerts } from '@/services/arrivalAlertService';
import { IncomingVesselsList } from './IncomingVesselsList';

export const metadata = {
    title: 'Incoming Vessels | Green Gate',
    description: 'Vessels approaching Somaliland ports, awaiting agent claim and pro-forma issuance.',
};

export default async function IncomingVesselsPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();

    if (profile?.role !== 'SHIPPING_AGENT' && profile?.role !== 'SUPERADMIN') {
        redirect('/dashboard');
    }

    const alerts = await listUnclaimedAlerts(supabase);
    const t = await getTranslations('IncomingVessels');

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-sm text-[var(--os-text-muted)] mb-6">{t('subtitle')}</p>
            <IncomingVesselsList alerts={alerts} />
        </div>
    );
}
