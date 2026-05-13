import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RefundsAdminPanel } from '@/components/dashboard/admin/RefundsAdmin/RefundsAdminPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 9: /admin/refunds
//
// Refund arbitration page. Lists refunds by status across 4 tabs
// (Requested / Approved / Executed / Rejected) and lets admins approve,
// execute, or reject each one via a drawer.
//
// Server-side RBAC mirrors /admin/payments (Plan 7C-3): redirect to /login if
// no session, redirect to /dashboard if role is not SUPERADMIN or
// FINANCE_ADMIN. The actions (approveRefund / executeRefund / rejectRefund /
// revealOwnerRefundIban) all double-check via requireRole — defense in depth.
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
    title: 'Refunds | Green Gate',
    description: 'Arbitrate refunds across all rails (wallet, wire, Stripe, etc.).',
};

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPERADMIN', 'FINANCE_ADMIN']);

export default async function RefundsAdminRoute() {
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
            <RefundsAdminPanel />
        </div>
    );
}
