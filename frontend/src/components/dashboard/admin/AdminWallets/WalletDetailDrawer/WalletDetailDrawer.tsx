'use client';

import * as React from 'react';
import { X, Wallet, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import { useRole } from '@/lib/RoleContext';
import { AdjustWalletDialog } from './AdjustWalletDialog';
import type { WalletRow, LedgerRow, LedgerKind } from '@/services/walletService';

const KIND_VARIANT: Record<LedgerKind, BadgeVariant> = {
    TOPUP: 'active',
    OVERPAYMENT_CREDIT: 'active',
    REFUND_CREDIT: 'active',
    PROFORMA_APPLY: 'archived',
    ADMIN_ADJUSTMENT: 'warning',
    FX_DIFFERENCE: 'info',
};

interface Props {
    walletId: string;
    onClose: () => void;
}

interface ApiResponse {
    wallet: WalletRow & { shipowner: { id: string; name: string } | null };
    ledger: LedgerRow[];
}

export function WalletDetailDrawer({ walletId, onClose }: Props) {
    const t = useTranslations('AdminWallets.drawer');
    const { role } = useRole();
    const canAdjust = role === 'SUPERADMIN';

    const [data, setData] = React.useState<ApiResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [showAdjust, setShowAdjust] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const res = await fetch(`/api/admin/wallets/${walletId}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                if (!cancelled) setData(json as ApiResponse);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [walletId]);

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
            <aside
                className="fixed top-0 right-0 z-50 h-screen w-[520px] max-w-full overflow-y-auto p-5"
                style={{
                    backgroundColor: 'var(--os-surface-1)',
                    borderLeft: '1px solid var(--os-border)',
                }}
            >
                <header className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-emerald-500" />
                        <h2 className="text-base font-semibold">{t('title')}</h2>
                    </div>
                    <button onClick={onClose} aria-label="Close">
                        <X className="w-4 h-4 text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]" />
                    </button>
                </header>

                {loading && (
                    <p className="text-xs flex items-center gap-2 text-[var(--os-text-muted)]">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t('loading')}
                    </p>
                )}
                {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

                {data && (
                    <>
                        <div className="rounded-xl border border-[var(--os-border)] p-4 bg-[var(--os-surface-2)] mb-4">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                                {t('owner')}
                            </p>
                            <p className="text-sm mb-3">{data.wallet.shipowner?.name ?? '—'}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                                {t('balance')}
                            </p>
                            <p className="text-2xl font-bold tabular-nums">
                                ${(data.wallet.balance_usd_minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                            </p>
                        </div>

                        {canAdjust && (
                            <div className="mb-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <p className="text-xs text-amber-200 mb-2">{t('adjustNotice')}</p>
                                    <OsButton variant="secondary" size="sm" onClick={() => setShowAdjust(true)}>
                                        {t('adjustCta')}
                                    </OsButton>
                                </div>
                            </div>
                        )}

                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">
                                {t('ledgerTitle', { count: data.ledger.length })}
                            </p>
                            <ul className="flex flex-col gap-1">
                                {data.ledger.map((row) => {
                                    const isPos = row.amount_signed_usd_minor > 0;
                                    return (
                                        <li key={row.id} className="rounded-lg border border-[var(--os-border)] p-2 text-xs">
                                            <div className="flex items-center justify-between mb-1">
                                                <OsBadge variant={KIND_VARIANT[row.kind]} label={row.kind} />
                                                <span
                                                    className="font-mono font-bold tabular-nums"
                                                    style={{ color: isPos ? '#10B981' : '#F59E0B' }}
                                                >
                                                    {isPos ? '+' : '−'}${(Math.abs(row.amount_signed_usd_minor) / 100).toFixed(2)}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-[var(--os-text-muted)]">
                                                {new Date(row.created_at).toLocaleString()}
                                            </p>
                                            {row.justification && (
                                                <p className="text-[10px] mt-1 text-[var(--os-text-secondary)] italic">
                                                    {row.justification}
                                                </p>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </>
                )}

                {showAdjust && data && (
                    <AdjustWalletDialog
                        walletId={data.wallet.id}
                        shipownerName={data.wallet.shipowner?.name ?? '—'}
                        currentBalanceUsdMinor={data.wallet.balance_usd_minor}
                        onClose={(refresh) => {
                            setShowAdjust(false);
                            if (refresh) {
                                // Re-fetch to show the new ledger entry
                                window.location.reload();
                            }
                        }}
                    />
                )}
            </aside>
        </>
    );
}
