'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggleButton() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = React.useState(false);

    // Avoid hydration mismatch
    React.useEffect(() => setMounted(true), []);
    if (!mounted) return <div className="w-9 h-9" />;

    const isDark = theme === 'dark';

    return (
        <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Day mode' : 'Night mode'}
            className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 group"
            style={{
                backgroundColor: 'var(--ais-nav-item-active-bg)',
                border: '1px solid var(--ais-nav-border)',
                color: 'var(--ais-nav-text-muted)',
            }}
        >
            <div className="relative w-4 h-4">
                {/* Sun icon — visible in dark mode (click → go light) */}
                <Sun
                    className="absolute inset-0 w-4 h-4 transition-all duration-300"
                    style={{
                        opacity: isDark ? 1 : 0,
                        transform: isDark ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0.5)',
                        color: isDark ? '#EAB308' : 'transparent',
                    }}
                />
                {/* Moon icon — visible in light mode (click → go dark) */}
                <Moon
                    className="absolute inset-0 w-4 h-4 transition-all duration-300"
                    style={{
                        opacity: isDark ? 0 : 1,
                        transform: isDark ? 'rotate(90deg) scale(0.5)' : 'rotate(0deg) scale(1)',
                        color: isDark ? 'transparent' : '#059669',
                    }}
                />
            </div>
        </button>
    );
}
