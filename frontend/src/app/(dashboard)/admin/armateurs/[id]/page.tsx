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

    const canViewBilling = ['SUPERADMIN', 'FINANCE_ADMIN'].includes(profile.role);
    // Même requête que owner-agent-mappings/page.tsx pour peupler le sélecteur
    // d'agent de la carte Représentants (round de correction 1, Tâche 9) —
    // indépendante de getArmateurDetail, donc en parallèle plutôt qu'en série.
    const [detail, agentsRes] = await Promise.all([
        getArmateurDetail(supabase, id, canViewBilling),
        supabase
            .from('profiles')
            .select('id, full_name, email')
            .eq('role', 'SHIPPING_AGENT')
            .order('full_name'),
    ]);
    if (!detail) notFound();
    const isSuperadmin = profile.role === 'SUPERADMIN';
    return (
        <ArmateurDetail
            detail={detail}
            canInvite={isSuperadmin}
            canAnonymize={isSuperadmin}
            agents={
                (agentsRes.data ?? []) as {
                    id: string;
                    full_name: string | null;
                    email: string;
                }[]
            }
        />
    );
}
