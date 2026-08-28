import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { OsBreadcrumb } from '@/components/ui/OsBreadcrumb';
import { createClient } from '@/lib/supabase/server';
import { getArmateurDetail } from '@/services/armateurService';
import { resolveShipownerByRef } from '@/services/shipownerRefService';
import { ArmateurDetail } from './ArmateurDetail';

export const dynamic = 'force-dynamic';

export default async function ArmateurDetailPage({ params }: { params: Promise<{ ref: string }> }) {
    const { ref } = await params;
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) redirect('/dashboard');

    // L'URL porte une reference opaque (mig 144), jamais l'identifiant interne.
    // Une reference inconnue OU masquee par la RLS donne le meme notFound() :
    // repondre differemment revelerait l'existence d'un armateur hors perimetre.
    const id = await resolveShipownerByRef(supabase, ref);
    if (!id) notFound();

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
    const tNav = await getTranslations('Dashboard');
    return (
        <>
        <div className="px-6 pt-4">
            <OsBreadcrumb
                items={[
                    { label: tNav('nav_armateurs'), href: '/admin/armateurs' },
                    { label: detail.name },
                ]}
            />
        </div>
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
        </>
    );
}
