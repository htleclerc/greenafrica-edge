'use client';

import * as React from 'react';
import { Palette } from 'lucide-react';
import { useSkin, SkinId } from '@/lib/SkinContext';
import { useTranslations } from 'next-intl';

interface SkinDef {
    id: SkinId;
    accent: string;
    bg: string;
    labelKey: string;
}

const SKINS: SkinDef[] = [
    { id: 'emerald',       accent: '#10B981', bg: '#0A1110', labelKey: 'skin_emerald' },
    { id: 'navy',          accent: '#38BDF8', bg: '#0B1426', labelKey: 'skin_navy' },
    { id: 'institutional', accent: '#059669', bg: '#F0FAF4', labelKey: 'skin_institutional' },
];

interface SkinSwitcherProps {
    variant?: 'topbar' | 'settings' | 'inline';
}

export function SkinSwitcher({ variant = 'topbar' }: SkinSwitcherProps) {
    const { skin, setSkin } = useSkin();
    const t = useTranslations('Dashboard');
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        function handler(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ── Settings variant: full visual cards ──────────────────────────────────
    if (variant === 'settings') {
        return (
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
                            <div
                                className="w-16 h-10 rounded-lg border border-[var(--os-border)]"
                                style={{ backgroundColor: s.bg }}
                            >
                                <div className="w-full h-full flex items-end">
                                    <div className="w-full h-[2px]" style={{ backgroundColor: s.accent }} />
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
        );
    }

    // ── Inline variant (for use inside profile dropdown) ─────────────────────
    if (variant === 'inline') {
        return (
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
                                onClick={() => { setSkin(s.id); setOpen(false); }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--os-surface-2)]"
                            >
                                <div
                                    className="w-7 h-7 rounded-md flex-shrink-0"
                                    style={{
                                        backgroundColor: s.bg,
                                        border: active ? `2px solid ${s.accent}` : '1px solid var(--os-border)',
                                    }}
                                />
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
                </div>
            )}
        </div>
    );
}
