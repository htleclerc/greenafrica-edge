// Reusable server component for the operator fleet view.
// Used by both /owner/vessels (via thin wrapper) and /dashboard/vessels (when
// the principal is an operator). Always fetches data through principal.supabase
// so RLS is scoped to the authenticated shipowner — never a platform client.

import type { Principal } from '@/lib/auth/requirePrincipal';
import { VesselsTable, type VesselRow } from '@/components/owner/vessels/VesselsTable';
import { AircraftTable, type AircraftRow } from '@/components/owner/vessels/AircraftTable';
import { ModeBadge } from '@/components/owner/ModeBadge';
import { ApproxFlag } from '@/components/owner/ApproxFlag';

interface RecentInvoice {
    id: string;
    invoice_ref: string | null;
    vessel_name: string;
    tax_amount_usd: number;
    status: string;
    created_at: string;
    mode: string | null;
    breakdown_json: { emission_source?: string; approximate?: boolean } | null;
}

function isApproximate(inv: RecentInvoice): boolean {
    const b = inv.breakdown_json;
    return b?.emission_source === 'MTOW_FALLBACK' || b?.approximate === true;
}

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
}

export async function OperatorVesselsPage({ principal }: Props) {
    const [vesselsRes, aircraftRes, invoicesRes] = await Promise.all([
        principal.supabase
            .from('vessels')
            .select('id, name, mmsi, imo_number, flag_code, category, last_zone, compliance_status')
            .order('name'),
        // RLS (mig-074 policy) scopes aircraft to the operating shipowner via
        // shipowners.profile_id = auth.uid(); no manual operator filter required.
        principal.supabase
            .from('aircraft')
            .select('id, icao24, registration, icao_type, engine_type, compliance_status')
            .order('registration'),
        principal.supabase
            .from('transactions')
            .select('id, invoice_ref, vessel_name, tax_amount_usd, status, created_at, mode, breakdown_json')
            .order('created_at', { ascending: false })
            .limit(5),
    ]);

    const vessels: VesselRow[] = (vesselsRes.data ?? []) as VesselRow[];
    const aircraft: AircraftRow[] = (aircraftRes.data ?? []) as AircraftRow[];
    const recent: RecentInvoice[] = (invoicesRes.data ?? []) as RecentInvoice[];

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">Fleet</h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">
                    {vessels.length} {vessels.length === 1 ? 'vessel' : 'vessels'}
                    {aircraft.length > 0 && (
                        <> · {aircraft.length} {aircraft.length === 1 ? 'aircraft' : 'aircraft'}</>
                    )}{' '}
                    on file.
                </p>
            </header>

            <section>
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">
                    Vessels
                    <ModeBadge mode="MARITIME" />
                </h2>
                {vesselsRes.error ? (
                    <div className="os-card p-4 text-sm" style={{ color: '#FCA5A5' }}>
                        Failed to load vessels: {vesselsRes.error.message}
                    </div>
                ) : (
                    <VesselsTable rows={vessels} vesselBasePath="/dashboard/vessels" />
                )}
            </section>

            {(aircraft.length > 0 || aircraftRes.error) && (
                <section className="mt-8">
                    <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">
                        Aircraft
                        <ModeBadge mode="AIR" />
                    </h2>
                    {aircraftRes.error ? (
                        <div className="os-card p-4 text-sm" style={{ color: '#FCA5A5' }}>
                            Failed to load aircraft: {aircraftRes.error.message}
                        </div>
                    ) : (
                        <AircraftTable rows={aircraft} />
                    )}
                </section>
            )}

            {recent.length > 0 && (
                <section className="mt-8">
                    <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">
                        Recent invoices
                    </h2>
                    <div className="flex flex-col gap-2">
                        {recent.map((inv) => (
                            <div key={inv.id} className="os-card p-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <span className="text-xs font-mono text-[var(--os-text-muted)]">{inv.invoice_ref ?? inv.id.slice(0, 8)}</span>
                                    <p className="text-sm font-medium text-[var(--os-text-primary)] truncate">{inv.vessel_name}</p>
                                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                        {inv.mode === 'AIR' && <ModeBadge mode="AIR" />}
                                        {inv.mode === 'AIR' && isApproximate(inv) && <ApproxFlag />}
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className="text-sm font-bold tabular-nums text-[var(--os-text-primary)]">${Number(inv.tax_amount_usd).toLocaleString()}</p>
                                    <p className="text-[10px] text-[var(--os-text-muted)]">{inv.status} · {new Date(inv.created_at).toLocaleDateString()}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
