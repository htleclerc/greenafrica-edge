import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PaymentProvidersPanel } from '@/components/dashboard/admin/PaymentProvidersPanel';
import { PendingIntentsPanel } from '@/components/dashboard/admin/PendingIntentsPanel';
import { listPendingPaymentIntents } from '@/services/paymentIntentService';

export const metadata: Metadata = {
    title: 'Payments | Green Gate',
    description:
        'Resolve owner-declared payment intents and configure the active payment provider.',
};

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPERADMIN', 'FINANCE_ADMIN']);

export default async function PaymentsAdminRoute() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile?.role || !ALLOWED_ROLES.has(profile.role)) {
        redirect('/dashboard');
    }

    const intents = await listPendingPaymentIntents(supabase);

    return (
        <div className="px-6 py-4">
            <PendingIntentsPanel intents={intents} />
            <PaymentProvidersPanel />
        </div>
    );
}
