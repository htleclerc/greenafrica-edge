import { requireOwner } from '@/lib/auth/requireOwner';
import { VesselsTable, type VesselRow } from './VesselsTable';

export const metadata = { title: 'Owner portal — vessels' };
export const dynamic = 'force-dynamic';

interface RecentInvoice {
    id: string;
    invoice_ref: string | null;
    vessel_name: string;
    tax_amount_usd: number;
    status: string;
    created_at: string;
}

export default async function OwnerVesselsPage() {
    const session = await requireOwner();

    const [vesselsRes, invoicesRes] = await Promise.all([
        session.supabase
            .from('vessels')
            .select('id, name, mmsi, imo_number, flag_code, category, last_zone, compliance_status')
            .order('name'),
        session.supabase
            .from('transactions')
            .select('id, invoice_ref, vessel_name, tax_amount_usd, status, created_at')
            .order('created_at', { ascending: false })
            .limit(5),
    ]);

    const vessels: VesselRow[] = (vesselsRes.data ?? []) as VesselRow[];
    const recent: RecentInvoice[] = (invoicesRes.data ?? []) as RecentInvoice[];

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">Vessels</h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">
                    {vessels.length} {vessels.length === 1 ? 'vessel' : 'vessels'} on file.
                </p>
            </header>

            {vesselsRes.error ? (
                <div className="os-card p-4 text-sm" style={{ color: '#FCA5A5' }}>
                    Failed to load vessels: {vesselsRes.error.message}
                </div>
            ) : (
                <VesselsTable rows={vessels} />
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
