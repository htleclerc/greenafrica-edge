import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getArmateurDetail } from '@/services/armateurService';
import { ArmateurDetail } from './ArmateurDetail';

export const dynamic = 'force-dynamic';

export default async function ArmateurDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) redirect('/dashboard');

    const detail = await getArmateurDetail(supabase, id);
    if (!detail) notFound();
    return <ArmateurDetail detail={detail} canInvite={profile.role === 'SUPERADMIN'} />;
}
