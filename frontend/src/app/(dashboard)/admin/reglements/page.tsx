import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getReglementsSummary } from '@/services/reglementsService';
import { getReglementsPeriode, isReglementPeriod } from '@/services/reglementsPeriode';
import { listArmateursCockpit } from '@/services/armateurService';
import { ReglementsDashboard } from './ReglementsDashboard';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['FINANCE_ADMIN', 'SUPERADMIN'];

export default async function ReglementsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) redirect('/dashboard');

    // Le mois par défaut : la semaine est vide la plupart du temps sur ce
    // portefeuille, l'année noie le mois en cours.
    const raw = (await searchParams).periode;
    const asked = Array.isArray(raw) ? raw[0] : raw;
    const periode = isReglementPeriod(asked) ? asked : 'month';

    const [summary, periodResult, owners] = await Promise.all([
        getReglementsSummary(supabase),
        getReglementsPeriode(supabase, periode),
        listArmateursCockpit(supabase),
    ]);
    const t = await getTranslations('AdminReglements');

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <ReglementsDashboard
                summary={summary}
                periodResult={periodResult}
                owners={owners.filter((o) => o.overdue_count > 0)}
            />
        </div>
    );
}
