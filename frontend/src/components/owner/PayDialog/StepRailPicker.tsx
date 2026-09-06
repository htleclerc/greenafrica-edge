'use client';

import * as React from 'react';
import { Banknote, Smartphone, Briefcase, Wallet, CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePayDialog, type Rail } from './usePayDialogContext';
import { PaypalMark } from './PaypalMark';

interface RailEligibility {
    rail: Rail;
    eligible: boolean;
    providers: Array<{ provider: string; routes_rail: string[]; display_order: number }>;
    reason?: string;
}

interface AvailabilityResponse {
    rails: RailEligibility[];
    showUnavailable?: boolean;
    wire?: {
        beneficiary: string; bank: string; bankAddress: string;
        swiftCode: string; iban: string; depositReference: string | null;
    };
    /** Tous les comptes de collecte. Absent d'un serveur pas encore redéployé. */
    wireAccounts?: Array<{
        index: number; label: string; currency: string; isPrimary: boolean;
        beneficiary: string; bank: string; bankAddress: string;
        swiftCode: string; iban: string; depositReference: string | null;
        intermediaryBank: string | null; intermediarySwift: string | null;
    }>;
}

/**
 * Un rail sans prestataire actif est une indisponibilite STRUCTURELLE : il
 * n'est pas encore ouvert. Un portefeuille vide ou insuffisant est
 * CONTEXTUEL — le moyen existe, c'est ce paiement-ci qui ne passe pas.
 *
 * Les confondre serait nuisible : un armateur dont le portefeuille est a sec
 * doit comprendre pourquoi, sinon il croira que le moyen n'existe pas et ne
 * l'alimentera jamais.
 */
function isComingSoon(r: RailEligibility): boolean {
    return !r.eligible && r.reason === 'no_active_provider';
}

const RAIL_META: Record<Rail, { icon: React.ComponentType<{ className?: string }>; color: string; key: string }> = {
    STRIPE:        { icon: CreditCard, color: '#635BFF', key: 'stripe' },
    PAYPAL:        { icon: PaypalMark, color: '#0070BA', key: 'paypal' },
    WIRE_TRANSFER: { icon: Banknote,   color: '#10B981', key: 'wire' },
    MOBILE_MONEY:  { icon: Smartphone, color: '#1DC9B7', key: 'momo' },
    THIRD_PARTY:   { icon: Briefcase,  color: '#FF4800', key: 'third' },
    WALLET:        { icon: Wallet,     color: '#8B5CF6', key: 'wallet' },
};

