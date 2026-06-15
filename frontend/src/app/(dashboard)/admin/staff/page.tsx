import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { StaffInvite } from '@/components/dashboard/admin/StaffInvite';

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

    return (
        <div className="px-6 py-4">
            <StaffInvite jurisdictions={jurisdictions ?? []} />
        </div>
    );
}
