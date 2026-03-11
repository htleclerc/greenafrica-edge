'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { ThemeToggleButton } from '@/components/layout/ThemeToggleButton';

interface NavbarProps {
    activePage?: string;
}

const NAV_ROUTES: Record<string, string> = {
    overview:       '/',
    carbon_tax:     '/carbon-tax',
    carbon_credits: '/carbon-credits',
    projects:       '/projects',
    reports:        '/reports',
};

export function Navbar({ activePage = 'overview' }: NavbarProps) {
    const t = useTranslations('Navigation');
    const c = useTranslations('Common');
    const [mobileOpen, setMobileOpen] = React.useState(false);

    const navItems = ['overview', 'carbon_tax', 'carbon_credits', 'projects', 'reports'];

    return (
        <nav
            className="fixed top-0 w-full z-50 backdrop-blur-xl transition-all"
            style={{
                backgroundColor: 'var(--ais-nav-bg)',
                borderBottom: '1px solid var(--ais-nav-border)',
            }}
        >
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-2.5">
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
                            AFRICGREEN INITIATIVE
                        </span>
                    </div>
                </Link>

                {/* Desktop nav */}
                <div className="hidden lg:flex items-center gap-1">
                    {navItems.map((key) => {
                        const isActive = activePage === key;
                        return (
                            <Link
                                key={key}
                                href={NAV_ROUTES[key] ?? '/'}
                                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
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

                {/* Right: Toggle + Portal + Sign In + hamburger */}
                <div className="flex items-center gap-2">
                    <ThemeToggleButton />

                    <Link
                        href="/login"
                        className="text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-lg transition-all hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                    >
                        {c('sign_in')}
                    </Link>

                    <button
                        className="lg:hidden p-2 transition-colors"
                        style={{ color: 'var(--ais-nav-text-muted)' }}
                        onClick={() => setMobileOpen((o) => !o)}
                        aria-label="Toggle menu"
                    >
                        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile dropdown */}
            {mobileOpen && (
                <div
                    className="lg:hidden backdrop-blur-xl px-6 py-4 flex flex-col gap-1"
                    style={{
                        backgroundColor: 'var(--ais-nav-bg)',
                        borderTop: '1px solid var(--ais-nav-border)',
                    }}
                >
                    {navItems.map((key) => {
                        const isActive = activePage === key;
                        return (
                            <Link
                                key={key}
                                href={NAV_ROUTES[key] ?? '/'}
                                className="px-4 py-3 rounded-lg text-sm font-medium transition-all"
                                style={{
                                    color: isActive ? 'var(--ais-nav-text)' : 'var(--ais-nav-text-muted)',
                                    backgroundColor: isActive ? 'var(--ais-nav-item-active-bg)' : 'transparent',
                                }}
                                onClick={() => setMobileOpen(false)}
                            >
                                {t(key)}
                            </Link>
                        );
                    })}
                </div>
            )}
        </nav>
    );
}
