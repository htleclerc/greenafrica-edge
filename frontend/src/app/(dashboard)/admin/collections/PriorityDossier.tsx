'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { OsButton } from '@/components/ui/OsButton';
import { escalateCollection } from '@/actions/escalateCollection';
import { recordDebtorResponse } from '@/actions/recordDebtorResponse';
import { accentColor, type OsAccent } from '@/lib/osAccent';
import { usdGrouped } from '@/lib/osMoney';
import type { PriorityDossier as Dossier } from '@/services/collectionFunnel';

/**
 * Valeurs d'énumération traduites. Un palier ou une réponse absent de ces
 * ensembles est affiché brut plutôt que de faire échouer le rendu : la base peut
 * gagner une valeur avant que les six locales ne la connaissent.
 */
const KNOWN_TIERS = new Set(['J3', 'J7', 'J15', 'J30', 'J45', 'BAILIFF', 'JUDICIAL', 'MANUAL']);
const KNOWN_RESPONSES = new Set(['SILENT', 'ACKNOWLEDGE', 'DISPUTE', 'PAYMENT_PROMISE', 'PARTIAL_PAYMENT', 'PAID', 'REFUSED']);

/** Même code couleur que la file : un palier garde sa couleur d'un panneau à l'autre. */
function tierAccent(tier: string): OsAccent {
    if (tier === 'J3' || tier === 'J7') return 'warning';
    if (tier === 'J15' || tier === 'J30') return 'mid';
    if (tier === 'J45' || tier === 'BAILIFF' || tier === 'JUDICIAL') return 'danger';
    return 'info';
}

/**
 * Le dossier que l'agent doit traiter en premier, en trois panneaux : ce qui
 * s'est passé, ce qui est exposé, et ce qu'il reste à faire.
 *
 * Le troisième panneau énonce la conséquence concrète avant de proposer le
 * bouton — « blocage de l'appareillage » se décide autrement que « escalader ».
 */
