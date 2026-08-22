// Ma flotte (2b du handoff de refonte).
//
// Deux niveaux de lecture : les navires qui exigent une action sont des cartes,
// les navires conformes des lignes de tableau. L'en-tete énonce le verdict
// (« 6 navires, 2 exigent une action ») plutôt que le simple decompte.
//
// Utilise par /owner/vessels (via un fin adaptateur) et par /dashboard/vessels
// quand le principal est un opérateur. Toutes les lectures passent par
// principal.supabase, donc bornées par RLS — jamais un client plateforme.

import { Download, Receipt } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Principal } from '@/lib/auth/requirePrincipal';
import { OsPageHeader } from '@/components/ui/OsPageHeader';
import { getOwnerFleet } from '@/services/ownerFleet';
import { buildInvoiceDownloadUrl } from '@/services/invoiceDownloadLink';
import { FleetBoard } from '@/components/owner/vessels/FleetBoard';
import { AircraftTable, type AircraftRow } from '@/components/owner/vessels/AircraftTable';
import { ModeBadge } from '@/components/owner/ModeBadge';
import { ApproxFlag } from '@/components/owner/ApproxFlag';

interface RecentInvoice {
    id: string;
    invoice_ref: string | null;
    content_hash: string | null;
    invoice_pdf_url: string | null;
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
    const [fleet, aircraftRes, invoicesRes, receiptRes] = await Promise.all([
        getOwnerFleet(principal.supabase),
        // RLS (mig-074 policy) scopes aircraft to the operating shipowner via
        // shipowners.profile_id = auth.uid(); no manual operator filter required.
        principal.supabase
            .from('aircraft')
            .select('id, icao24, registration, icao_type, engine_type, compliance_status')
            .order('registration'),
        principal.supabase
            .from('transactions')
            .select('id, invoice_ref, content_hash, invoice_pdf_url, vessel_name, tax_amount_usd, status, created_at, mode, breakdown_json')
            .order('created_at', { ascending: false })
            .limit(5),
        // Recus des paiements confirmes. Meme requete que la page factures :
        // RLS mig 058 la borne a l'armateur, ordre croissant pour que le
        // dernier recu d'une facture ecrase les precedents dans la table.
        principal.supabase
            .from('payments')
            .select('transaction_id, receipt_ref, confirmed_at')
            .eq('shipowner_id', principal.shipowner.id)
            .eq('status', 'CONFIRMED')
            .not('receipt_ref', 'is', null)
            .order('confirmed_at', { ascending: true }),
    ]);

    const aircraft: AircraftRow[] = (aircraftRes.data ?? []) as AircraftRow[];
    const recent: RecentInvoice[] = (invoicesRes.data ?? []) as RecentInvoice[];

    const receiptByTxn = new Map<string, string>();
    for (const p of (receiptRes.data ?? []) as {
        transaction_id: string;
        receipt_ref: string | null;
    }[]) {
        if (p.receipt_ref) receiptByTxn.set(p.transaction_id, p.receipt_ref);
    }

    const t = await getTranslations('OwnerPortal.fleet');

    return (
        <div className="mx-auto flex max-w-6xl flex-col gap-[18px] p-4 sm:p-6">
            <OsPageHeader
                title={t('verdict', { total: fleet.counts.all, action: fleet.actionCount })}
                subtitle={t('subtitle')}
            />

            <FleetBoard fleet={fleet} vesselBasePath="/dashboard/vessels" />

            {(aircraft.length > 0 || aircraftRes.error) && (
                <section>
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
                <section>
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
                                    <div className="flex items-center justify-end gap-3 mt-1.5">
                                        {buildInvoiceDownloadUrl(inv) && (
                                            <a
                                                href={buildInvoiceDownloadUrl(inv) as string}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
                                                aria-label={`Download PDF for ${inv.invoice_ref ?? inv.id}`}
                                            >
                                                <Download className="w-3 h-3" />
                                                PDF
                                            </a>
                                        )}
                                        {receiptByTxn.get(inv.id) && (
                                            <a
                                                href={`/api/receipts/${encodeURIComponent(receiptByTxn.get(inv.id) as string)}/download`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
                                                aria-label={`Download receipt ${receiptByTxn.get(inv.id)}`}
                                            >
                                                <Receipt className="w-3 h-3" />
                                                Receipt
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
