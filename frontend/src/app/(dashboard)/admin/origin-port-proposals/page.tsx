import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listPendingDestinationProposals } from '@/services/destinationProposalService';
import OriginPortProposalsPanel from './OriginPortProposalsPanel';

export const metadata: Metadata = {
    title: 'Origin port proposals | Green Gate',
    description: 'Review destination-match proposals from the AIS ingester.',
};

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['SUPERADMIN', 'PORT_OFFICER', 'FINANCE_ADMIN']);

export default async function OriginPortProposalsPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();

    if (!profile?.role || !ALLOWED.has(profile.role)) {
        redirect('/dashboard');
    }

    const proposals = await listPendingDestinationProposals();
    const canDecide =
        profile.role === 'SUPERADMIN' || profile.role === 'PORT_OFFICER';

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">
                Origin port proposals
            </h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">
                AIS destination strings that matched Berbera or Zeila with sufficient
                fuzzy confidence. Approve to add to the allow-list; reject to discard.
            </p>
            <OriginPortProposalsPanel proposals={proposals} canDecide={canDecide} />
        </div>
    );
}
