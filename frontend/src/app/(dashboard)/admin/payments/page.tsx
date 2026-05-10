import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PaymentProvidersPanel } from '@/components/dashboard/admin/PaymentProvidersPanel';
import { PendingIntentsPanel } from '@/components/dashboard/admin/PendingIntentsPanel';
import { PaymentsAdminPanel } from '@/components/dashboard/admin/PaymentsAdmin/PaymentsAdminPanel';
import { listPendingPaymentIntents } from '@/services/paymentIntentService';

export const metadata: Metadata = {
    title: 'Payments | Green Gate',
    description: 'Resolve payments (v7) and legacy intents; configure the active payment provider.',
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
            {/* Plan 7C-3: v7 payments table — primary admin surface */}
            <PaymentsAdminPanel />

            {/* Legacy v0 intents — kept until Plan 7C-5 cutover */}
            {intents.length > 0 && (
                <details className="mb-5">
                    <summary className="text-xs text-[var(--os-text-muted)] cursor-pointer mb-2">
                        Legacy intents ({intents.length})
                    </summary>
                    <PendingIntentsPanel intents={intents} />
                </details>
            )}

            <PaymentProvidersPanel />
        </div>
    );
}
