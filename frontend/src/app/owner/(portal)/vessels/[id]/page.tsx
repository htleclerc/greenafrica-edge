import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireOwner } from '@/lib/auth/requireOwner';
import { OsBadge } from '@/components/ui/OsBadge';

export const metadata = {
    title: 'Owner portal — vessel detail',
};

export const dynamic = 'force-dynamic';

interface PageParams {
    id: string;
}

export default async function OwnerVesselDetailPage({
    params,
}: {
    params: Promise<PageParams>;
}) {
    const session = await requireOwner();
    const { id } = await params;

    const { data: vessel } = await session.supabase
        .from('vessels')
        .select(
            'id, name, mmsi, imo_number, call_sign, flag_code, category, gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status, estimated_emissions_tco2, tax_liability_usd, last_zone',
        )
        .eq('id', id)
        .maybeSingle();

    if (!vessel) notFound();

    const { data: alerts } = await session.supabase
        .from('arrival_alerts')
        .select('id, status, detected_at, distance_to_port_nm')
        .eq('vessel_id', id)
        .order('detected_at', { ascending: false })
        .limit(10);

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <Link
                href="/owner/vessels"
                className="inline-flex items-center gap-1 text-xs text-[var(--os-text-muted)] hover:text-emerald-400 mb-4"
            >
                <ArrowLeft className="w-3 h-3" />
                All vessels
            </Link>

            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">
                    {vessel.name}
                </h1>
                <p className="text-xs text-[var(--os-text-muted)] mt-1 font-mono">
                    IMO {vessel.imo_number} · MMSI {vessel.mmsi} · {vessel.call_sign}
                </p>
            </header>

            <section className="os-card p-5 mb-6">
                <h2 className="text-sm font-semibold text-[var(--os-text-primary)] mb-3">
                    Specifications
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                    <Field label="Flag" value={vessel.flag_code} />
                    <Field label="Category" value={vessel.category} />
                    <Field label="Last zone" value={vessel.last_zone ?? '—'} />
                    <Field
                        label="Gross tonnage (DWT)"
                        value={vessel.gross_tonnage_dwt.toLocaleString()}
                    />
                    <Field
                        label="Engine power"
                        value={`${vessel.engine_power_kw.toLocaleString()} kW`}
                    />
                    <Field
                        label="Design speed"
                        value={`${vessel.design_speed_knots} kn`}
                    />
                    <Field
                        label="Estimated CO₂"
                        value={`${Number(vessel.estimated_emissions_tco2).toLocaleString()} t`}
                    />
                    <Field
                        label="Tax liability"
                        value={`$${Number(vessel.tax_liability_usd).toLocaleString()}`}
                    />
                    <div>
                        <span className="block text-[10px] uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                            Compliance
                        </span>
                        <OsBadge variant="info" label={vessel.compliance_status} />
                    </div>
                </div>
            </section>

            <section className="os-card p-5">
                <h2 className="text-sm font-semibold text-[var(--os-text-primary)] mb-3">
                    Recent alerts
                </h2>
                {alerts && alerts.length > 0 ? (
                    <ul className="divide-y divide-[var(--os-border)]">
                        {alerts.map((a) => (
                            <li
                                key={a.id}
                                className="py-2.5 flex items-center justify-between gap-4 text-sm"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                                        {new Date(a.detected_at).toLocaleDateString()}
                                    </span>
                                    <OsBadge variant="info" label={a.status} />
                                </div>
                                <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                                    {Math.round(Number(a.distance_to_port_nm ?? 0))} NM
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-[var(--os-text-muted)]">
                        No alerts on this vessel yet.
                    </p>
                )}
            </section>
        </div>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <span className="block text-[10px] uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                {label}
            </span>
            <span className="text-[var(--os-text-primary)]">{value}</span>
        </div>
    );
}
