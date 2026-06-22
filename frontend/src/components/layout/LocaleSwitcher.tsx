'use client';

import * as React from 'react';
import { Globe } from 'lucide-react';

const LOCALES = [
    { code: 'en', label: 'EN' },
    { code: 'so', label: 'SO' },
    { code: 'fr', label: 'FR' },
    { code: 'pt', label: 'PT' },
    { code: 'sw', label: 'SW' },
    { code: 'ar', label: 'العربية' },
] as const;

type Variant = 'navbar' | 'dashboard';

interface LocaleSwitcherProps {
    variant?: Variant;
}

function getCurrentLocale(): string {
    if (typeof document === 'undefined') return 'en';
    const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]*)/);
    return match ? match[1] : 'en';
}

export function LocaleSwitcher({ variant = 'navbar' }: LocaleSwitcherProps) {
    const [locale, setLocale] = React.useState('en');
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setLocale(getCurrentLocale());
        setMounted(true);
    }, []);

    if (!mounted) return <div className="w-16 h-8" />;

    function switchLocale(newLocale: string) {
        if (newLocale === locale) return;
        document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;
        window.location.reload();
    }

    const isDashboard = variant === 'dashboard';

    return (
        <div
            className="inline-flex items-center rounded-lg p-0.5 gap-0.5"
            style={{
                backgroundColor: isDashboard ? 'var(--os-surface-2)' : 'var(--ais-nav-item-active-bg)',
                border: `1px solid ${isDashboard ? 'var(--os-border)' : 'var(--ais-nav-border)'}`,
            }}
        >
            <Globe
                className="w-3 h-3 mx-1 flex-shrink-0"
                style={{ color: isDashboard ? 'var(--os-text-muted)' : 'var(--ais-nav-text-muted)' }}
            />
            {LOCALES.map((l) => {
                const isActive = locale === l.code;
                return (
                    <button
                        key={l.code}
                        onClick={() => switchLocale(l.code)}
                        className={`px-2 py-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-[10px] font-bold tracking-wider transition-all ${
                            isActive ? 'bg-emerald-500 text-white' : ''
                        }`}
                        style={!isActive ? { color: isDashboard ? 'var(--os-text-muted)' : 'var(--ais-nav-text-muted)' } : undefined}
                    >
                        {l.label}
                    </button>
                );
            })}
        </div>
    );
}
