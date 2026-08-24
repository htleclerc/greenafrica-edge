'use client';

import * as React from 'react';
import { Download, Loader2, Paperclip, Receipt, Scale } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsUrgencyPill } from '@/components/ui/OsUrgencyPill';
import { accentStyle, type OsAccent } from '@/lib/osAccent';
import { usdGrouped } from '@/lib/osMoney';
import { buildCalculationSteps } from '@/services/invoiceCalculationSteps';
import { daysToDue, urgencyOf } from '@/services/ownerWorkQueue';
import type { OwnerPrivileges } from '@/lib/auth/ownerPrivileges';
import type { InvoiceRow } from './InvoicesTable';

const URGENCY_ACCENT: Record<string, OsAccent> = {
    overdue: 'danger',
    dueSoon: 'warning',
    upcoming: 'info',
};

/**
 * Une charge dont l'autorité est censée avoir émis un PDF.
 *
 * Un remboursement est un avoir soldé par le portefeuille : il ne porte pas un
 * tel document, et l'absence de PDF sur une ligne de remboursement est normale,
 * pas une lacune. Lui proposer « Émettre le PDF » signalerait un manque
 * inexistant.
 */
function expectsDocument(row: InvoiceRow): boolean {
    return row.document_type === 'PROFORMA'
        || row.document_type === 'FINAL'
        || row.document_type === 'COMPLEMENT';
}

/** Moyens proposés à l'armateur, dans l'ordre où ils règlent vite. */
type Method = 'wire' | 'wallet' | 'desk';
const METHODS: Method[] = ['wire', 'wallet', 'desk'];

interface Props {
    invoice: InvoiceRow;
    walletBalanceUsdMinor: number;
    /**
     * Sous-permissions de la personne connectée (mig 135). Elles masquent
     * l'action, elles ne la protègent pas : le refus qui compte est celui de
     * l'action serveur et de la policy. Masquer sert à ne pas proposer un geste
     * qui sera refusé après coup, une fois le formulaire rempli.
     */
    privileges: OwnerPrivileges;
    /** Vrai pour un membre invité : lui seul a besoin qu'on explique l'absence. */
    isMember: boolean;
    onPay: () => void;
    onDispute: () => void;
    onAttachProof: () => void;
    onIssuePdf: () => void;
    issuing: boolean;
    issueError?: string;
    onClose: () => void;
}

/**
 * Panneau de détail d'une facture.
 *
 * Ne jamais afficher le montant seul : la décomposition émissions × tarif est
 * ce qui rend la facture contestable ou acceptable, et c'est donc le contenu
 * principal du panneau, pas une annexe repliée.
 *
 * Les étapes viennent de `buildCalculationSteps`, la même fonction qui compose
 * la page « CALCULATION DETAILS » du PDF : le panneau et le document ne peuvent
 * pas diverger, ce qui est la condition pour qu'une contestation porte.
 */
