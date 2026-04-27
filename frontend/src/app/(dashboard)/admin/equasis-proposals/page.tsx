import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
    listPendingProposals,
    listResolvedProposals,
} from '@/services/equasisProposalService';
import { EquasisProposalsPanel } from './EquasisProposalsPanel';

export const metadata: Metadata = {
    title: 'Equasis proposals | Green Gate',
    description: 'Review owner-email proposals from manual entry or the Equasis scraper.',
};

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPERADMIN', 'PORT_OFFICER', 'MANAGER']);

export default async function EquasisProposalsRoute() {
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

    const [pending, resolved] = await Promise.all([
        listPendingProposals(supabase),
        listResolvedProposals(supabase, 30),
    ]);

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">
                Equasis proposals
            </h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">
                Owner-email discovery queue. Manual entries and scraper output land here
                for human validation before any change reaches the shipowners table.
            </p>

            <EquasisProposalsPanel pending={pending} resolved={resolved} />
        </div>
    );
}
