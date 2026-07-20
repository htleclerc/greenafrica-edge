import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import {
    parseInvoiceFilters,
    listInvoicesAdmin,
    listInvoiceFilterOptions,
} from '@/services/invoiceAdminService';
import { InvoicesAdminList } from './InvoicesAdminList';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export default async function AdminInvoicesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) redirect('/dashboard');

    const filters = parseInvoiceFilters(await searchParams);
    const [pageData, options] = await Promise.all([
        listInvoicesAdmin(supabase, filters),
        listInvoiceFilterOptions(supabase),
    ]);

    const t = await getTranslations('AdminInvoices');
    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <InvoicesAdminList
                rows={pageData.rows}
                total={pageData.total}
                page={pageData.page}
                pageSize={pageData.pageSize}
                filters={filters}
                options={options}
            />
        </div>
    );
}
