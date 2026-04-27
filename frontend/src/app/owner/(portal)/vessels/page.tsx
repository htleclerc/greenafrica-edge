import { requireOwner } from '@/lib/auth/requireOwner';
import { VesselsTable, type VesselRow } from './VesselsTable';

export const metadata = {
    title: 'Owner portal — vessels',
};

export const dynamic = 'force-dynamic';

export default async function OwnerVesselsPage() {
    const session = await requireOwner();

    const { data, error } = await session.supabase
        .from('vessels')
        .select('id, name, mmsi, imo_number, flag_code, category, last_zone, compliance_status')
        .order('name');

    const vessels: VesselRow[] = (data ?? []) as VesselRow[];

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">
                    Vessels
                </h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">
                    {vessels.length} {vessels.length === 1 ? 'vessel' : 'vessels'} on file.
                </p>
            </header>

            {error ? (
                <div className="os-card p-4 text-sm" style={{ color: '#FCA5A5' }}>
                    Failed to load vessels: {error.message}
                </div>
            ) : (
                <VesselsTable rows={vessels} />
            )}
        </div>
    );
}
