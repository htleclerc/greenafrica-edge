import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAirlineDetail } from '@/services/airlineService';
import { resolveShipownerByRef } from '@/services/shipownerRefService';
import { AirlineDetail } from './AirlineDetail';

export const dynamic = 'force-dynamic';

export default async function AirlineDetailPage({ params }: { params: Promise<{ ref: string }> }) {
    const { ref } = await params;
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) redirect('/dashboard');

    // Les compagnies aeriennes sont des lignes shipowners : meme reference
    // opaque, meme resolveur.
    const id = await resolveShipownerByRef(supabase, ref);
    if (!id) notFound();

    const canViewBilling = ['SUPERADMIN', 'FINANCE_ADMIN'].includes(profile.role);
    const detail = await getAirlineDetail(supabase, id, canViewBilling);
    if (!detail) notFound();

    const isSuperadmin = profile.role === 'SUPERADMIN';
    return <AirlineDetail detail={detail} canInvite={isSuperadmin} canAnonymize={isSuperadmin} />;
}
