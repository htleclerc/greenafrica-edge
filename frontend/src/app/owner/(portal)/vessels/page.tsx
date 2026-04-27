import Link from 'next/link';
import { requireOwner } from '@/lib/auth/requireOwner';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';

export const metadata = {
    title: 'Owner portal — vessels',
};

export const dynamic = 'force-dynamic';

interface VesselRow {
    id: string;
    name: string;
    mmsi: string | null;
    imo_number: string | null;
    flag_code: string;
    category: string;
    last_zone: string | null;
    compliance_status: string;
}

export default async function OwnerVesselsPage() {
    const session = await requireOwner();

    const { data, error } = await session.supabase
        .from('vessels')
        .select('id, name, mmsi, imo_number, flag_code, category, last_zone, compliance_status')
        .order('name');

    const vessels: VesselRow[] = (data ?? []) as VesselRow[];

    const complianceVariant = (status: string) => {
        if (status === 'COMPLIANT') return 'active' as const;
        if (status === 'OVERDUE' || status === 'NON_COMPLIANT') return 'critical' as const;
        if (status === 'APPROACHING' || status === 'PENDING') return 'warning' as const;
        return 'info' as const;
    };

    const columns: OsColumn<VesselRow>[] = [
        {
            key: 'name',
            header: 'Vessel',
            render: (r) => (
                <Link
                    href={`/owner/vessels/${r.id}`}
                    className="font-medium text-emerald-400 hover:underline"
                >
                    {r.name}
                </Link>
            ),
        },
        {
            key: 'mmsi',
            header: 'MMSI',
            render: (r) => <span className="font-mono text-xs">{r.mmsi ?? '—'}</span>,
        },
        {
            key: 'imo',
            header: 'IMO',
            render: (r) => (
                <span className="font-mono text-xs">{r.imo_number ?? '—'}</span>
            ),
        },
        {
            key: 'flag',
            header: 'Flag',
            render: (r) => (
                <span className="font-mono text-xs uppercase">{r.flag_code}</span>
            ),
        },
        {
            key: 'category',
            header: 'Category',
            render: (r) => <span className="text-xs">{r.category}</span>,
        },
        {
            key: 'lastZone',
            header: 'Last zone',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)]">
                    {r.last_zone ?? '—'}
                </span>
            ),
        },
        {
            key: 'compliance',
            header: 'Compliance',
            render: (r) => (
                <OsBadge
                    variant={complianceVariant(r.compliance_status)}
                    label={r.compliance_status}
                />
            ),
        },
    ];

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
                <OsTable
                    columns={columns}
                    rows={vessels}
                    keyExtractor={(r) => r.id}
                    emptyMessage="No vessels linked to your account yet."
                />
            )}
        </div>
    );
}
