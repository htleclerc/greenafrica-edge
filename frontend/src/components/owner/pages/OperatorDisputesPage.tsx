// Reusable server component for the operator disputes view.
// Used by /owner/disputes (via thin wrapper) and /dashboard/disputes when the
// principal is an operator. Always fetches via principal.supabase (RLS-scoped).

import type { Principal } from '@/lib/auth/requirePrincipal';
import { getDisputesBySubmitter } from '@/services/disputeService';
import { OwnerDisputesList, type OwnerDisputeRow } from '@/components/owner/disputes/OwnerDisputesList';

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
}

export async function OperatorDisputesPage({ principal }: Props) {
    const disputes = await getDisputesBySubmitter(principal.supabase, principal.userId);
    const rows: OwnerDisputeRow[] = disputes.map((d) => ({
        id: d.id,
        ref: d.ref,
        vesselName: d.vesselName,
        status: d.status as OwnerDisputeRow['status'],
        originalAmountUsd: d.originalAmountUsd,
        createdAt: d.createdAt,
    }));

    return (
        <div className="px-6 py-6 max-w-4xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">Disputes</h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">
                    Disputes you have opened. Open a new dispute from an invoice in the Invoices page.
                </p>
            </header>
            <OwnerDisputesList rows={rows} />
        </div>
    );
}
