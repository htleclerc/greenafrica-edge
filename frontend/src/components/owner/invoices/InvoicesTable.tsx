'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { issueOwnerProforma } from '@/actions/issueOwnerProforma';
import { OsFilterTabs } from '@/components/ui/OsFilterTabs';
import { OsPageHeader } from '@/components/ui/OsPageHeader';
import { OsUrgencyPill } from '@/components/ui/OsUrgencyPill';
import { PayDialog } from '@/components/owner/PayDialog';
import { accentStyle, type OsAccent } from '@/lib/osAccent';
import { usdGrouped } from '@/lib/osMoney';
import { daysToDue, urgencyOf } from '@/services/ownerWorkQueue';
import { OpenDisputeDialog } from './OpenDisputeDialog';
import { AttachProofDialog } from './AttachProofDialog';
import { InvoiceDetailPanel } from './InvoiceDetailPanel';

export interface InvoiceRow {
    id: string;
    invoice_ref: string | null;
    content_hash: string | null;
    document_type: 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND' | null;
    vessel_name: string;
    tax_amount_usd: number;
    status: string;
    paid_at: string | null;
    created_at: string;
    /** Server-side pre-computed signed URL or null if no PDF available. */
    download_url: string | null;
    /** Receipt reference of the latest CONFIRMED payment, or null if none. */
    receipt_ref: string | null;
    /** Paiement DECLARE encore en attente de rapprochement, ou null. */
    pending_declared_payment_id: string | null;
    /** Vrai si ce paiement porte deja au moins une piece justificative. */
    pending_payment_has_proof?: boolean;
    /** Échéance — pilote l'urgence de la ligne. */
    due_date?: string | null;
    /** Acomptes déjà encaissés, déduits du reste dû. */
    /** Gelee par la mig 089, jamais ecrite : ne jamais s'en servir seule. */
    partial_paid_usd?: number | null;
    /** Encaisse reel, lu dans les paiements CONFIRMED. */
    confirmed_paid_usd?: number | null;
    /** Base taxable, pour la décomposition du panneau de détail. */
    emissions_tco2?: number | null;
    /** Chaîne réellement appliquée par le moteur, telle qu'elle figure sur le PDF. */
    breakdown_json?: unknown;
}

/** Les quatre familles d'un compte armateur. Le libellé dit l'état, pas le type. */
type Tab = 'open' | 'paid' | 'disputed' | 'draft';
const TABS: Tab[] = ['open', 'paid', 'disputed', 'draft'];

const OPEN_STATUSES = new Set(['PENDING', 'OVERDUE', 'PARTIAL', 'PARTIALLY_PAID']);

export function tabOf(row: InvoiceRow): Tab {
    if (row.status === 'PAID') return 'paid';
    if (row.status === 'DISPUTED') return 'disputed';
    if (OPEN_STATUSES.has(row.status)) return 'open';
    return 'draft';
}

/** Reste réellement dû sur une facture, acomptes déduits. */
export function remainingUsd(row: InvoiceRow): number {
    const paid = Math.max(Number(row.partial_paid_usd ?? 0), Number(row.confirmed_paid_usd ?? 0));
    return Math.max(0, Number(row.tax_amount_usd) - paid);
}

const URGENCY_ACCENT: Record<string, OsAccent> = {
    overdue: 'danger',
    dueSoon: 'warning',
    upcoming: 'info',
};

interface Props {
    rows: InvoiceRow[];
    walletBalanceUsdMinor: number;
}

/**
 * Factures & paiements (2c du handoff).
 *
 * Deux colonnes : la liste à gauche, le détail à droite. Les cases à cocher
 * pilotent le libellé du bouton primaire de page, qui affiche le total
 * sélectionné ; sans sélection il retombe sur « Payer tout ».
 */
