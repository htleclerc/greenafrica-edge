import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { listUnclaimedEscalated, listUnpaidProformas } from '@/services/escalationService';
import { EscalationsTabs } from './EscalationsTabs';

export const dynamic = 'force-dynamic';

export default async function EscalationsPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) {
        redirect('/dashboard');
    }

    const [unclaimed, unpaid] = await Promise.all([
        listUnclaimedEscalated(supabase),
        listUnpaidProformas(supabase),
    ]);

    const t = await getTranslations('AdminEscalations');

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">
                {t('title')}
            </h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <EscalationsTabs unclaimed={unclaimed} unpaid={unpaid} />
        </div>
    );
}
