import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadValidationQueue } from '@/services/validationQueueService';
import { ValidationQueue } from './ValidationQueue';

export const metadata: Metadata = {
    title: 'Validations | Green Gate',
    description: "File d'arbitrage unifiee : identites navire, agents, ports d'origine.",
};

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPERADMIN', 'PORT_OFFICER']);

export default async function AdminValidationsPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile?.role || !ALLOWED_ROLES.has(profile.role)) redirect('/dashboard');

    const queue = await loadValidationQueue(supabase);
    return <ValidationQueue queue={queue} />;
}
