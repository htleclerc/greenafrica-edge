import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { StaffInvite } from '@/components/dashboard/admin/StaffInvite';
import { StaffSettlementRights, type StaffRow } from '@/components/dashboard/admin/StaffSettlementRights';

export const metadata: Metadata = {
    title: 'Staff Management | Green Gate',
    description: 'Invite government staff members and assign their jurisdictions.',
};

export const dynamic = 'force-dynamic';

// Only SUPERADMIN can access this page — staff management is a high-privilege action.
const ALLOWED_ROLES = new Set(['SUPERADMIN']);

export default async function AdminStaffRoute() {
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

    // Load active jurisdictions for the multi-select.
    const platform = createPlatformClient();
    const { data: jurisdictions, error: jErr } = await platform
        .from('jurisdictions')
        .select('id, name, code')
        .eq('status', 'ACTIVE')
        .order('code');

    if (jErr) {
        throw new Error(`Failed to load jurisdictions: ${jErr.message}`);
    }

    // Comptes staff : les armateurs (SHIPPING_AGENT) n'ont rien a faire dans le
    // back-office, la sous-permission ne leur est pas proposable.
    const { data: staff, error: sErr } = await platform
        .from('profiles')
        .select('id, full_name, email, role, is_active, can_settle_payments, payments_only')
        .neq('role', 'SHIPPING_AGENT')
        .order('role')
        .order('full_name');

    if (sErr) {
        throw new Error(`Failed to load staff: ${sErr.message}`);
    }

    return (
        <div className="px-6 py-4">
            <StaffInvite jurisdictions={jurisdictions ?? []} />
            <StaffSettlementRights staff={(staff ?? []) as StaffRow[]} />
        </div>
    );
}
