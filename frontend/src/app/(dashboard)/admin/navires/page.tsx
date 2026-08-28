import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { listNaviresRecouvrement } from '@/services/navireService';
import { getReglementsSummary } from '@/services/reglementsService';
import { NaviresCockpit } from './NaviresCockpit';
import { OsBreadcrumb } from '@/components/ui/OsBreadcrumb';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export default async function NaviresPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) redirect('/dashboard');

    // Le total du tableau de bord sert de témoin : une créance sans navire
    // rattaché n'apparaît pas dans la vue par navire. Comparer les deux fait
    // apparaître l'écart au lieu de le laisser se taire.
    const [rows, summary] = await Promise.all([
        listNaviresRecouvrement(supabase),
        getReglementsSummary(supabase),
    ]);

    const t = await getTranslations('AdminNavires');
    const tNav = await getTranslations('Dashboard');
    return (
        <div className="px-6 py-4">
            <OsBreadcrumb
                className="mb-3"
                items={[
                    { label: tNav('nav_reglements'), href: '/admin/reglements' },
                    { label: tNav('nav_navires') },
                ]}
            />
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <NaviresCockpit rows={rows} dashboardOutstandingUsd={summary.totalOutstandingUsd} />
        </div>
    );
}
