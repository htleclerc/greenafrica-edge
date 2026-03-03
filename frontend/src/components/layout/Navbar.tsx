'use client';

import { useTranslations } from 'next-intl';

export function Navbar() {
    const t = useTranslations('Navigation');
    const c = useTranslations('Common');

    const navItems = [
        { key: 'overview', active: true },
        { key: 'carbon_tax', active: false },
        { key: 'carbon_credits', active: false },
        { key: 'projects', active: false },
        { key: 'reports', active: false },
        { key: 'settings', active: false },
    ];

    return (
        <nav className="fixed top-0 w-full z-50 bg-[#0a1110]/90 backdrop-blur-xl border-b border-white/5 transition-all">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
                            <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z"></path>
                        </svg>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-sm font-bold tracking-tight text-white leading-tight">AIS Portal</span>
                        <span className="text-[9px] text-emerald-500/70 font-medium tracking-widest uppercase leading-tight">AFRICGREEN INITIATIVE</span>
                    </div>
                </div>

                {/* Navigation items - hidden on mobile */}
                <div className="hidden lg:flex items-center gap-1">
                    {navItems.map((item) => (
                        <a
                            key={item.key}
                            href="#"
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${item.active
                                    ? 'text-white bg-white/5'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {t(item.key)}
                        </a>
                    ))}
                </div>

                {/* Sign In */}
                <div className="flex items-center gap-3">
                    <button className="text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-lg transition-all hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                        {c('sign_in')}
                    </button>
                </div>
            </div>
        </nav>
    );
}
