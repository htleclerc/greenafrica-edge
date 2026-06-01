'use client';

import * as React from 'react';
import {
    CheckCircle2, AlertTriangle, RefreshCw, Lock, Eye,
    CreditCard, Building2, Globe, Smartphone, Banknote, Shield, Briefcase,
} from 'lucide-react';
import { useRole } from '@/lib/RoleContext';
import { canEdit } from '@/lib/rbac';

type ProviderKey = 'stripe' | 'paystack' | 'flutterwave' | 'wave' | 'payoneer' | 'wire_transfer';

interface ProviderConfig {
    provider: ProviderKey;
    displayName: string;
    enabled: boolean;
    isDefault: boolean;
    supportedCurrencies: string[];
    testMode: boolean;
    routesRail?: string[];
}

interface ProviderMetaUI {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    description: string;
    coverage: string;
}

const PROVIDER_META: Record<ProviderKey, ProviderMetaUI> = {
    stripe:        { icon: CreditCard, color: '#635BFF', description: 'International cards + SEPA bank transfers', coverage: 'Worldwide · USD/EUR/GBP' },
    paystack:      { icon: Building2, color: '#0BA4DB', description: 'African cards + bank + mobile money', coverage: 'Africa · NGN/GHS/KES/USD' },
    flutterwave:   { icon: Globe, color: '#F5A623', description: 'Pan-African payment gateway', coverage: 'Africa + EU + US · multi-currency' },
    wave:          { icon: Smartphone, color: '#1DC9B7', description: 'Mobile money for West/East Africa', coverage: 'XOF / SOS · mobile money' },
    payoneer:      { icon: Briefcase, color: '#FF4800', description: 'B2B cross-border payments — global enterprise', coverage: 'Worldwide · USD / EUR / GBP' },
    wire_transfer: { icon: Banknote, color: '#10B981', description: 'SWIFT bank wire — manual confirmation', coverage: 'Worldwide · all currencies · always available' },
};