export function InvoicesTable({ rows, walletBalanceUsdMinor }: Props) {
    const t = useTranslations('OwnerPortal.invoicesList');
    const router = useRouter();

    // Ouvrir sur « Ouvertes » quand il y a quelque chose à régler, sinon sur la
    // première famille non vide : un compte entièrement soldé ne doit pas
    // s'ouvrir sur un onglet vide, qui se lit comme une erreur de chargement.
    const [tab, setTab] = React.useState<Tab>(
        () => TABS.find((candidate) => rows.some((r) => tabOf(r) === candidate)) ?? 'open',
    );
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [checked, setChecked] = React.useState<Set<string>>(new Set());

    const [payTarget, setPayTarget] = React.useState<InvoiceRow | null>(null);
    const [disputeTarget, setDisputeTarget] = React.useState<InvoiceRow | null>(null);
    const [proofTarget, setProofTarget] = React.useState<InvoiceRow | null>(null);
    const [issuingId, setIssuingId] = React.useState<string | null>(null);
    const [issueError, setIssueError] = React.useState<Record<string, string>>({});

    const counts = React.useMemo(() => {
        const c: Record<Tab, number> = { open: 0, paid: 0, disputed: 0, draft: 0 };
        for (const r of rows) c[tabOf(r)] += 1;
        return c;
    }, [rows]);

    const visible = React.useMemo(() => rows.filter((r) => tabOf(r) === tab), [rows, tab]);

    // La sélection ne survit pas à un changement d'onglet : cocher trois factures
    // ouvertes puis passer aux payées laisserait un total qui ne correspond à
    // rien de visible.
    React.useEffect(() => { setChecked(new Set()); }, [tab]);

    const selected = React.useMemo(
        () => rows.find((r) => r.id === selectedId) ?? visible[0] ?? null,
        [rows, selectedId, visible],
    );

    const openRows = React.useMemo(() => rows.filter((r) => tabOf(r) === 'open'), [rows]);
    const checkedRows = visible.filter((r) => checked.has(r.id));
    const totalUsd = (checkedRows.length > 0 ? checkedRows : openRows).reduce(
        (sum, r) => sum + remainingUsd(r), 0,
    );
    const overdueCount = openRows.filter((r) => urgencyOf(daysToDue(r.due_date ?? null)) === 'overdue').length;

    function toggle(id: string) {
        setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    async function issue(r: InvoiceRow) {
        setIssuingId(r.id);
        setIssueError((e) => ({ ...e, [r.id]: '' }));
        try {
            await issueOwnerProforma({ transactionId: r.id });
            // Le lien de téléchargement est calculé côté serveur : il faut
            // relire la page pour qu'il apparaisse.
            router.refresh();
        } catch (e) {
            setIssueError((prev) => ({ ...prev, [r.id]: e instanceof Error ? e.message : 'Issue failed' }));
        } finally {
            setIssuingId(null);
        }
    }

    return (
        <div className="flex flex-col gap-[18px]">
            <OsPageHeader
                title={t('verdict', { amount: usdGrouped(totalUsd) })}
                subtitle={t('context', { count: counts.open, overdue: overdueCount })}
                actions={
                    openRows.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setPayTarget(checkedRows[0] ?? openRows[0])}
                            className="flex h-10 items-center rounded-[10px] bg-[var(--os-brand-green)] px-[18px] text-[13.5px] font-semibold text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90"
                        >
                            {checkedRows.length > 0
                                ? t('paySelection', { count: checkedRows.length, amount: usdGrouped(totalUsd) })
                                : t('payAll', { amount: usdGrouped(totalUsd) })}
                        </button>
                    )
                }
            />

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_380px]">
                <section className="os-card overflow-hidden">
                    <header className="border-b border-[var(--os-border)] px-[18px] py-3.5">
                        <OsFilterTabs
                            label={t('tabsLabel')}
                            value={tab}
                            onChange={(v) => setTab(v as Tab)}
                            tabs={TABS.map((key) => ({ value: key, label: t(`tab.${key}`), count: counts[key] }))}
                        />
                    </header>

                    <div className="os-invoice-head gap-3 border-b border-[var(--os-border)] bg-[var(--os-surface-sunken)] px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--os-text-muted)]">
                        <span aria-hidden />
                        <span>{t('col.reference')}</span>
                        <span>{t('col.vessel')}</span>
                        <span>{t('col.due')}</span>
                        <span className="text-right">{t('col.amount')}</span>
                    </div>

                    {visible.length === 0 ? (
                        <p className="px-[18px] py-10 text-center text-[13px] text-[var(--os-text-muted)]">
                            {t('empty')}
                        </p>
                    ) : (
                        visible.map((r) => {
                            const days = daysToDue(r.due_date ?? null);
                            const paid = r.status === 'PAID';
                            const accent: OsAccent = paid ? 'success' : URGENCY_ACCENT[urgencyOf(days)];
                            const isSelected = selected?.id === r.id;
                            return (
                                <div
                                    key={r.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-current={isSelected}
                                    onClick={() => setSelectedId(r.id)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(r.id); }
                                    }}
                                    style={accentStyle(accent)}
                                    className={`
                                        os-invoice-row cursor-pointer items-center gap-3 border-b border-[var(--os-border-row)]
                                        px-[18px] py-3 text-left transition-colors duration-150 last:border-b-0
                                        hover:bg-[var(--os-surface-2)]
                                        focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--os-brand-green)]
                                        ${isSelected ? 'border-l-2 border-l-[var(--os-brand-green)] bg-[var(--os-brand-green)]/6' : ''}
                                        ${paid ? 'opacity-[0.72]' : ''}
                                    `}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked.has(r.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={() => toggle(r.id)}
                                        aria-label={t('select', { ref: r.invoice_ref ?? r.id.slice(0, 8) })}
                                        className="size-4 accent-[var(--os-brand-green)]"
                                    />
                                    <span className="flex min-w-0 flex-col gap-1">
                                        <span className="truncate font-mono text-[12.5px] text-[var(--os-text-primary)]">
                                            {r.invoice_ref ?? r.id.slice(0, 8)}
                                        </span>
                                        <OsUrgencyPill accent={accent} className="self-start !px-2 !py-0.5">
                                            {paid ? t('status.paid') : t(`status.${urgencyOf(days)}`)}
                                        </OsUrgencyPill>
                                    </span>
                                    <span className="truncate text-[12.5px] text-[var(--os-text-secondary)]">
                                        {r.vessel_name}
                                    </span>
                                    <span className="truncate text-[12.5px] text-[var(--os-text-muted)]">
                                        {r.due_date ? new Date(r.due_date).toLocaleDateString() : t('onCall')}
                                    </span>
                                    <span className="text-right font-mono text-[13px] tabular-nums text-[var(--os-text-primary)]">
                                        {usdGrouped(remainingUsd(r))}
                                    </span>
                                </div>
                            );
                        })
                    )}
                </section>

                {selected && (
                    <InvoiceDetailPanel
                        invoice={selected}
                        walletBalanceUsdMinor={walletBalanceUsdMinor}
                        onPay={() => setPayTarget(selected)}
                        onDispute={() => setDisputeTarget(selected)}
                        onAttachProof={() => setProofTarget(selected)}
                        onIssuePdf={() => issue(selected)}
                        issuing={issuingId === selected.id}
                        issueError={issueError[selected.id] || undefined}
                        onClose={() => setSelectedId(null)}
                    />
                )}
            </div>

            {payTarget && (
                <PayDialog
                    open
                    onOpenChange={(o) => !o && setPayTarget(null)}
                    transactionId={payTarget.id}
                    invoiceRef={payTarget.invoice_ref ?? payTarget.id.slice(0, 8)}
                    amountUsd={remainingUsd(payTarget)}
                    currency="USD"
                    walletBalanceUsdMinor={walletBalanceUsdMinor}
                />
            )}
            {disputeTarget && (
                <OpenDisputeDialog
                    open
                    onOpenChange={(o) => !o && setDisputeTarget(null)}
                    transactionId={disputeTarget.id}
                    invoiceRef={disputeTarget.invoice_ref ?? disputeTarget.id.slice(0, 8)}
                />
            )}
            {proofTarget?.pending_declared_payment_id && (
                <AttachProofDialog
                    open
                    onOpenChange={(o) => !o && setProofTarget(null)}
                    paymentId={proofTarget.pending_declared_payment_id}
                    invoiceRef={proofTarget.invoice_ref ?? proofTarget.id.slice(0, 8)}
                    hasProof={proofTarget.pending_payment_has_proof ?? false}
                />
            )}
        </div>
    );
}
