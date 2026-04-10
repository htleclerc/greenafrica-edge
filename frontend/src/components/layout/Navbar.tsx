'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
    Menu,
    X,
    Globe,
    BarChart3,
    DollarSign,
    Leaf,
    FolderOpen,
    FileText,
    LogIn,
    ChevronRight,
} from 'lucide-react';
import { ThemeToggleButton } from '@/components/layout/ThemeToggleButton';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';

interface NavbarProps {
    activePage?: string;
}

const NAV_ROUTES: Record<string, string> = {
    overview: '/',
    carbon_tax: '/carbon-tax',
    carbon_credits: '/carbon-credits',
    projects: '/projects',
    reports: '/reports',
};

const NAV_ICONS: Record<string, React.ReactNode> = {
    overview: <BarChart3 className="w-5 h-5" />,
    carbon_tax: <DollarSign className="w-5 h-5" />,
    carbon_credits: <Leaf className="w-5 h-5" />,
    projects: <FolderOpen className="w-5 h-5" />,
    reports: <FileText className="w-5 h-5" />,
};

export function Navbar({ activePage = 'overview' }: NavbarProps) {
    const t = useTranslations('Navigation');
    const c = useTranslations('Common');
    const [mobileOpen, setMobileOpen] = React.useState(false);

    const navItems = ['overview', 'carbon_tax', 'carbon_credits', 'projects', 'reports'];

    // Lock body scroll when mobile menu is open
    React.useEffect(() => {
        if (mobileOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [mobileOpen]);

    return (
        <>
            <nav
                className="fixed top-0 w-full z-50 backdrop-blur-xl transition-all"
                style={{
                    backgroundColor: 'var(--ais-nav-bg)',
                    borderBottom: '1px solid var(--ais-nav-border)',
                }}
            >
                <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between">
                    {/* Logo */}
                    <Link href="/" className="flex items-center gap-2.5 flex-shrink-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0">
                            <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
                                <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z" />
                            </svg>
                        </div>
                        <div className="flex flex-col">
                            <span
                                className="text-sm font-bold tracking-tight leading-tight"
                                style={{ color: 'var(--ais-nav-text)' }}
                            >
                                AIS Portal
                            </span>
                            <span className="text-[9px] font-medium tracking-widest uppercase leading-tight text-emerald-500/70">
                                AFRICGREEN
                            </span>
                        </div>
                    </Link>

                    {/* Desktop nav */}
                    <div className="navbar-desktop-nav">
                        {navItems.map((key) => {
                            const isActive = activePage === key;
                            return (
                                <Link
                                    key={key}
                                    href={NAV_ROUTES[key] ?? '/'}
                                    className="px-4 py-2 min-h-[44px] flex items-center rounded-lg text-sm font-medium transition-all"
                                    style={{
                                        color: isActive ? 'var(--ais-nav-text)' : 'var(--ais-nav-text-muted)',
                                        backgroundColor: isActive ? 'var(--ais-nav-item-active-bg)' : 'transparent',
                                        border: isActive
                                            ? '1px solid var(--ais-nav-item-active-border)'
                                            : '1px solid transparent',
                                    }}
                                >
                                    {t(key)}
                                </Link>
                            );
                        })}
                    </div>

                    {/* Right side */}
                    <div className="flex items-center gap-2">
                        {/* Desktop only controls — hidden on mobile via CSS */}
                        <div className="navbar-desktop-controls" style={{ display: 'none' }}>
                            <LocaleSwitcher variant="navbar" />
                            <ThemeToggleButton />
                            <Link
                                href="/login"
                                className="text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 min-h-[44px] inline-flex items-center rounded-lg transition-all hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] whitespace-nowrap"
                            >
                                {c('sign_in')}
                            </Link>
                        </div>

                        {/* Mobile hamburger */}
                        <button
                            className="navbar-mobile-hamburger"
                            onClick={() => setMobileOpen((o) => !o)}
                            aria-label="Toggle menu"
                        >
                            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
            </nav>

            {/* Mobile slide-over overlay */}
            {mobileOpen && (
                <div className="fixed inset-0 z-40 navbar-mobile-overlay" role="dialog" aria-modal="true">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn"
                        onClick={() => setMobileOpen(false)}
                    />

                    {/* Panel */}
                    <div
                        className="absolute top-16 right-0 w-full max-w-sm h-[calc(100dvh-4rem)] flex flex-col animate-slideInRight"
                        style={{
                            backgroundColor: 'var(--ais-nav-bg)',
                            borderLeft: '1px solid var(--ais-nav-border)',
                        }}
                    >
                        {/* Navigation links */}
                        <div className="flex-1 overflow-y-auto px-4 py-6">
                            <p
                                className="text-[10px] font-bold tracking-widest uppercase mb-3 px-3"
                                style={{ color: 'var(--ais-nav-text-muted)' }}
                            >
                                Navigation
                            </p>
                            <div className="flex flex-col gap-1">
                                {navItems.map((key) => {
                                    const isActive = activePage === key;
                                    return (
                                        <Link
                                            key={key}
                                            href={NAV_ROUTES[key] ?? '/'}
                                            className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all"
                                            style={{
                                                color: isActive ? 'var(--ais-nav-text)' : 'var(--ais-nav-text-muted)',
                                                backgroundColor: isActive
                                                    ? 'var(--ais-nav-item-active-bg)'
                                                    : 'transparent',
                                            }}
                                            onClick={() => setMobileOpen(false)}
                                        >
                                            <span
                                                className="flex-shrink-0"
                                                style={{
                                                    color: isActive ? '#10B981' : 'var(--ais-nav-text-muted)',
                                                }}
                                            >
                                                {NAV_ICONS[key]}
                                            </span>
                                            <span className="flex-1">{t(key)}</span>
                                            {isActive && (
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>

                            {/* Settings section */}
                            <div className="mt-8">
                                <p
                                    className="text-[10px] font-bold tracking-widest uppercase mb-3 px-3"
                                    style={{ color: 'var(--ais-nav-text-muted)' }}
                                >
                                    {t('settings') ?? 'Settings'}
                                </p>

                                {/* Language */}
                                <div className="px-3 py-3">
                                    <div
                                        className="flex items-center gap-2 mb-2"
                                        style={{ color: 'var(--ais-nav-text-muted)' }}
                                    >
                                        <Globe className="w-4 h-4" />
                                        <span className="text-xs font-medium">
                                            {t('language') ?? 'Language'}
                                        </span>
                                    </div>
                                    <LocaleSwitcher variant="navbar" />
                                </div>

                                {/* Theme */}
                                <div className="px-3 py-3">
                                    <div
                                        className="flex items-center justify-between"
                                        style={{ color: 'var(--ais-nav-text-muted)' }}
                                    >
                                        <span className="text-xs font-medium">
                                            {t('theme') ?? 'Theme'}
                                        </span>
                                        <ThemeToggleButton />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Sign In CTA — bottom */}
                        <div
                            className="p-4"
                            style={{ borderTop: '1px solid var(--ais-nav-border)' }}
                        >
                            <Link
                                href="/login"
                                className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                                onClick={() => setMobileOpen(false)}
                            >
                                <LogIn className="w-4 h-4" />
                                {c('sign_in')}
                                <ChevronRight className="w-4 h-4" />
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
