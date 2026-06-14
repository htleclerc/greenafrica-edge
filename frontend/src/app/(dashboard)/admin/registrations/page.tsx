import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { RegistrationsTable } from './RegistrationsTable';

export default async function AdminRegistrationsPage({
    searchParams,
}: {
    searchParams: Promise<{ status?: string }>;
}) {
    const t = await getTranslations('AdminRegistrations');
    const params = await searchParams;
    const filter = params.status ?? 'PENDING_REVIEW';

    // Check auth - PORT_OFFICER role can also view, but only SUPERADMIN can act
    const supabase = await createClient();
    const { data: authUser } = await supabase.auth.getUser();
    if (!authUser?.user) {
        throw new Error('Unauthorized');
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authUser.user.id)
        .single();

    const allowedRoles = ['SUPERADMIN', 'PORT_OFFICER'];
    if (!profile || !allowedRoles.includes(profile.role)) {
        throw new Error('Forbidden');
    }

    // Load shipowners with the selected filter
    const { data: rows } = await supabase
        .from('shipowners')
        .select(
            'id, name, imo_company_no, country_code, official_email, proof_doc_url, proof_doc_type, account_state, kyc_level_b_completed_at, created_at'
        )
        .eq('account_state', filter)
        .order('created_at', { ascending: false });

    return (
        <div className="p-6">
            <h1 className="text-2xl font-semibold mb-4">{t('title')}</h1>
            <div className="flex gap-2 mb-4">
                {['PENDING_REVIEW', 'REJECTED', 'ACTIVE'].map((s) => (
                    <a
                        key={s}
                        href={`?status=${s}`}
                        className={
                            filter === s
                                ? 'px-4 py-2 bg-[var(--os-highlight)] text-[var(--os-text-primary)] rounded-lg font-semibold'
                                : 'px-4 py-2 bg-[var(--os-surface-2)] text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] rounded-lg transition-colors'
                        }
                    >
                        {t(`filters.${s}`)}
                    </a>
                ))}
            </div>
            <RegistrationsTable rows={rows ?? []} status={filter} canAction={profile.role === 'SUPERADMIN'} />
        </div>
    );
}
