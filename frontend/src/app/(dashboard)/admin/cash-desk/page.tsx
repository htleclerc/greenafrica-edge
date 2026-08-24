import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CashDeskForm } from '@/components/dashboard/admin/CashDesk';

export const metadata: Metadata = {
    title: 'Cash desk | Green Gate',
    description: 'Record in-person cash payments. PORT_OFFICER + can_record_cash, FINANCE_ADMIN, or SUPERADMIN.',
};

export const dynamic = 'force-dynamic';

export default async function CashDeskRoute() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, can_record_cash')
        .eq('id', auth.user.id)
        .single();

    const role = profile?.role as string | undefined;
    const canRecordCash = profile?.can_record_cash as boolean | undefined;

    const allowed =
        role === 'FINANCE_ADMIN' ||
        role === 'SUPERADMIN' ||
        (role === 'PORT_OFFICER' && canRecordCash);

    if (!allowed) redirect('/dashboard');

    // L'écran est mobile d'abord et porte sa propre gouttière : le guichet se
    // tient debout, pas devant un tableau de bord large.
    return <CashDeskForm />;
}
