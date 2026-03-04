'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Menu, X } from 'lucide-react';

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

export function Navbar({ activePage = 'overview' }: NavbarProps) {
    const t = useTranslations('Navigation');
    const c = useTranslations('Common');
    const [mobileOpen, setMobileOpen] = React.useState(false);

    const navItems = [
        'overview',
        'carbon_tax',
        'carbon_credits',
        'projects',
        'reports',
    ];

    return (
        <nav className="fixed top-0 w-full z-50 bg-[#0a1110]/90 backdrop-blur-xl border-b border-white/5 transition-all">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                {/* Logo */}
                <a href="/" className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
                            <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z" />
                        </svg>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-sm font-bold tracking-tight text-white leading-tight">AIS Portal</span>
                        <span className="text-[9px] text-emerald-500/70 font-medium tracking-widest uppercase leading-tight">
                            AFRICGREEN INITIATIVE
                        </span>
                    </div>
                </a>

                {/* Desktop nav */}
                <div className="hidden lg:flex items-center gap-1">
                    {navItems.map((key) => {
                        const isActive = activePage === key;
                        return (
                            <a
                                key={key}
                                href={NAV_ROUTES[key] ?? '#'}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${isActive
                                    ? 'text-white bg-white/5 border border-white/8'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {t(key)}
                            </a>
                        );
                    })}
                </div>

                {/* Right: Sign In + mobile menu toggle */}
                <div className="flex items-center gap-3">
                    <button className="text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-lg transition-all hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                        {c('sign_in')}
                    </button>
                    <button
                        className="lg:hidden p-2 text-slate-400 hover:text-white transition-colors"
                        onClick={() => setMobileOpen((o) => !o)}
                        aria-label="Toggle menu"
                    >
                        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile dropdown */}
            {mobileOpen && (
                <div className="lg:hidden bg-[#0a1110]/95 backdrop-blur-xl border-t border-white/5 px-6 py-4 flex flex-col gap-1">
                    {navItems.map((key) => {
                        const isActive = activePage === key;
                        return (
                            <a
                                key={key}
                                href={NAV_ROUTES[key] ?? '#'}
                                className={`px-4 py-3 rounded-lg text-sm font-medium transition-all ${isActive
                                    ? 'text-white bg-white/5 border border-white/8'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                    }`}
                                onClick={() => setMobileOpen(false)}
                            >
                                {t(key)}
                            </a>
                        );
                    })}
                </div>
            )}
        </nav>
    );
}
