'use client';

import * as React from 'react';
import { Palette, Sun, Moon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSkin, SkinId } from '@/lib/SkinContext';
import { useTranslations } from 'next-intl';

interface SkinDef {
    id: SkinId;
    accent: string;
    darkBg: string;
    lightBg: string;
    labelKey: string;
}

const SKINS: SkinDef[] = [
    { id: 'emerald',       accent: '#10B981', darkBg: '#0A1110', lightBg: '#F3F9F5', labelKey: 'skin_emerald' },
    { id: 'navy',          accent: '#38BDF8', darkBg: '#0B1426', lightBg: '#EFF6FF', labelKey: 'skin_navy' },
    { id: 'institutional', accent: '#059669', darkBg: '#0C1A14', lightBg: '#F0FAF4', labelKey: 'skin_institutional' },
];

interface SkinSwitcherProps {
    variant?: 'topbar' | 'settings' | 'inline';
}

export function SkinSwitcher({ variant = 'topbar' }: SkinSwitcherProps) {
    const { skin, setSkin } = useSkin();
    const { theme, setTheme } = useTheme();
    const t = useTranslations('Dashboard');
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => setMounted(true), []);
    React.useEffect(() => {
        function handler(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const isDark = theme === 'dark';

    // ── Settings variant: full visual cards ──────────────────────────────────
    if (variant === 'settings') {
        return (
            <div className="flex flex-col gap-4">
                {/* Skin selector */}
                <div className="flex gap-3 flex-wrap">
                    {SKINS.map((s) => {
                        const active = skin === s.id;
                        return (
                            <button
                                key={s.id}
                                onClick={() => setSkin(s.id)}
                                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all min-w-[120px]"
                                style={{
                                    borderColor: active ? s.accent : 'var(--os-border)',
                                    backgroundColor: active ? `${s.accent}10` : 'var(--os-surface)',
                                }}
                            >
                                {/* Mini preview: dark + light halves */}
                                <div className="flex rounded-lg overflow-hidden w-16 h-10 border border-[var(--os-border)]">
                                    <div className="flex-1 relative" style={{ backgroundColor: s.darkBg }}>
                                        <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: s.accent }} />
                                    </div>
                                    <div className="w-px" style={{ backgroundColor: s.accent }} />
                                    <div className="flex-1 relative" style={{ backgroundColor: s.lightBg }}>
                                        <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: s.accent }} />
                                    </div>
                                </div>
                                <span
                                    className="text-[11px] font-semibold"
                                    style={{ color: active ? s.accent : 'var(--os-text-muted)' }}
                                >
                                    {t(s.labelKey)}
                                </span>
                                {active && (
                                    <span className="text-[8px] font-bold uppercase tracking-widest" style={{ color: s.accent }}>
                                        {t('skin_active')}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Mode toggle (light/dark) within current skin */}
                {mounted && (
                    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}>
                        <span className="text-xs font-medium" style={{ color: 'var(--os-text-muted)' }}>
                            {t('skin_mode_label')}
                        </span>
                        <div className="flex rounded-lg overflow-hidden border border-[var(--os-border)]">
                            <button
                                onClick={() => setTheme('dark')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-all"
                                style={{
                                    backgroundColor: isDark ? 'var(--os-brand-green)' : 'transparent',
                                    color: isDark ? '#fff' : 'var(--os-text-muted)',
                                }}
                            >
                                <Moon className="w-3.5 h-3.5" />
                                {t('skin_mode_dark')}
                            </button>
                            <button
                                onClick={() => setTheme('light')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-all"
                                style={{
                                    backgroundColor: !isDark ? 'var(--os-brand-green)' : 'transparent',
                                    color: !isDark ? '#fff' : 'var(--os-text-muted)',
                                }}
                            >
                                <Sun className="w-3.5 h-3.5" />
                                {t('skin_mode_light')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── Inline variant (for use inside profile dropdown) ─────────────────────
    if (variant === 'inline') {
        return (
            <div className="flex flex-col gap-2">
                {/* Skin options as horizontal pills */}
                <div className="flex gap-1.5">
                    {SKINS.map((s) => {
                        const active = skin === s.id;
                        return (
                            <button
                                key={s.id}
                                onClick={() => setSkin(s.id)}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all text-[10px] font-semibold flex-1 justify-center"
                                style={{
                                    backgroundColor: active ? `${s.accent}18` : 'var(--os-surface-2)',
                                    border: active ? `1px solid ${s.accent}50` : '1px solid var(--os-border)',
                                    color: active ? s.accent : 'var(--os-text-muted)',
                                }}
                            >
                                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: s.accent }} />
                                {t(s.labelKey).split(' ')[0]}
                            </button>
                        );
                    })}
                </div>
                {/* Dark/Light toggle */}
                {mounted && (
                    <div className="flex rounded-lg overflow-hidden border border-[var(--os-border)]">
                        <button
                            onClick={() => setTheme('dark')}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-semibold transition-all"
                            style={{
                                backgroundColor: isDark ? 'var(--os-brand-green)' : 'transparent',
                                color: isDark ? '#fff' : 'var(--os-text-muted)',
                            }}
                        >
                            <Moon className="w-3 h-3" />
                            {t('skin_mode_dark')}
                        </button>
                        <button
                            onClick={() => setTheme('light')}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-semibold transition-all"
                            style={{
                                backgroundColor: !isDark ? 'var(--os-brand-green)' : 'transparent',
                                color: !isDark ? '#fff' : 'var(--os-text-muted)',
                            }}
                        >
                            <Sun className="w-3 h-3" />
                            {t('skin_mode_light')}
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // ── Topbar compact variant ───────────────────────────────────────────────
    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen((v) => !v)}
                title={t('skin_switch')}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:bg-[var(--os-surface-2)] hover:text-[var(--os-text-primary)] transition-colors"
            >
                <Palette className="w-4 h-4" />
            </button>

            {open && (
                <div
                    className="absolute right-0 top-full mt-2 w-56 rounded-xl overflow-hidden shadow-2xl z-50"
                    style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
                >
                    {/* Header */}
                    <div className="px-3 py-2 border-b border-[var(--os-border)]">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">
                            {t('skin_switch')}
                        </p>
                    </div>

                    {/* Skin options */}
                    {SKINS.map((s) => {
                        const active = skin === s.id;
                        return (
                            <button
                                key={s.id}
                                onClick={() => { setSkin(s.id); }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--os-surface-2)]"
                            >
                                {/* Swatch showing dark/light halves */}
                                <div
                                    className="w-7 h-7 rounded-md flex-shrink-0 flex overflow-hidden"
                                    style={{ border: active ? `2px solid ${s.accent}` : '1px solid var(--os-border)' }}
                                >
                                    <div className="flex-1" style={{ backgroundColor: s.darkBg }} />
                                    <div className="w-[2px]" style={{ backgroundColor: s.accent }} />
                                    <div className="flex-1" style={{ backgroundColor: s.lightBg }} />
                                </div>
                                <div className="flex-1 text-left">
                                    <p className="text-xs font-semibold" style={{ color: active ? s.accent : 'var(--os-text-primary)' }}>
                                        {t(s.labelKey)}
                                    </p>
                                </div>
                                {active && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${s.accent}18`, color: s.accent }}>
                                        ✓
                                    </span>
                                )}
                            </button>
                        );
                    })}

                    {/* Light/Dark toggle */}
                    {mounted && (
                        <div className="border-t border-[var(--os-border)] px-3 py-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">
                                    {t('skin_mode_label')}
                                </span>
                                <div className="flex rounded-md overflow-hidden border border-[var(--os-border)]">
                                    <button
                                        onClick={() => setTheme('dark')}
                                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold transition-all"
                                        style={{
                                            backgroundColor: isDark ? 'var(--os-brand-green)' : 'transparent',
                                            color: isDark ? '#fff' : 'var(--os-text-muted)',
                                        }}
                                    >
                                        <Moon className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={() => setTheme('light')}
                                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold transition-all"
                                        style={{
                                            backgroundColor: !isDark ? 'var(--os-brand-green)' : 'transparent',
                                            color: !isDark ? '#fff' : 'var(--os-text-muted)',
                                        }}
                                    >
                                        <Sun className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
