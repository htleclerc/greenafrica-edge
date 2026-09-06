// Vue d'ensemble de l'armateur (2a du handoff de refonte).
//
// Ordre vertical, et c'est le cœur de la refonte : en-tête verdict, **file de
// travail**, puis bandeau KPI, puis flotte. Les KPI sont passés sous la file :
// ils informent, ils ne déclenchent rien. L'écran s'ouvre sur « N choses à
// traiter », pas sur quatre chiffres au milieu desquels il faut choisir.
//
// Servie par /dashboard quand le principal est un opérateur, et par
// /owner/dashboard via un fin adaptateur. Toutes les lectures passent par
// principal.supabase, donc bornées par RLS.

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Principal } from '@/lib/auth/requirePrincipal';
import { OsPageHeader } from '@/components/ui/OsPageHeader';
import { OsKpiBand, type OsKpiCell } from '@/components/ui/OsKpiBand';
import { WorkQueueRow } from '@/components/owner/WorkQueueRow';
import { OverdueActionBand } from '@/components/owner/OverdueActionBand';
import { KycCBanner } from '@/components/owner/KycCBanner';
import { PaymentOnboardingChecklist } from '@/components/onboarding/PaymentOnboardingChecklist';
import { derivePaymentChecklist } from '@/lib/onboarding/paymentChecklist';
import { getOwnerOverview, splitActionBand } from '@/services/ownerWorkQueue';
import { portalPaths } from '@/lib/auth/portalPaths';
import { usdCompact, usdGrouped } from '@/lib/osMoney';

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
}

