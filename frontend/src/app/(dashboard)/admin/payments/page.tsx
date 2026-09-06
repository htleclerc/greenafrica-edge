import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PaymentsAdminPanel } from '@/components/dashboard/admin/PaymentsAdmin/PaymentsAdminPanel';
import { hasSettlementRights } from '@/lib/auth/requireSettlementRights';

export const metadata: Metadata = {
    title: 'Payments | Green Gate',
    description: 'Resolve payments (v7) and configure the active payment provider.',
};

export const dynamic = 'force-dynamic';



export default async function PaymentsAdminRoute() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active, can_settle_payments')
        .eq('id', auth.user.id)
        .single();
    // Meme regle que les actions confirmPayment / rejectPayment : role, ou
    // sous-permission can_settle_payments (mig 130). Les trois portes du rail
    // monetaire partagent une seule definition.
    if (!profile || !hasSettlementRights(profile)) {
        redirect('/dashboard');
    }

    return (
        <div className="px-6 py-4">
            {/* Plan 7C-3: v7 payments table — primary admin surface */}
            <PaymentsAdminPanel />

        </div>
    );
}