export function PriorityDossier(
    { dossier, shipownerRef }: { dossier: Dossier; shipownerRef: string | null },
) {
    const t = useTranslations('AdminCollections');
    const router = useRouter();

    const [escalateTier, setEscalateTier] = React.useState<'BAILIFF' | 'JUDICIAL' | null>(null);
    const [escalateError, setEscalateError] = React.useState<string | null>(null);
    const [escalating, startEscalate] = React.useTransition();

    const [planOpen, setPlanOpen] = React.useState(false);
    const [planError, setPlanError] = React.useState<string | null>(null);
    const [planning, startPlan] = React.useTransition();

    function confirmEscalate() {
        if (!escalateTier) return;
        setEscalateError(null);
        startEscalate(async () => {
            const res = await escalateCollection({ transactionId: dossier.transactionId, tier: escalateTier });
            if (!res.ok) { setEscalateError(res.reason); return; }
            setEscalateTier(null);
            router.refresh();
        });
    }

    function confirmPlan() {
        setPlanError(null);
        startPlan(async () => {
            // Un échéancier accordé est, dans le registre existant, une promesse
            // de paiement du débiteur : elle suspend la rampe et laisse une trace.
            const res = await recordDebtorResponse({
                transactionId: dossier.transactionId,
                responseType: 'PAYMENT_PROMISE',
            });
            if (!res.ok) { setPlanError(res.reason); return; }
            setPlanOpen(false);
            router.refresh();
        });
    }

    const tierLabel = (tier: string) => (KNOWN_TIERS.has(tier) ? t(`tier.${tier}`) : tier);
    const responseLabel = (resp: string) => (KNOWN_RESPONSES.has(resp) ? t(`response.${resp}`) : resp);

    const nextTier: 'BAILIFF' | 'JUDICIAL' | null =
        dossier.canBailiff ? 'BAILIFF' : dossier.canJudicial ? 'JUDICIAL' : null;

    const ref = dossier.invoiceRef ?? dossier.transactionId.slice(0, 8);

    return (
        <section className="os-card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--os-border)] px-[18px] py-3.5">
                <h2 className="text-sm font-semibold text-[var(--os-text-primary)]">
                    {t('priorityTitle', { debtor: dossier.debtorName })}
                </h2>
                {shipownerRef && (
                    <Link
                        href={`/admin/armateurs/${shipownerRef}`}
                        className="text-[12.5px] font-semibold text-[var(--os-brand-cyan)] transition-opacity duration-150 hover:opacity-80"
                    >
                        {t('priorityOpenFile')} →
                    </Link>
                )}
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3">
                {/* ── Historique ────────────────────────────────────────────── */}
                <div className="flex flex-col gap-2.5 border-b border-[var(--os-border)] p-[18px] lg:border-b-0 lg:border-r">
                    <PanelLabel>{t('panelHistory')}</PanelLabel>
                    {dossier.reminders.length === 0 ? (
                        <p className="text-[12.5px] text-[var(--os-text-muted)]">{t('no_reminders')}</p>
                    ) : (
                        <ol className="flex flex-col gap-2.5">
                            {dossier.reminders.slice(0, 4).map((r) => (
                                <li key={r.id} className="flex gap-2.5">
                                    <span
                                        aria-hidden
                                        className="mt-[5px] block size-[7px] shrink-0 rounded-full"
                                        style={{ backgroundColor: accentColor(tierAccent(r.tier)) }}
                                    />
                                    <span className="flex min-w-0 flex-col gap-px">
                                        <span className="text-[12.5px] text-[var(--os-text-primary)]">
                                            {tierLabel(r.tier)}
                                        </span>
                                        <span className="text-[11.5px] text-[var(--os-text-muted)]">
                                            {new Date(r.sentAt).toLocaleDateString()} · {responseLabel(r.responseType)}
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>

                {/* ── Exposition ────────────────────────────────────────────── */}
                <dl className="flex flex-col gap-2.5 border-b border-[var(--os-border)] p-[18px] lg:border-b-0 lg:border-r">
                    <PanelLabel>{t('panelExposure')}</PanelLabel>
                    <Pair label={t('col_outstanding')} mono>{usdGrouped(dossier.outstandingUsd)}</Pair>
                    <Pair label={t('col_invoice')} mono>{ref}</Pair>
                    <Pair label={t('f_jurisdiction')}>{dossier.jurisdictionName ?? '—'}</Pair>
                    <Pair label={t('col_count')}>
                        {dossier.manualCount > 0
                            ? t('remindersWithManual', { count: dossier.reminderCount, manual: dossier.manualCount })
                            : String(dossier.reminderCount)}
                    </Pair>
                    <Pair label={t('col_response')}>
                        {responseLabel(dossier.latestResponseType ?? 'SILENT')}
                    </Pair>
                </dl>

                {/* ── Action suivante ───────────────────────────────────────── */}
                <div className="flex flex-col gap-2.5 p-[18px]">
                    <PanelLabel>{t('panelNext')}</PanelLabel>
                    <p className="text-[13px] leading-relaxed text-[var(--os-text-secondary)]">
                        {nextTier === 'BAILIFF' ? t('consequenceBailiff')
                            : nextTier === 'JUDICIAL' ? t('consequenceJudicial')
                            : t('consequenceRamp')}
                    </p>
                    <button
                        type="button"
                        disabled={!nextTier}
                        title={nextTier ? undefined : t('escalate_ramp_bailiff')}
                        onClick={() => { setEscalateError(null); setEscalateTier(nextTier); }}
                        className="flex h-[42px] items-center justify-center rounded-[10px] bg-[var(--os-brand-green)] px-4 text-[13.5px] font-semibold text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                    >
                        {nextTier === 'JUDICIAL' ? t('escalate_judicial') : t('escalate_bailiff')}
                    </button>
                    <button
                        type="button"
                        onClick={() => { setPlanError(null); setPlanOpen(true); }}
                        className="flex h-[38px] items-center justify-center rounded-[10px] border border-[var(--os-border-strong)] px-4 text-[13px] text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                    >
                        {t('grantPlan')}
                    </button>
                </div>
            </div>

            <ConfirmDialog
                open={escalateTier !== null}
                onOpenChange={(o) => !o && setEscalateTier(null)}
                title={t('escalate_dialog_title')}
                body={t('escalate_dialog_subtitle', { tier: escalateTier ?? '', ref })}
                error={escalateError}
                cancel={t('cancel')}
                confirm={t('escalate_confirm')}
                pending={escalating}
                danger
                onConfirm={confirmEscalate}
                onCancel={() => setEscalateTier(null)}
            />
            <ConfirmDialog
                open={planOpen}
                onOpenChange={setPlanOpen}
                title={t('grantPlan')}
                body={t('grantPlanConfirm', { debtor: dossier.debtorName, ref })}
                error={planError}
                cancel={t('cancel')}
                confirm={t('save')}
                pending={planning}
                onConfirm={confirmPlan}
                onCancel={() => setPlanOpen(false)}
            />
        </section>
    );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
            {children}
        </h3>
    );
}

function Pair({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-[12.5px] text-[var(--os-text-muted)]">
            <dt>{label}</dt>
            <dd className={`text-right ${mono ? 'font-mono tabular-nums text-[var(--os-text-primary)]' : 'text-[var(--os-text-secondary)]'}`}>
                {children}
            </dd>
        </div>
    );
}

function ConfirmDialog({
    open, onOpenChange, title, body, error, cancel, confirm, pending, danger, onConfirm, onCancel,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    body: string;
    error: string | null;
    cancel: string;
    confirm: string;
    pending: boolean;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.6)' }} />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                    style={{ background: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                >
                    <Dialog.Title className="text-sm font-bold text-[var(--os-text-primary)]">{title}</Dialog.Title>
                    <Dialog.Description className="mt-1 text-xs text-[var(--os-text-muted)]">{body}</Dialog.Description>
                    {error && <p className="mt-2 text-xs text-[var(--os-red)]">{error}</p>}
                    <div className="mt-4 flex justify-end gap-2">
                        <OsButton size="sm" variant="ghost" onClick={onCancel} disabled={pending}>{cancel}</OsButton>
                        <OsButton size="sm" variant={danger ? 'danger' : 'primary'} loading={pending} onClick={onConfirm}>
                            {confirm}
                        </OsButton>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
