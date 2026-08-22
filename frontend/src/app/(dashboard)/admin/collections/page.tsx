import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
    parseCollectionFilters, listCollectionsAdmin, listCollectionFilterOptions,
} from '@/services/collectionAdminService';
import { loadCollectionFunnel, loadPriorityDossier } from '@/services/collectionFunnel';
import { CollectionsAdminList } from './CollectionsAdminList';
import { CollectionsFunnel } from './CollectionsFunnel';
import { CollectionsHeader } from './CollectionsHeader';
import { PriorityDossier } from './PriorityDossier';

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
    const [page, options, funnel] = await Promise.all([
        listCollectionsAdmin(supabase, filters),
        listCollectionFilterOptions(supabase),
        loadCollectionFunnel(supabase, filters),
    ]);

    // Le dossier prioritaire dépend de la file : il se charge après elle, pas en
    // parallèle. Un seul aller-retour de plus, sur un identifiant déjà connu.
    const priority = funnel.priorityTransactionId
        ? await loadPriorityDossier(supabase, funnel.priorityTransactionId)
        : null;

    return (
        <div className="flex flex-col gap-[18px] p-4 sm:p-6">
            <CollectionsHeader funnel={funnel} />
            <CollectionsFunnel funnel={funnel} />
            {priority && <PriorityDossier dossier={priority} />}
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
