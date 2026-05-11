'use client';

import * as React from 'react';
import { Banknote, Smartphone, Briefcase, Wallet, CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePayDialog, type Rail } from './usePayDialogContext';

interface RailEligibility {
    rail: Rail;
    eligible: boolean;
    providers: Array<{ provider: string; routes_rail: string[]; display_order: number }>;
    reason?: string;
}

interface AvailabilityResponse {
    rails: RailEligibility[];
}

const RAIL_META: Record<Rail, { icon: React.ComponentType<{ className?: string }>; color: string; key: string }> = {
    STRIPE:        { icon: CreditCard, color: '#635BFF', key: 'stripe' },
    WIRE_TRANSFER: { icon: Banknote,   color: '#10B981', key: 'wire' },
    MOBILE_MONEY:  { icon: Smartphone, color: '#1DC9B7', key: 'momo' },
    THIRD_PARTY:   { icon: Briefcase,  color: '#FF4800', key: 'third' },
    WALLET:        { icon: Wallet,     color: '#8B5CF6', key: 'wallet' },
};

export function StepRailPicker() {
    const t = useTranslations('OwnerPortal.payDialog');
    const ctx = usePayDialog();
    const [loading, setLoading] = React.useState(true);
    const [rails, setRails] = React.useState<RailEligibility[]>([]);
    const [fetchError, setFetchError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setFetchError(null);
            try {
                const url = new URL('/api/owner/payment-availability', window.location.origin);
                url.searchParams.set('currency', ctx.currency);
                url.searchParams.set('walletBalanceUsdMinor', String(ctx.walletBalanceUsdMinor));
                url.searchParams.set('amountUsdMinor', String(Math.round(ctx.amountUsd * 100)));
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data: AvailabilityResponse = await res.json();
                if (!cancelled) setRails(data.rails);
            } catch (e) {
                if (!cancelled) setFetchError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [ctx.currency, ctx.walletBalanceUsdMinor, ctx.amountUsd]);

    function pickRail(r: RailEligibility) {
        ctx.setRail(r.rail);
        ctx.setChosenProvider(r.providers[0]?.provider ?? null);
        ctx.setStep('params');
    }

    if (loading) {
        return <p className="text-xs text-[var(--os-text-muted)] py-4">{t('loadingRails')}</p>;
    }
    if (fetchError) {
        return <p className="text-xs text-[#EF4444] py-4">{fetchError}</p>;
    }

    return (
        <div className="flex flex-col gap-2">
            <p className="text-xs text-[var(--os-text-muted)] mb-1">
                {t('chooseRail', { currency: ctx.currency })}
            </p>
            {rails.map((r) => {
                const meta = RAIL_META[r.rail];
                const Icon = meta.icon;
                return (
                    <button
                        key={r.rail}
                        onClick={() => r.eligible && pickRail(r)}
                        disabled={!r.eligible}
                        className="flex items-center gap-3 p-3 rounded-xl border transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-[var(--os-surface-3)]"
                        style={{ borderColor: 'var(--os-border)', backgroundColor: 'var(--os-surface-2)' }}
                    >
                        <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                        >
                            <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--os-text-primary)]">{t(`rail.${meta.key}.label`)}</p>
                            <p className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
                                {r.eligible
                                    ? t(`rail.${meta.key}.hint`, { provider: r.providers[0]?.provider ?? '' })
                                    : t(r.reason ? `reason.${r.reason}` : 'railNotAvailable')}
                            </p>
                        </div>
                    </button>
                );
            })}
            {rails.every((r) => !r.eligible) && (
                <p className="text-xs text-[#EAB308] mt-2">{t('noRailEligible')}</p>
            )}
        </div>
    );
}
