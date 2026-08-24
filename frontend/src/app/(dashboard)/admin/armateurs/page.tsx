import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listArmateursCockpit } from '@/services/armateurService';
import { ArmateursCockpit } from './ArmateursCockpit';

export const dynamic = 'force-dynamic';

export default async function ArmateursPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) redirect('/dashboard');

    const rows = await listArmateursCockpit(supabase);
    // Le titre est un verdict calculé sur les données (« 7 armateurs en défaut ») :
    // il vit dans le cockpit, pas ici.
    return <ArmateursCockpit rows={rows} canInvite={profile.role === 'SUPERADMIN'} />;
}
