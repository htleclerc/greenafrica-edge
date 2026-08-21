import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getReglementsSummary } from '@/services/reglementsService';
import { listArmateursCockpit } from '@/services/armateurService';
import { ReglementsDashboard } from './ReglementsDashboard';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['FINANCE_ADMIN', 'SUPERADMIN'];

export default async function ReglementsPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) redirect('/dashboard');

    const [summary, owners] = await Promise.all([
        getReglementsSummary(supabase),
        listArmateursCockpit(supabase),
    ]);
    const t = await getTranslations('AdminReglements');

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <ReglementsDashboard
                summary={summary}
                owners={owners.filter((o) => o.overdue_count > 0)}
            />
        </div>
    );
}