export function PaymentProvidersPanel() {
    const { role } = useRole();
    const isReadOnly = !canEdit('tax-settings', role);

    const [providers, setProviders] = React.useState<ProviderConfig[]>([]);
    const [loading, setLoading]     = React.useState(true);
    const [error, setError]         = React.useState<string | null>(null);
    const [busyProvider, setBusyProvider] = React.useState<ProviderKey | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const res = await fetch('/api/admin/payment-config');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!cancelled) setProviders(data.providers ?? []);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    async function toggleProvider(provider: ProviderKey, isActive: boolean) {
        if (isReadOnly) return;
        setBusyProvider(provider); setError(null);
        try {
            const res = await fetch('/api/admin/payment-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, isActive }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            // Optimistic update
            setProviders((list) => list.map((p) => p.provider === provider ? { ...p, isDefault: isActive } : p));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Toggle failed');
        } finally {
            setBusyProvider(null);
        }
    }

    return (
        <div className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-5">
            <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <h1 className="text-xl font-bold text-[var(--os-text-primary)]">Payment Providers</h1>
                        {isReadOnly && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[rgba(56,189,248,0.1)] text-[#38BDF8] border border-[#38BDF8]/20">
                                <Eye className="w-3 h-3" /> READ-ONLY
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-[var(--os-text-muted)]">
                        Activate one or more providers. New payments are routed by rail; the first active provider serving the chosen rail (by display order) handles the request.
                    </p>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
                    <p className="text-xs text-[#EF4444]">{error}</p>
                </div>
            )}

            {loading && (
                <div className="os-card p-8 flex items-center justify-center">
                    <div className="flex items-center gap-2 text-[var(--os-text-muted)]">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading providers…</span>
                    </div>
                </div>
            )}

            {!loading && providers.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {providers.map((p) => {
                        const meta = PROVIDER_META[p.provider];
                        const Icon = meta.icon;
                        const isActive = p.isDefault;
                        const isBusy = busyProvider === p.provider;

                        return (
                            <div
                                key={p.provider}
                                className="os-card p-5 transition-all"
                                style={{
                                    borderColor: isActive ? `${meta.color}50` : 'var(--os-border)',
                                    backgroundColor: isActive ? `${meta.color}08` : undefined,
                                }}
                            >
                                <div className="flex items-start gap-3 mb-3">
                                    <div
                                        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                                        style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                                    >
                                        <Icon className="w-5 h-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="text-sm font-bold text-[var(--os-text-primary)]">{p.displayName}</h3>
                                            {isActive && (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-widest bg-[rgba(16,185,129,0.12)] text-[#10B981] border border-[#10B981]/20">ACTIVE</span>
                                            )}
                                            {p.testMode && (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-widest bg-[rgba(234,179,8,0.12)] text-[#EAB308] border border-[#EAB308]/20">TEST MODE</span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-[var(--os-text-muted)] mt-0.5">{meta.description}</p>
                                    </div>
                                </div>

                                <div className="mb-3 px-3 py-2 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)]">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-0.5">Coverage</p>
                                    <p className="text-xs text-[var(--os-text-primary)]">{meta.coverage}</p>
                                </div>

                                {p.routesRail && p.routesRail.length > 0 && (
                                    <div className="mb-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">Rails Served</p>
                                        <div className="flex flex-wrap gap-1">
                                            {p.routesRail.map((r) => (
                                                <span key={r} className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-[rgba(16,185,129,0.08)] border border-[#10B981]/20 text-[#10B981]">{r}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="mb-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">Supported Currencies</p>
                                    <div className="flex flex-wrap gap-1">
                                        {p.supportedCurrencies.map((c) => (
                                            <span key={c} className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-[var(--os-surface-2)] border border-[var(--os-border)] text-[var(--os-text-secondary)]">{c}</span>
                                        ))}
                                    </div>
                                </div>

                                <div className="mb-4 flex items-center gap-2 text-[11px]">
                                    {p.enabled ? (
                                        <>
                                            <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                                            <span className="text-[#10B981] font-semibold">API keys configured</span>
                                        </>
                                    ) : (
                                        <>
                                            <Lock className="w-3.5 h-3.5 text-[#94A3B8]" />
                                            <span className="text-[var(--os-text-muted)]">
                                                {p.provider === 'wire_transfer' ? 'No API key required' : 'Add API key to .env to enable'}
                                            </span>
                                        </>
                                    )}
                                </div>

                                <button
                                    onClick={() => toggleProvider(p.provider, !isActive)}
                                    disabled={isReadOnly || !p.enabled || isBusy}
                                    className="w-full flex items-center justify-between p-3 rounded-xl border transition-all disabled:cursor-not-allowed disabled:opacity-50"
                                    style={{
                                        borderColor: isActive ? meta.color : 'var(--os-border)',
                                        backgroundColor: isActive ? `${meta.color}10` : 'var(--os-surface-2)',
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-9 h-5 rounded-full relative transition-colors"
                                            style={{ backgroundColor: isActive ? meta.color : 'var(--os-border-strong)' }}
                                        >
                                            <div
                                                className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                                                style={{ left: isActive ? 'calc(100% - 18px)' : '2px' }}
                                            />
                                        </div>
                                        <span
                                            className="text-xs font-semibold"
                                            style={{ color: isActive ? meta.color : 'var(--os-text-primary)' }}
                                        >
                                            {isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                    {isBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--os-text-muted)]" />}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="os-card p-4 flex items-start gap-3">
                <Shield className="w-4 h-4 text-[#10B981] flex-shrink-0 mt-0.5" />
                <div className="text-[11px] text-[var(--os-text-muted)] leading-relaxed">
                    <p className="mb-1">
                        <strong className="text-[var(--os-text-primary)]">How this works:</strong> Multiple providers can be active at once. The system routes new payments by <em>rail</em> — for example, a MOBILE_MONEY payment in NGN goes to the first active provider whose <code className="text-[#10B981]">routes_rail</code> includes <code>MOBILE_MONEY</code> and supports NGN.
                    </p>
                    <p className="mb-1">
                        <strong className="text-[var(--os-text-primary)]">API keys:</strong> Provider keys live in <code className="text-[#10B981]">.env.local</code> and Vercel environment variables. They are never exposed to the browser.
                    </p>
                    <p>
                        <strong className="text-[var(--os-text-primary)]">Webhooks:</strong> Each provider must POST events to <code className="text-[#10B981]">/api/webhooks/payment</code> with the appropriate signature header.
                    </p>
                </div>
            </div>
        </div>
    );
}
