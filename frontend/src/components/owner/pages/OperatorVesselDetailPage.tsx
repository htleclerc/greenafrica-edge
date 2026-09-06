// Reusable server component for the operator vessel detail view.
// Used by /dashboard/vessels/[ref] (when principal is an operator). Always
// fetches via principal.supabase (RLS-scoped).
//
// L'URL porte la référence opaque du navire (mig 147), jamais son UUID : un
// identifiant interne finit dans l'historique, les Referer et les captures
// d'écran. Une référence mal formée — l'ancien UUID compris — vaut notFound().

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import type { Principal } from '@/lib/auth/requirePrincipal';
import { OsBadge } from '@/components/ui/OsBadge';
import { buildInvoiceDownloadUrl } from '@/services/invoiceDownloadLink';
import { outstandingUsd, type OutstandingColumns } from '@/lib/outstanding';
import { confirmedPaidUsdByTransaction } from '@/services/confirmedPayments';
import { StatementDownload } from '@/components/owner/StatementDownload';
import { isVesselRef } from '@/services/vesselRefService';
import { portalPaths } from '@/lib/auth/portalPaths';

/**
 * Facture visant ce navire. Le rattachement se fait par `vessel_id`, jamais par
 * `vessel_name` : l'armateur peut renommer un navire depuis sa flotte, alors
 * que `transactions.vessel_name` est gele a l'emission (migration 089). Un
 * rapprochement par nom se romprait donc exactement au moment ou le
 * proprietaire exerce le droit qu'on vient de lui ouvrir.
 */
interface VesselInvoice {
    id: string;
    invoice_ref: string | null;
    content_hash: string | null;
    invoice_pdf_url: string | null;
    document_type: string | null;
    tax_amount_usd: number;
    partial_paid_usd: number | null;
    status: string;
    created_at: string;
}

function usd(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount);
}

function statusVariant(status: string): 'active' | 'warning' | 'critical' | 'archived' | 'info' {
    if (status === 'PAID') return 'active';
    if (status === 'OVERDUE') return 'critical';
    if (status === 'PENDING' || status === 'PARTIALLY_PAID') return 'warning';
    if (status === 'CANCELLED') return 'archived';
    return 'info';
}

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
    /** Référence publique `ves_…` (mig 147). */
    vesselRef: string;
    /** Back-link destination. Defaults to the fleet of the current portal. */
    backHref?: string;
}

