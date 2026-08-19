import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
    const t = await getTranslations('AdminArmateurs');
    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <ArmateursCockpit rows={rows} canInvite={profile.role === 'SUPERADMIN'} />
        </div>
    );
}
