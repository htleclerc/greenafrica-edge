import { requireOwner } from '@/lib/auth/requireOwner';
import { getDisputesBySubmitter } from '@/services/disputeService';
import { OwnerDisputesList, type OwnerDisputeRow } from './OwnerDisputesList';

export const metadata = { title: 'Owner portal — disputes' };
export const dynamic = 'force-dynamic';

export default async function OwnerDisputesPage() {
    const session = await requireOwner();
    const disputes = await getDisputesBySubmitter(session.supabase, session.userId);
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
