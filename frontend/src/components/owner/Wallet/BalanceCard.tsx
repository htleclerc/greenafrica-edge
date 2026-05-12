'use client';

import * as React from 'react';
import { Wallet, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';

interface Props {
    balanceUsd: number;
    autoApplyEnabled: boolean;
    onToggleAutoApply: () => void;
    onOpenTopup: () => void;
    togglePending: boolean;
}

export function BalanceCard({ balanceUsd, autoApplyEnabled, onToggleAutoApply, onOpenTopup, togglePending }: Props) {
    const t = useTranslations('OwnerPortal.wallet');
    return (
        <section className="os-card p-5">
            <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('balanceCard.title')}</h2>
            </div>
            <p className="text-3xl font-bold text-[var(--os-text-primary)] mb-4 tabular-nums">
                ${balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
            </p>
            <div className="flex items-center gap-3 mb-4">
                <span className="text-xs text-[var(--os-text-muted)]">{t('balanceCard.autoApply')}</span>
                <button
                    onClick={onToggleAutoApply}
                    disabled={togglePending}
                    className="text-xs font-semibold px-3 py-1 rounded-full border"
                    style={{
                        borderColor: autoApplyEnabled ? '#10B981' : 'var(--os-border)',
                        backgroundColor: autoApplyEnabled ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                        color: autoApplyEnabled ? '#10B981' : 'var(--os-text-muted)',
                    }}
                >
                    {autoApplyEnabled ? t('balanceCard.autoApplyOn') : t('balanceCard.autoApplyOff')}
                </button>
            </div>
            <OsButton variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={onOpenTopup}>
                {t('balanceCard.topupCta')}
            </OsButton>
        </section>
    );
}
