import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PaymentProvidersPanel } from '@/components/dashboard/admin/PaymentProvidersPanel';
import { PaymentsAdminPanel } from '@/components/dashboard/admin/PaymentsAdmin/PaymentsAdminPanel';

export const metadata: Metadata = {
    title: 'Payments | Green Gate',
    description: 'Resolve payments (v7) and configure the active payment provider.',
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

    return (
        <div className="px-6 py-4">
            {/* Plan 7C-3: v7 payments table — primary admin surface */}
            <PaymentsAdminPanel />

            <PaymentProvidersPanel />
        </div>
    );
}
