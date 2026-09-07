import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getShipownerRefs } from '@/services/shipownerRefService';
import {
    parseInvoiceFilters,
    listInvoicesAdmin,
    listInvoiceFilterOptions,
} from '@/services/invoiceAdminService';
import { InvoicesAdminList } from './InvoicesAdminList';
import { forceCurrentWeekProformas } from '@/lib/auth/paymentsOnly';

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
        .select('role, payments_only')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) redirect('/dashboard');

    // Encaissements seulement (mig 154) : les pro-formas émises cette semaine,
    // rien d'autre — le filtre est imposé ici, pas proposé à l'écran.
    const cashOnly = (profile as { payments_only?: boolean | null }).payments_only === true;
    const filters = cashOnly
        ? forceCurrentWeekProformas(parseInvoiceFilters(await searchParams))
        : parseInvoiceFilters(await searchParams);
    const [pageData, options] = await Promise.all([
        listInvoicesAdmin(supabase, filters),
        listInvoiceFilterOptions(supabase),
    ]);

    const refs = await getShipownerRefs(
        supabase,
        pageData.rows.map((r) => r.shipowner_id).filter((v): v is string => !!v),
    );

    const t = await getTranslations('AdminInvoices');
    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{cashOnly ? t('cashOnlyNotice') : t('subtitle')}</p>
            <InvoicesAdminList
                refs={refs}
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
