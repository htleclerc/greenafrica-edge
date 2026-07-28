import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import {
    parseCollectionFilters, listCollectionsAdmin, listCollectionFilterOptions,
} from '@/services/collectionAdminService';
import { CollectionsAdminList } from './CollectionsAdminList';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export default async function AdminCollectionsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) redirect('/dashboard');

    const filters = parseCollectionFilters(await searchParams);
    const [page, options] = await Promise.all([
        listCollectionsAdmin(supabase, filters),
        listCollectionFilterOptions(supabase),
    ]);
    const t = await getTranslations('AdminCollections');

    return (
        <div className="p-4 sm:p-6">
            <h1 className="text-xl font-bold text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-sm text-[var(--os-text-muted)] mb-4">{t('subtitle')}</p>
            <CollectionsAdminList
                rows={page.rows}
                total={page.total}
                page={page.page}
                pageSize={page.pageSize}
                filters={filters}
                jurisdictions={options.jurisdictions}
            />
        </div>
    );
}
