'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { setActiveMode } from '@/actions/setActiveMode';
import type { ActiveMode } from '@/lib/auth/activeMode';

interface ModeData {
    enabled: ('MARITIME' | 'AIR')[];
    active: ActiveMode;
}

interface ModeSwitcherProps {
    /** Whether the sidebar is currently expanded (shows labels). */
    expanded: boolean;
}

/**
 * Transport mode switcher (Maritime / Air / Both) for multi-mode jurisdictions.
 *
 * - 0 or 1 mode enabled → renders nothing (no filter is useful with one mode).
 * - fetch error → renders inline error with retry control.
 * - >1 modes enabled → <select> with Both / Maritime / Air options; onChange
 *   writes the cookie via setActiveMode and refreshes the router so all server
 *   components re-resolve with the new active mode.
 *
 * Mounted in DashboardSidebar below the JurisdictionSwitcher, in renderStaffNav().
 * Visibility follows the same opacity-transition pattern as JurisdictionSwitcher.
 */
export function ModeSwitcher({ expanded }: ModeSwitcherProps) {
    const t = useTranslations('ModeSwitcher');
    const router = useRouter();

    // null = loading; 'error' = fetch failed; ModeData = loaded.
    const [fetchState, setFetchState] = React.useState<ModeData | 'error' | null>(null);
    // Incrementing retryCount re-runs the fetch effect.
    const [retryCount, setRetryCount] = React.useState(0);
    const [switching, setSwitching] = React.useState(false);
    const [switchError, setSwitchError] = React.useState<string | null>(null);

    React.useEffect(() => {
        const controller = new AbortController();
        const signal = controller.signal;

        fetch('/api/me/modes', { signal })
            .then((r) => {
                if (!r.ok) return Promise.reject(new Error('fetch failed'));
                return r.json() as Promise<ModeData>;
            })
            .then((json) => {
                if (!signal.aborted) setFetchState(json);
            })
            .catch((err: unknown) => {
                if (err instanceof Error && err.name === 'AbortError') return;
                if (signal.aborted) return;
                setFetchState('error');
            });

        return () => { controller.abort(); };
    }, [retryCount]);

    // ── Fetch error state ────────────────────────────────────────────────────
    if (fetchState === 'error') {
        return (
            <div
                className="px-3 py-1.5 overflow-hidden flex flex-col gap-1"
                style={{
                    opacity: expanded ? 1 : 0,
                    transition: 'opacity 150ms ease',
                    pointerEvents: expanded ? 'auto' : 'none',
                }}
            >
                <span className="text-[10px] text-[var(--os-red)] px-1">{t('error')}</span>
                <button
                    onClick={() => setRetryCount((c) => c + 1)}
                    className="text-[10px] underline text-[var(--os-text-muted)] px-1 text-left hover:text-[var(--os-text-primary)] transition-colors"
                >
                    {t('retry')}
                </button>
            </div>
        );
    }

    // Still loading or only 0/1 modes enabled — nothing to show.
    if (!fetchState || fetchState.enabled.length <= 1) return null;

    const { enabled, active } = fetchState;

    async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const mode = e.target.value;
        if (!mode) return;
        setSwitching(true);
        setSwitchError(null);
        try {
            const result = await setActiveMode({ mode });
            if (result.ok) {
                // Optimistically update local state so the select reflects the
                // new value immediately, before router.refresh() completes.
                setFetchState((s) =>
                    s && s !== 'error' ? { ...s, active: mode as ActiveMode } : s,
                );
                router.refresh();
            } else {
                setSwitchError(t('error'));
            }
        } catch {
            setSwitchError(t('error'));
        } finally {
            setSwitching(false);
        }
    }

    // Build option list: always include BOTH; then only the enabled modes.
    const options: { value: ActiveMode; label: string }[] = [
        { value: 'BOTH', label: t('both') },
        ...(enabled.includes('MARITIME') ? [{ value: 'MARITIME' as ActiveMode, label: t('maritime') }] : []),
        ...(enabled.includes('AIR') ? [{ value: 'AIR' as ActiveMode, label: t('air') }] : []),
    ];

    return (
        <div
            className="px-2 py-1.5 overflow-hidden flex flex-col gap-0.5"
            style={{
                opacity: expanded ? 1 : 0,
                transition: 'opacity 150ms ease',
                pointerEvents: expanded ? 'auto' : 'none',
            }}
        >
            <label
                className="text-[9px] font-bold uppercase tracking-widest px-1"
                style={{ color: 'var(--os-text-muted)' }}
            >
                {t('label')}
            </label>
            <select
                aria-label={t('label')}
                value={active}
                onChange={handleChange}
                disabled={switching}
                className="bg-[var(--os-surface-2)] border border-[var(--os-border)] rounded text-xs text-[var(--os-text-primary)] px-2 py-1 w-full"
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
            {switchError && (
                <span className="text-[10px] text-[var(--os-red)] px-1">{switchError}</span>
            )}
        </div>
    );
}