export async function OperatorDashboardPage({ principal }: Props) {
    const t = await getTranslations('OwnerPortal.dashboard');
    const paths = portalPaths(principal);

    const [overview, { count: vesselCount }, { count: paymentCount }] = await Promise.all([
        getOwnerOverview(principal.supabase, principal.shipowner.id),
        principal.supabase
            .from('transactions')
            .select('id', { count: 'exact', head: true })
            .eq('shipowner_id', principal.shipowner.id),
        principal.supabase
            .from('payments')
            .select('id', { count: 'exact', head: true })
            .eq('shipowner_id', principal.shipowner.id)
            .eq('status', 'CONFIRMED'),
    ]);

    // Faits dérivés pour la checklist de progression — jamais persistés,
    // toujours recalculés depuis l'état réel des tables (cf paymentChecklist.ts).
    const checklist = derivePaymentChecklist({
        accountState: String(principal.shipowner.account_state),
        hasAttachedVessel: (vesselCount ?? 0) > 0,
        billingComplete: Boolean(principal.shipowner.kyc_level_c_completed_at),
        hasConfirmedPayment: (paymentCount ?? 0) > 0,
    });

    // Bande d'action : réservée à une échéance réellement dépassée, et au seul
    // dossier le plus ancien (cf. splitActionBand).
    const { band, rows: queueRows } = splitActionBand(overview.queue);

    const kpis: OsKpiCell[] = [
        {
            label: t('kpi.outstanding'),
            value: usdCompact(overview.outstandingUsd),
            note: t('kpi.outstandingNote', { count: overview.openCount }),
        },
        {
            label: t('kpi.vessels'),
            value: String(overview.activeVessels),
            note: t('kpi.vesselsNote'),
        },
        {
            label: t('kpi.paidYtd', { year: new Date().getFullYear() }),
            value: usdCompact(overview.paidYtdUsd),
            note: t('kpi.paidYtdNote'),
        },
        {
            label: t('kpi.wallet'),
            value: usdCompact(overview.walletBalanceUsd),
            note: t('kpi.walletNote'),
            // Un solde qui ne couvre pas l'encours est un fait à signaler, pas
            // une simple valeur : c'est ce qui décide d'alimenter le compte.
            noteTone: overview.walletBalanceUsd < overview.outstandingUsd ? 'default' : 'success',
        },
    ];

    return (
        <div className="mx-auto flex max-w-6xl flex-col gap-[18px] p-4 sm:p-6">
            <KycCBanner kycComplete={!!principal.shipowner.kyc_level_c_completed_at} />
            <PaymentOnboardingChecklist items={checklist} />

            <OsPageHeader
                title={t('verdict', { count: overview.openCount })}
                subtitle={t('context', { owner: principal.shipowner.name })}
                actions={
                    overview.openCount > 0 && (
                        <>
                            <Link
                                href={paths.invoices}
                                className="flex h-10 items-center rounded-[10px] border border-[var(--os-border-strong)] px-3.5 text-[13px] text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)]"
                            >
                                {t('seeAll')}
                            </Link>
                            {paths.readOnly ? (
                                <span aria-disabled className="flex h-10 cursor-not-allowed items-center rounded-[10px] bg-[var(--os-brand-green)] px-[18px] text-[13.5px] font-semibold text-[var(--os-on-primary)] opacity-50">
                                    {t('payAll', { amount: usdGrouped(overview.outstandingUsd) })}
                                </span>
                            ) : (
                            <Link
                                href={paths.invoices}
                                className={
                                    band
                                        // La bande porte déjà l'action pleine de l'écran.
                                        ? 'flex h-10 items-center rounded-[10px] border border-[var(--os-brand-green)]/35 px-[18px] text-[13.5px] font-semibold text-[var(--os-brand-cyan)] transition-colors duration-150 hover:bg-[var(--os-brand-green)]/10'
                                        : 'flex h-10 items-center rounded-[10px] bg-[var(--os-brand-green)] px-[18px] text-[13.5px] font-semibold text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90'
                                }
                            >
                                {t('payAll', { amount: usdGrouped(overview.outstandingUsd) })}
                            </Link>
                            )}
                        </>
                    )
                }
            />

            {/* ── File de travail ──────────────────────────────────────────── */}
            {overview.queue.length === 0 ? (
                // Un état vide est une bonne nouvelle pour l'armateur : il le dit,
                // au lieu d'afficher une illustration neutre ou un tableau vide.
                <p className="os-card px-[18px] py-10 text-center text-[13.5px] text-[var(--os-green)]">
                    {t('emptyGood')}
                </p>
            ) : (
                <div className="flex flex-col gap-2.5">
                    {band && (
                        <OverdueActionBand
                            item={band}
                            payHref={`${paths.invoices}?invoice=${band.transactionId}`}
                            disputeHref={`${paths.invoices}?invoice=${band.transactionId}&dispute=1`}
                            readOnly={paths.readOnly}
                        />
                    )}
                    {queueRows.slice(0, 3).map((item, i) => (
                        <WorkQueueRow
                            key={item.transactionId}
                            item={item}
                            // Si la bande est là, elle détient l'action pleine :
                            // aucune ligne ne la reprend.
                            primary={!band && i === 0}
                            payHref={`${paths.invoices}?invoice=${item.transactionId}`}
                            readOnly={paths.readOnly}
                        />
                    ))}
                    {queueRows.length > 3 && (
                        <Link
                            href={paths.invoices}
                            className="self-start px-1 py-1 text-[12.5px] font-semibold text-[var(--os-brand-cyan)] transition-opacity duration-150 hover:opacity-80"
                        >
                            {t('more', { count: queueRows.length - 3 })} →
                        </Link>
                    )}
                </div>
            )}

            {/* ── Bandeau de contexte, sous la file ────────────────────────── */}
            <OsKpiBand cells={kpis} />

            <section className="os-card overflow-hidden">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--os-border)] px-[18px] py-3.5">
                    <h2 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('fleetTitle')}</h2>
                    <Link
                        href={paths.fleet}
                        className="text-[12.5px] font-semibold text-[var(--os-brand-cyan)] transition-opacity duration-150 hover:opacity-80"
                    >
                        {t('openFleet')} →
                    </Link>
                </header>
                <p className="px-[18px] py-4 text-[13px] text-[var(--os-text-muted)]">
                    {t('fleetSummary', { count: overview.activeVessels })}
                </p>
            </section>
        </div>
    );
}
