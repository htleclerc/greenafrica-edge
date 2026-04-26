import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AgentValidationsPage } from '@/components/dashboard/validations/AgentValidationsPage';

export const metadata = {
    title: 'Validation des agents — AIS Portal',
};

const ALLOWED_ROLES = new Set(['SUPERADMIN', 'PORT_OFFICER', 'MANAGER']);

export default async function ValidationsRoute() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();

    if (!profile?.role || !ALLOWED_ROLES.has(profile.role)) {
        redirect('/dashboard');
    }

    return <AgentValidationsPage />;
}