export async function OperatorVesselDetailPage({
    principal,
    vesselRef,
    backHref,
}: Props) {
    if (!isVesselRef(vesselRef)) notFound();
    const paths = portalPaths(principal);
    const back = backHref ?? paths.fleet;
    // Arbitrage PO 2026-09-06 : un rôle sans accès à la facturation voit le
    // navire, pas ses montants.
    const hideAmounts = paths.hideAmounts;

    const { data: vessel } = await principal.supabase
        .from('vessels')
        .select(
            'id, public_ref, name, mmsi, imo_number, call_sign, flag_code, category, gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status, estimated_emissions_tco2, tax_liability_usd, last_zone',
        )
        .eq('public_ref', vesselRef)
        // Meme perimetre que la liste : le detail n'est accessible que pour les
        // navires du dossier de l'armateur. La RLS seule laisserait passer un
        // navire rattache par le lien agent hérité (`owner_id`, mig 073), qui
        // ne figure dans aucune de ses listes.
        .eq('shipowner_id', principal.shipowner.id)
        .maybeSingle();

    if (!vessel) notFound();
    const vesselId = String(vessel.id);

    const { data: alerts } = await principal.supabase
        .from('arrival_alerts')
        .select('id, status, detected_at, distance_to_port_nm')
        .eq('vessel_id', vesselId)
        .order('detected_at', { ascending: false })
        .limit(10);

    // Factures vivantes du navire. Les annulees sont exclues : depuis la
    // rebascule du livre (migration 128), une meme reference peut etre portee
    // par deux lignes, celle annulee du seed et celle reellement due. Les
    // afficher toutes montrerait chaque facture en double.
    const { data: invoiceRows } = await principal.supabase
        .from('transactions')
        .select('id, invoice_ref, content_hash, invoice_pdf_url, document_type, tax_amount_usd, partial_paid_usd, status, created_at')
        .eq('vessel_id', vesselId)
        .neq('status', 'VOID')
        .order('created_at', { ascending: false });

    const invoices = (invoiceRows ?? []) as VesselInvoice[];
    // Ce qui a ete encaisse se lit dans `payments`, pas sur la transaction :
    // `partial_paid_usd` est gele a zero par la migration 089, si bien qu'une
    // facture reglee en partie serait reclamee en entier.
    const paidByTxn = await confirmedPaidUsdByTransaction(
        principal.supabase,
        invoices.map((i) => i.id),
    );
    const totalBilledUsd = invoices.reduce((sum, i) => sum + Number(i.tax_amount_usd ?? 0), 0);
    const totalOutstandingUsd = invoices.reduce(
        (sum, i) => sum + outstandingUsd(i as unknown as OutstandingColumns, paidByTxn.get(i.id) ?? 0),
        0,
    );

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <Link
                href={back}
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
                    <Field label="Flag" value={vessel.flag_code ?? '—'} />
                    <Field label="Category" value={vessel.category ?? '—'} />
                    <Field label="Last zone" value={vessel.last_zone ?? '—'} />
                    {/* Puissance et vitesse sont nullables depuis la mig 093
                        (navires importés sans fiche technique) : un navire
                        incomplet s'affiche avec des tirets, il ne plante pas
                        la page. */}
                    <Field
                        label="Gross tonnage (DWT)"
                        value={vessel.gross_tonnage_dwt != null ? Number(vessel.gross_tonnage_dwt).toLocaleString() : '—'}
                    />
                    <Field
                        label="Engine power"
                        value={vessel.engine_power_kw != null ? `${Number(vessel.engine_power_kw).toLocaleString()} kW` : '—'}
                    />
                    <Field
                        label="Design speed"
                        value={vessel.design_speed_knots != null ? `${vessel.design_speed_knots} kn` : '—'}
                    />
                    <Field
                        label="Estimated CO₂"
                        value={`${Number(vessel.estimated_emissions_tco2 ?? 0).toLocaleString()} t`}
                    />
                    <Field
                        label="Tax liability"
                        value={hideAmounts ? '—' : `$${Number(vessel.tax_liability_usd ?? 0).toLocaleString()}`}
                    />
                    <div>
                        <span className="block text-[10px] uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                            Compliance
                        </span>
                        <OsBadge variant="info" label={vessel.compliance_status ?? '—'} />
                    </div>
                </div>
            </section>

            {hideAmounts ? (
                <section className="os-card p-5 mb-6">
                    <h2 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">
                        Invoices for this vessel
                    </h2>
                    <p className="text-sm text-[var(--os-text-muted)]">
                        {invoices.length} invoice(s) — amounts are reserved to finance roles.
                    </p>
                </section>
            ) : (
            <section className="os-card p-5 mb-6">
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                    <h2 className="text-sm font-semibold text-[var(--os-text-primary)]">
                        Invoices for this vessel
                    </h2>
                    {invoices.length > 0 && (
                        <div className="flex flex-wrap gap-5 text-xs">
                            <span className="text-[var(--os-text-muted)]">
                                Billed{' '}
                                <strong className="text-[var(--os-text-primary)] tabular-nums">
                                    {usd(totalBilledUsd)}
                                </strong>
                            </span>
                            <span className="text-[var(--os-text-muted)]">
                                Outstanding{' '}
                                <strong
                                    className="tabular-nums"
                                    style={{ color: totalOutstandingUsd > 0 ? '#EAB308' : 'var(--os-text-primary)' }}
                                >
                                    {usd(totalOutstandingUsd)}
                                </strong>
                            </span>
                        </div>
                    )}
                </div>

                {invoices.length > 0 ? (
                    <ul className="divide-y divide-[var(--os-border)]">
                        {invoices.map((inv) => {
                            const href = buildInvoiceDownloadUrl(inv);
                            return (
                                <li
                                    key={inv.id}
                                    className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-sm"
                                >
                                    <div className="flex flex-wrap items-center gap-3 min-w-0">
                                        <span className="font-mono text-xs text-[var(--os-text-primary)]">
                                            {inv.invoice_ref ?? inv.id.slice(0, 8)}
                                        </span>
                                        <OsBadge variant="info" label={inv.document_type ?? '-'} />
                                        <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                                            {inv.created_at.slice(0, 10)}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <span className="text-xs tabular-nums text-[var(--os-text-secondary)]">
                                            {usd(Number(inv.tax_amount_usd ?? 0))}
                                            {paidByTxn.get(inv.id) ? (
                                                <span className="text-[var(--os-text-muted)]">
                                                    {' '}
                                                    ({usd(paidByTxn.get(inv.id) ?? 0)} paid)
                                                </span>
                                            ) : null}
                                        </span>
                                        <OsBadge variant={statusVariant(inv.status)} label={inv.status} />
                                        {href ? (
                                            <a
                                                href={href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
                                            >
                                                <Download className="w-3 h-3" />
                                                PDF
                                            </a>
                                        ) : (
                                            // Une ligne sans PDF stocke n'est pas une anomalie a masquer :
                                            // l'armateur doit voir qu'il lui manque une piece.
                                            <span className="text-xs text-[var(--os-text-muted)]">Not issued</span>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="text-sm text-[var(--os-text-muted)]">
                        No invoice attached to this vessel.
                    </p>
                )}
            </section>
            )}

            {!hideAmounts && (
            <div className="mb-6">
                <StatementDownload vesselRef={String(vessel.public_ref)} />
            </div>
            )}

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
