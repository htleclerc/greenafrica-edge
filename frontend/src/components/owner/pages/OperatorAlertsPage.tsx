// Reusable server component for the operator alerts view.
// Used by /owner/alerts (via thin wrapper) and /dashboard/alerts when the
// principal is an operator. Always fetches via principal.supabase (RLS-scoped).
// Staff continue to use their own client-side AlertsPage component.

import type { Principal } from '@/lib/auth/requirePrincipal';
import { AlertsTable, type AlertRow } from '@/components/owner/alerts/AlertsTable';

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
}

export async function OperatorAlertsPage({ principal }: Props) {
    const { data, error } = await principal.supabase
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
                <AlertsTable rows={open} emptyMessage="No active alerts." />
            </section>

            {closed.length > 0 && (
                <section>
                    <h2 className="text-sm font-semibold text-[var(--os-text-muted)] mb-3">
                        Closed ({closed.length})
                    </h2>
                    <AlertsTable rows={closed} emptyMessage="" />
                </section>
            )}
        </div>
    );
}
