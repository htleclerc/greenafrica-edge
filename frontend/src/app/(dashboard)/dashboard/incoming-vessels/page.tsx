import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { listUnclaimedAlerts } from '@/services/arrivalAlertService';
import { listOperatorArrivals } from '@/services/operatorArrivals';
import type { ArrivalAlertWithVessel } from '@/types/secure/arrivalAlert';
import { IncomingVesselsList } from './IncomingVesselsList';

export const metadata = {
    title: 'Incoming Vessels | Green Gate',
    description: 'Vessels approaching Somaliland ports, awaiting agent claim and pro-forma issuance.',
};

export const dynamic = 'force-dynamic';

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

    // Deux lectures de la même file : la vue opérateur (triée, avec la solvabilité
    // de l'armateur) et les alertes brutes, dont le dialogue de prise en charge a
    // besoin telles quelles. `listUnclaimedAlerts` est déjà appelée à l'intérieur
    // de `listOperatorArrivals` ; la refaire ici évite de faire remonter la forme
    // brute à travers la vue opérateur, qui n'a pas à la connaître.
    const [arrivals, alerts] = await Promise.all([
        listOperatorArrivals(supabase),
        listUnclaimedAlerts(supabase),
    ]);

    const alertsById = Object.fromEntries(
        alerts.map((a) => [a.id, a]),
    ) as Record<string, ArrivalAlertWithVessel>;

    const t = await getTranslations('IncomingVessels');

    return (
        <IncomingVesselsList
            arrivals={arrivals}
            alertsById={alertsById}
            portLabel={t('portLabel')}
        />
    );
}