export function InvoiceDetailPanel({
    invoice, walletBalanceUsdMinor, privileges, isMember, onPay, onDispute, onAttachProof,
    onIssuePdf, issuing, issueError, onClose,
}: Props) {
    const t = useTranslations('OwnerPortal.invoiceDetail');
    const [method, setMethod] = React.useState<Method>('wire');

    // `partial_paid_usd` est gelee par la mig 089 et vaut zero sur toute
    // facture en cours : l'encaissement reel vient des paiements CONFIRMED.
    const paidUsd = Math.max(
        Number(invoice.partial_paid_usd ?? 0),
        Number(invoice.confirmed_paid_usd ?? 0),
    );
    const amountUsd = Math.max(0, Number(invoice.tax_amount_usd) - paidUsd);
    const days = daysToDue(invoice.due_date ?? null);
    const paid = invoice.status === 'PAID';
    const accent: OsAccent = paid ? 'success' : URGENCY_ACCENT[urgencyOf(days)];

    const steps = buildCalculationSteps({
        breakdown: invoice.breakdown_json ?? null,
        emissionsTco2: Number(invoice.emissions_tco2 ?? 0),
        ratePerTco2: Number(invoice.emissions_tco2)
            ? Number(invoice.tax_amount_usd) / Number(invoice.emissions_tco2)
            : 0,
        totalUsd: Number(invoice.tax_amount_usd),
        decreeReference: t('decreeReference'),
    });

    const walletUsd = walletBalanceUsdMinor / 100;
    const walletShort = walletUsd < amountUsd;
    const payable = invoice.document_type === 'PROFORMA' && invoice.status === 'PENDING';

    return (
        <aside style={accentStyle(accent)} className="os-card flex flex-col overflow-hidden">
            <header className="flex items-start justify-between gap-3 border-b border-[var(--os-border)] px-[18px] py-3.5">
                <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-mono text-[13px] text-[var(--os-text-primary)]">
                        {invoice.invoice_ref ?? invoice.id.slice(0, 8)}
                    </span>
                    <span className="truncate text-[12.5px] text-[var(--os-text-muted)]">{invoice.vessel_name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <OsUrgencyPill accent={accent} className="!rounded-full !px-2.5 !py-0.5 !tracking-[0.04em]">
                        {paid ? t('status.paid') : t(`status.${urgencyOf(days)}`)}
                    </OsUrgencyPill>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-[12.5px] text-[var(--os-text-muted)] transition-colors duration-150 hover:text-[var(--os-text-primary)] lg:hidden"
                    >
                        {t('close')}
                    </button>
                </div>
            </header>

            {/* ── Décomposition du calcul ──────────────────────────────────── */}
            <dl className="flex flex-col px-[18px] py-3.5">
                {steps.map((s) => (
                    <div
                        key={s.step}
                        className={`
                            flex items-baseline justify-between gap-3 border-b border-[var(--os-border)] py-2.5 last:border-b-0
                            ${s.total ? 'font-semibold' : ''}
                        `}
                    >
                        <dt className="min-w-0 text-[12.5px] text-[var(--os-text-muted)]">
                            <span className="block text-[var(--os-text-secondary)]">{s.step}</span>
                            {s.source && <span className="block text-[11px]">{s.source}</span>}
                        </dt>
                        <dd className="shrink-0 font-mono text-[12.5px] tabular-nums text-[var(--os-text-primary)]">
                            {s.value}
                        </dd>
                    </div>
                ))}
            </dl>

            <div className="flex items-baseline justify-between gap-3 border-t border-[var(--os-border)] px-[18px] py-3.5">
                <span className="text-[13px] text-[var(--os-text-secondary)]">
                    {paidUsd > 0 ? t('remainingDue') : t('totalDue')}
                </span>
                <span className="font-mono text-[28px] font-semibold leading-none tabular-nums text-[var(--os-text-primary)]">
                    {usdGrouped(amountUsd)}
                </span>
            </div>

            <div className="flex flex-col gap-2.5 px-[18px] pb-[18px]">
                {payable && privileges.canPay && (
                    <button
                        type="button"
                        onClick={onPay}
                        className="flex h-[46px] items-center justify-center rounded-[11px] bg-[var(--os-brand-green)] px-4 text-sm font-semibold text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                    >
                        {t('pay', { amount: usdGrouped(amountUsd) })}
                    </button>
                )}

                <div className="flex flex-wrap gap-2.5">
                    {invoice.download_url ? (
                        <a
                            href={invoice.download_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--os-border-strong)] px-3 text-[13px] text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)]"
                        >
                            <Download className="size-3.5" aria-hidden />
                            {t('downloadPdf')}
                        </a>
                    ) : expectsDocument(invoice) ? (
                        <button
                            type="button"
                            onClick={onIssuePdf}
                            disabled={issuing}
                            title={t('issuePdfHint')}
                            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--os-border-strong)] px-3 text-[13px] text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)] disabled:opacity-50"
                        >
                            {issuing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
                            {issuing ? t('issuing') : t('issuePdf')}
                        </button>
                    ) : null}

                    {/* Le reçu de paiement est un document distinct de la facture :
                        il reste accessible même quand le PDF de la charge manque. */}
                    {invoice.receipt_ref && (
                        <a
                            href={`/api/receipts/${encodeURIComponent(invoice.receipt_ref)}/download`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--os-border-strong)] px-3 text-[13px] text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)]"
                        >
                            <Receipt className="size-3.5" aria-hidden />
                            {t('receipt')}
                        </a>
                    )}
                    {privileges.canDispute && (
                    <button
                        type="button"
                        onClick={onDispute}
                        className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--os-border-strong)] px-3 text-[13px] text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)]"
                    >
                        <Scale className="size-3.5" aria-hidden />
                        {t('dispute')}
                    </button>
                    )}
                </div>

                {/* Un titulaire n'a rien à lire ici : il a tout. Un membre, si,
                    sinon l'absence du bouton se lit comme une panne. */}
                {isMember && (!privileges.canPay || !privileges.canDispute) && (
                    <p className="text-[11.5px] text-[var(--os-text-muted)]">{t('restricted')}</p>
                )}

                {issueError && <p className="text-[11px] text-[var(--os-red)]">{issueError}</p>}

                {/* Un justificatif se rattache TOUJOURS a un paiement declare.
                    Le bouton n'apparait donc que si l'armateur en a declare un
                    et qu'il reste a rapprocher — et il dit lequel des deux
                    gestes il propose : completer une declaration a laquelle il
                    manque sa piece, ou revoir celle deja fournie. */}
                {invoice.pending_declared_payment_id && privileges.canPay && (
                    <button
                        type="button"
                        onClick={onAttachProof}
                        className={`flex h-10 items-center justify-center gap-1.5 rounded-[10px] border px-3 text-[13px] transition-colors duration-150 hover:bg-[var(--os-surface-2)] ${
                            invoice.pending_payment_has_proof
                                ? 'border-[var(--os-border-strong)] text-[var(--os-text-secondary)]'
                                : 'border-amber-500/40 text-amber-300'
                        }`}
                    >
                        <Paperclip className="size-3.5" aria-hidden />
                        {invoice.pending_payment_has_proof ? t('reviewProof') : t('completeProof')}
                    </button>
                )}
            </div>

            {/* ── Moyen de paiement ────────────────────────────────────────── */}
            {payable && privileges.canPay && (
                <fieldset className="flex flex-col gap-2 border-t border-[var(--os-border)] px-[18px] py-3.5">
                    <legend className="mb-1 text-[13px] font-semibold text-[var(--os-text-primary)]">
                        {t('methodLegend')}
                    </legend>
                    {METHODS.map((m) => {
                        const selected = m === method;
                        // Le portefeuille annonce son solde et prévient s'il ne
                        // suffit pas : découvrir l'insuffisance au moment de payer
                        // est le pire endroit pour l'apprendre.
                        const short = m === 'wallet' && walletShort;
                        return (
                            <label
                                key={m}
                                className={`
                                    flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3.5 py-3
                                    transition-colors duration-150
                                    ${selected
                                        ? 'border-[var(--os-brand-green)]/45 bg-[var(--os-brand-green)]/6'
                                        : 'border-[var(--os-border)] hover:bg-[var(--os-surface-2)]'}
                                `}
                            >
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="text-[13px] font-semibold text-[var(--os-text-primary)]">
                                        {t(`method.${m}.label`)}
                                    </span>
                                    <span className={`text-[11.5px] ${short ? 'text-[var(--os-yellow)]' : 'text-[var(--os-text-muted)]'}`}>
                                        {m === 'wallet'
                                            ? short
                                                ? t('method.wallet.short', { balance: usdGrouped(walletUsd) })
                                                : t('method.wallet.covers', { balance: usdGrouped(walletUsd) })
                                            : t(`method.${m}.hint`)}
                                    </span>
                                </span>
                                <input
                                    type="radio"
                                    name="payment-method"
                                    value={m}
                                    checked={selected}
                                    onChange={() => setMethod(m)}
                                    className="size-4 shrink-0 accent-[var(--os-brand-green)]"
                                />
                            </label>
                        );
                    })}
                </fieldset>
            )}
        </aside>
    );
}