/** Format court en dollars, pour les libelles de la bascule mixte. */
function usd(minor: number): string {
    return (minor / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export function StepRailPicker() {
    const t = useTranslations('OwnerPortal.payDialog');
    const ctx = usePayDialog();
    const [loading, setLoading] = React.useState(true);
    const [rails, setRails] = React.useState<RailEligibility[]>([]);
    const [fetchError, setFetchError] = React.useState<string | null>(null);

    const totalUsdMinor = Math.round(ctx.amountUsd * 100);

    // Paiement mixte : un portefeuille non vide qui ne couvre pas la facture
    // servait a rien jusqu'ici — le rail WALLET restait grise et le credit
    // dormait. On propose de le consommer et de ne payer que le reste.
    //
    // Reserve aux factures en USD : le portefeuille est tenu en USD, melanger
    // deux devises dans un meme reglement demanderait un taux verrouille sur
    // la part portefeuille, ce que le grand livre ne porte pas.
    const canSplit =
        ctx.mode === 'invoice'
        && ctx.currency === 'USD'
        && ctx.walletBalanceUsdMinor > 0
        && ctx.walletBalanceUsdMinor < totalUsdMinor;
    const splitOn = ctx.walletApplyUsdMinor > 0;
    const remainderUsdMinor = totalUsdMinor - ctx.walletApplyUsdMinor;

    // Un solde qui ne couvre plus rien (facture revue a la baisse, credit
    // consomme ailleurs) doit relacher la bascule, sinon le reste a payer
    // deviendrait negatif.
    React.useEffect(() => {
        if (!canSplit && ctx.walletApplyUsdMinor > 0) ctx.setWalletApplyUsdMinor(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canSplit]);

    // Setter de useState : stable, donc citable en dependance sans relancer
    // la requete a chaque rendu (contrairement a `ctx` entier).
    const { setWire, setWireAccounts, setSelectedWireIndex } = ctx;

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setFetchError(null);
            try {
                const url = new URL('/api/owner/payment-availability', window.location.origin);
                url.searchParams.set('currency', ctx.currency);
                url.searchParams.set('walletBalanceUsdMinor', String(ctx.walletBalanceUsdMinor));
                // L'eligibilite porte sur ce qui reste a payer sur le rail,
                // pas sur le total de la facture.
                url.searchParams.set('amountUsdMinor', String(remainderUsdMinor));
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data: AvailabilityResponse = await res.json();
                if (!cancelled && data.wire) setWire(data.wire);
                if (!cancelled && data.wireAccounts?.length) {
                    setWireAccounts(data.wireAccounts);
                    // Le compte par défaut est présélectionné : le payeur n'a
                    // rien à faire s'il est concerné par celui-là.
                    const primary = data.wireAccounts.findIndex((a) => a.isPrimary);
                    setSelectedWireIndex(primary >= 0 ? primary : 0);
                }
                if (!cancelled) {
                    // Topup mode: hide WALLET — can't top-up wallet from itself.
                    // Paiement mixte : le portefeuille est deja engage en
                    // totalite, le proposer une seconde fois n'a pas de sens.
                    const filtered = data.rails.filter(
                        (r) => r.rail !== 'WALLET' || (ctx.mode !== 'topup' && !splitOn),
                    );
                    setRails(filtered);
                }
            } catch (e) {
                if (!cancelled) setFetchError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [ctx.currency, ctx.walletBalanceUsdMinor, ctx.amountUsd, ctx.mode, remainderUsdMinor, splitOn, setWire, setWireAccounts, setSelectedWireIndex]);

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
            {canSplit && (
                <label
                    className="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer"
                    style={{
                        borderColor: splitOn ? '#8B5CF6' : 'var(--os-border)',
                        backgroundColor: 'var(--os-surface-2)',
                    }}
                >
                    <input
                        type="checkbox"
                        checked={splitOn}
                        onChange={(e) =>
                            ctx.setWalletApplyUsdMinor(e.target.checked ? ctx.walletBalanceUsdMinor : 0)
                        }
                        className="mt-0.5 accent-[#8B5CF6]"
                    />
                    <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-[var(--os-text-primary)]">
                            {t('splitWallet.label', { wallet: usd(ctx.walletBalanceUsdMinor) })}
                        </span>
                        <span className="block text-[11px] text-[var(--os-text-muted)] mt-0.5">
                            {splitOn
                                ? t('splitWallet.on', { remainder: usd(remainderUsdMinor) })
                                : t('splitWallet.hint')}
                        </span>
                    </span>
                </label>
            )}
            <p className="text-xs text-[var(--os-text-muted)] mb-1">
                {splitOn
                    ? t('chooseRailRemainder', { amount: usd(remainderUsdMinor) })
                    : t('chooseRail', { currency: ctx.currency })}
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
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-[var(--os-text-primary)]">{t(`rail.${meta.key}.label`)}</p>
                                {isComingSoon(r) && (
                                    <span
                                        className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                        style={{ backgroundColor: 'rgba(234,179,8,0.12)', color: '#EAB308' }}
                                    >
                                        {t('comingSoon')}
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
                                {r.eligible
                                    ? t(`rail.${meta.key}.hint`, { provider: r.providers[0]?.provider ?? '' })
                                    : isComingSoon(r)
                                        ? t('comingSoonHint')
                                        : t(r.reason ? `reason.${r.reason}` : 'railNotAvailable')}
                            </p>
                        </div>
                    </button>
                );
            })}
            {rails.length > 0 && rails.every((r) => !r.eligible) && (
                <p className="text-xs text-[#EAB308] mt-2">{t('noRailEligible')}</p>
            )}
            {rails.length === 0 && (
                <p className="text-xs text-[#EAB308] mt-2 py-2">{t('noRailEligible')}</p>
            )}
        </div>
    );
}
