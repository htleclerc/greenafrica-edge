'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, Ship, FileText, AlertTriangle, Wallet, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AfricGreenLogo } from '@/components/ui/AfricGreenLogo';
import { KycCBanner } from '@/components/owner/KycCBanner';

interface NavItem {
    href: string;
    labelKey: 'dashboard' | 'vessels' | 'invoices' | 'wallet' | 'alerts';
    icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
    { href: '/owner/dashboard', labelKey: 'dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { href: '/owner/vessels',   labelKey: 'vessels',   icon: <Ship className="w-4 h-4" /> },
    { href: '/owner/invoices',  labelKey: 'invoices',  icon: <FileText className="w-4 h-4" /> },
    { href: '/owner/wallet',    labelKey: 'wallet',    icon: <Wallet className="w-4 h-4" /> },
    { href: '/owner/alerts',    labelKey: 'alerts',    icon: <AlertTriangle className="w-4 h-4" /> },
];

interface OwnerShellProps {
    ownerName: string;
    email: string;
    kycComplete: boolean;
    children: React.ReactNode;
}

/**
 * Top-bar shell for the owner portal. Deliberately leaner than the staff
 * dashboard shell — no role context, no skin provider, no KPI fetcher.
 * The owner sees only their own data; we don't need any of that machinery.
 */
export function OwnerShell({ ownerName, email, kycComplete, children }: OwnerShellProps) {
    const pathname = usePathname();
    const router = useRouter();
    const t = useTranslations('OwnerPortal');
    const [signingOut, setSigningOut] = React.useState(false);

    async function logout() {
        setSigningOut(true);
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push('/owner/login');
    }

    return (
        <div className="min-h-screen os-bg flex flex-col">
            {/* ── Top bar ─────────────────────────────────────────────────── */}
            <header
                className="sticky top-0 z-30 flex items-center justify-between px-6 py-3"
                style={{
                    backgroundColor: 'var(--os-surface)',
                    borderBottom: '1px solid var(--os-border)',
                }}
            >
                <Link href="/owner/dashboard" className="flex items-center gap-3 group">
                    <AfricGreenLogo size={32} variant="dark" className="rounded-lg flex-shrink-0" />
                    <div className="flex flex-col leading-tight">
                        <span className="text-sm font-bold text-[var(--os-text-primary)]">
                            Green Gate
                        </span>
                        <span className="text-[9px] font-semibold tracking-widest uppercase text-emerald-500/70">
                            {t('brand')}
                        </span>
                    </div>
                </Link>

                <nav className="hidden md:flex items-center gap-1">
                    {NAV_ITEMS.map((item) => {
                        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                                style={{
                                    color: active ? '#10B981' : 'var(--os-text-muted)',
                                    backgroundColor: active ? 'rgba(16,185,129,0.10)' : 'transparent',
                                }}
                            >
                                {item.icon}
                                {t(`nav.${item.labelKey}`)}
                            </Link>
                        );
                    })}
                </nav>

                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex flex-col items-end leading-tight">
                        <span className="text-xs font-medium text-[var(--os-text-primary)]">
                            {ownerName}
                        </span>
                        <span className="text-[10px] text-[var(--os-text-muted)]">
                            {email}
                        </span>
                    </div>
                    <button
                        onClick={logout}
                        disabled={signingOut}
                        title={t('nav.signOut')}
                        className="p-2 rounded-lg transition-colors hover:bg-[rgba(239,68,68,0.10)]"
                        style={{ color: '#EF4444' }}
                    >
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            </header>

            {/* ── Mobile nav strip ────────────────────────────────────────── */}
            <nav
                className="md:hidden flex items-center justify-around px-2 py-2"
                style={{
                    backgroundColor: 'var(--os-surface-2)',
                    borderBottom: '1px solid var(--os-border)',
                }}
            >
                {NAV_ITEMS.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg"
                            style={{
                                color: active ? '#10B981' : 'var(--os-text-muted)',
                            }}
                        >
                            {item.icon}
                            <span className="text-[9px] font-semibold uppercase tracking-wider">
                                {t(`nav.${item.labelKey}`)}
                            </span>
                        </Link>
                    );
                })}
            </nav>

            <main className="flex-1">
                <KycCBanner kycComplete={kycComplete} />
                {children}
            </main>
        </div>
    );
}
