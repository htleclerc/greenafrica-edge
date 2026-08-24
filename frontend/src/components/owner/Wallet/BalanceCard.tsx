'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usdGrouped } from '@/lib/osMoney';

interface Props {
    balanceUsd: number;
    autoApplyEnabled: boolean;
    onToggleAutoApply: () => void;
    onOpenTopup: () => void;
    togglePending: boolean;
    /**
     * Faux pour un membre invité sans le droit de payer (mig 135) : il voit
     * l'état de l'application automatique, qui décide de ses factures, mais
     * ne le change pas.
     */
    canToggleAutoApply?: boolean;
    /** Plan 7H-1 Task 5.3 — when false, hides the "Top up" CTA. */
    topupEnabled?: boolean;
    /** Date du dernier approvisionnement, si le portefeuille en a déjà reçu un. */
    lastTopupAt?: string | null;
    lastTopupUsd?: number | null;
}

/**
 * Solde du portefeuille.
 *
 * Le montant est en monospace 48 px sur une interligne de 1 : c'est le seul
 * chiffre de l'écran qui répond à la question qu'on vient poser, et il doit se
 * lire sans lecture.
 */
export function BalanceCard({
    balanceUsd, autoApplyEnabled, onToggleAutoApply, onOpenTopup, togglePending,
    topupEnabled = true, canToggleAutoApply = true, lastTopupAt = null, lastTopupUsd = null,
}: Props) {
    const t = useTranslations('OwnerPortal.wallet');

    return (
        <section className="os-card flex flex-col gap-4 p-[22px]">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
                {t('balanceCard.title')}
            </h2>

            <p className="font-mono text-[48px] font-semibold leading-none tabular-nums text-[var(--os-text-primary)]">
                {usdGrouped(balanceUsd)}
            </p>

            <p className="text-[13px] text-[var(--os-text-secondary)]">
                {lastTopupAt && lastTopupUsd
                    ? t('balanceCard.lastTopup', {
                        date: new Date(lastTopupAt).toLocaleDateString(),
                        amount: usdGrouped(lastTopupUsd),
                    })
                    : t('balanceCard.noTopupYet')}
            </p>

            <div className="flex flex-wrap items-center gap-2.5">
                {topupEnabled && (
                    <button
                        type="button"
                        onClick={onOpenTopup}
                        className="flex h-11 items-center rounded-[11px] bg-[var(--os-brand-green)] px-5 text-sm font-semibold text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                    >
                        {t('balanceCard.topupCta')}
                    </button>
                )}
                <Link
                    href="/dashboard/invoices"
                    className="flex h-11 items-center rounded-[11px] border border-[var(--os-border-strong)] px-[18px] text-sm text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)]"
                >
                    {t('balanceCard.refundCta')}
                </Link>
            </div>

            {/* L'application automatique décide si le solde éteint les pro-formas
                sans geste : c'est un réglage, il reste sous les actions. */}
            <div className="flex items-center gap-3 border-t border-[var(--os-border)] pt-3.5">
                <span className="text-xs text-[var(--os-text-muted)]">{t('balanceCard.autoApply')}</span>
                <button
                    type="button"
                    onClick={onToggleAutoApply}
                    disabled={togglePending || !canToggleAutoApply}
                    aria-pressed={autoApplyEnabled}
                    className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 disabled:opacity-50"
                    style={{
                        borderColor: autoApplyEnabled ? 'var(--os-green)' : 'var(--os-border)',
                        backgroundColor: autoApplyEnabled ? 'color-mix(in srgb, var(--os-green) 12%, transparent)' : 'var(--os-surface-2)',
                        color: autoApplyEnabled ? 'var(--os-green)' : 'var(--os-text-muted)',
                    }}
                >
                    {autoApplyEnabled ? t('balanceCard.autoApplyOn') : t('balanceCard.autoApplyOff')}
                </button>
            </div>
        </section>
    );
}
