import { requireOwner } from '@/lib/auth/requireOwner';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';

export const metadata = {
    title: 'Owner portal — alerts',
};

export const dynamic = 'force-dynamic';

interface AlertRow {
    id: string;
    status: string;
    detected_at: string;
    distance_to_port_nm: number | null;
    estimated_route_nm: number | null;
    vessel: { id: string; name: string; imo_number: string } | null;
}

const STATUS_ORDER = [
    'DETECTED',
    'MATCHED_AUTO',
    'UNCLAIMED',
    'PROFORMA_SENT',
    'ARRIVED',
    'DEPARTED_EEZ',
    'RECONCILED',
    'ESCALATED',
    'CANCELLED',
];

function statusVariant(status: string): BadgeVariant {
    if (status === 'RECONCILED') return 'active';
    if (status === 'ESCALATED' || status === 'UNCLAIMED') return 'critical';
    if (status === 'PROFORMA_SENT' || status === 'ARRIVED' || status === 'DEPARTED_EEZ') return 'warning';
    if (status === 'CANCELLED') return 'archived';
    return 'info';
}

export default async function OwnerAlertsPage() {
    const session = await requireOwner();

    const { data, error } = await session.supabase
        .from('arrival_alerts')
        .select(
            `id, status, detected_at, distance_to_port_nm, estimated_route_nm,
             vessel:vessels (id, name, imo_number)`,
        )
        .order('detected_at', { ascending: false })
        .limit(100);

    const alerts: AlertRow[] = (data ?? []) as unknown as AlertRow[];

    const open = alerts.filter((a) => !['RECONCILED', 'CANCELLED'].includes(a.status));
    const closed = alerts.filter((a) => ['RECONCILED', 'CANCELLED'].includes(a.status));

    const columns: OsColumn<AlertRow>[] = [
        {
            key: 'vessel',
            header: 'Vessel',
            render: (r) => (
                <div className="flex flex-col leading-tight">
                    <span className="font-medium text-[var(--os-text-primary)]">
                        {r.vessel?.name ?? '—'}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--os-text-muted)]">
                        IMO {r.vessel?.imo_number ?? '—'}
                    </span>
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            render: (r) => <OsBadge variant={statusVariant(r.status)} label={r.status} />,
        },
        {
            key: 'progress',
            header: 'Progress',
            render: (r) => {
                const idx = STATUS_ORDER.indexOf(r.status);
                const pct = idx >= 0 ? Math.round(((idx + 1) / 7) * 100) : 0;
                return (
                    <div
                        className="w-24 h-1.5 rounded-full overflow-hidden"
                        style={{ backgroundColor: 'var(--os-border)' }}
                    >
                        <div
                            className="h-full"
                            style={{
                                width: `${pct}%`,
                                backgroundColor: '#10B981',
                            }}
                        />
                    </div>
                );
            },
        },
        {
            key: 'distance',
            header: 'Distance',
            className: 'text-right',
            render: (r) => (
                <span className="font-mono text-xs tabular-nums">
                    {r.distance_to_port_nm
                        ? `${Math.round(Number(r.distance_to_port_nm))} NM`
                        : '—'}
                </span>
            ),
        },
        {
            key: 'detected',
            header: 'Detected',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                    {new Date(r.detected_at).toLocaleString()}
                </span>
            ),
        },
    ];

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">
                    Alerts
                </h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">
                    Vessels approaching, in zone, or recently reconciled.
                </p>
            </header>

            {error && (
                <div className="os-card p-4 text-sm mb-4" style={{ color: '#FCA5A5' }}>
                    Failed to load alerts: {error.message}
                </div>
            )}

            <section className="mb-8">
                <h2 className="text-sm font-semibold text-[var(--os-text-primary)] mb-3">
                    Open ({open.length})
                </h2>
                <OsTable
                    columns={columns}
                    rows={open}
                    keyExtractor={(r) => r.id}
                    emptyMessage="No active alerts."
                />
            </section>

            {closed.length > 0 && (
                <section>
                    <h2 className="text-sm font-semibold text-[var(--os-text-muted)] mb-3">
                        Closed ({closed.length})
                    </h2>
                    <OsTable
                        columns={columns}
                        rows={closed}
                        keyExtractor={(r) => r.id}
                        emptyMessage=""
                    />
                </section>
            )}
        </div>
    );
}
