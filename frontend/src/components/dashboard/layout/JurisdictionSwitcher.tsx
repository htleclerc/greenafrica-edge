'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { setActiveJurisdiction } from '@/actions/setActiveJurisdiction';

interface Membership {
    id: string;
    code: string;
    name: string;
}

interface JurisdictionData {
    memberships: Membership[];
    active: string | null;
}

interface JurisdictionSwitcherProps {
    /** Whether the sidebar is currently expanded (shows labels). */
    expanded: boolean;
}

/**
 * Jurisdiction context switcher for multi-country staff.
 *
 * - 0 memberships → renders nothing.
 * - fetch error → renders inline error with retry control.
 * - 1 membership → static label (small-caps).
 * - >1 memberships → <select> dropdown; onChange sets the cookie via
 *   setActiveJurisdiction and refreshes the router so all server components
 *   re-resolve with the new active jurisdiction.
 *
 * Mounted in DashboardSidebar below the logo block. When the sidebar is
 * collapsed (icon-only 56px mode) the label/select fades out to match the
 * standard sidebar transition behaviour.
 */
export function JurisdictionSwitcher({ expanded }: JurisdictionSwitcherProps) {
    const t = useTranslations('JurisdictionSwitcher');
    const router = useRouter();

    // null = loading; 'error' = fetch failed; JurisdictionData = loaded.
    const [fetchState, setFetchState] = React.useState<JurisdictionData | 'error' | null>(null);
    // Incrementing retryCount re-runs the fetch effect.
    const [retryCount, setRetryCount] = React.useState(0);
    const [switching, setSwitching] = React.useState(false);
    const [switchError, setSwitchError] = React.useState<string | null>(null);

    // Stable ref so the auto-select effect can guard against double-fire
    // without re-running the effect every render.
    const autoSelectedRef = React.useRef(false);

    React.useEffect(() => {
        const controller = new AbortController();
        const signal = controller.signal;

        fetch('/api/me/jurisdictions', { signal })
            .then((r) => {
                if (!r.ok) return Promise.reject(new Error('fetch failed'));
                return r.json() as Promise<JurisdictionData>;
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

    // Self-heal: first multi-jurisdiction login (mig 082 rollout): auto-select
    // the first membership through the validated action so server resolutions
    // don't fail-closed before the user ever sees the switcher.
    React.useEffect(() => {
        if (!fetchState || fetchState === 'error') return;
        if (autoSelectedRef.current) return;
        if (fetchState.active !== null) return;
        if (fetchState.memberships.length <= 1) return;

        autoSelectedRef.current = true;
        const firstId = fetchState.memberships[0].id;
        setActiveJurisdiction({ jurisdictionId: firstId })
            .then((result) => {
                if (result.ok) {
                    setFetchState((s) =>
                        s && s !== 'error' ? { ...s, active: firstId } : s,
                    );
                    router.refresh();
                }
            })
            .catch(() => {
                // Fail-soft: auto-select is best-effort; the user can pick manually.
            });
    }, [fetchState, router]);

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

    if (!fetchState || fetchState.memberships.length === 0) return null;

    const { memberships, active } = fetchState;

    // ── 1 membership — static label ─────────────────────────────────────────
    if (memberships.length === 1) {
        const m = memberships[0];
        return (
            <div
                className="px-3 py-1.5 overflow-hidden"
                style={{
                    opacity: expanded ? 1 : 0,
                    transition: 'opacity 150ms ease',
                    pointerEvents: expanded ? 'auto' : 'none',
                }}
            >
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                    {m.code} · {m.name}
                </span>
            </div>
        );
    }

    // ── >1 memberships — dropdown ────────────────────────────────────────────
    async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const jurisdictionId = e.target.value;
        if (!jurisdictionId) return;
        setSwitching(true);
        setSwitchError(null);
        try {
            const result = await setActiveJurisdiction({ jurisdictionId });
            if (result.ok) {
                // Optimistically update local state so the select reflects the
                // new active value immediately, before router.refresh() completes.
                setFetchState((s) =>
                    s && s !== 'error' ? { ...s, active: jurisdictionId } : s,
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

    return (
        <div
            className="px-2 py-1.5 overflow-hidden flex flex-col gap-0.5"
            style={{
                opacity: expanded ? 1 : 0,
                transition: 'opacity 150ms ease',
                pointerEvents: expanded ? 'auto' : 'none',
            }}
        >
            <label className="text-[9px] font-bold uppercase tracking-widest px-1" style={{ color: 'var(--os-text-muted)' }}>
                {t('label')}
            </label>
            <select
                aria-label={t('label')}
                value={active ?? ''}
                onChange={handleChange}
                disabled={switching}
                className="bg-[var(--os-surface-2)] border border-[var(--os-border)] rounded text-xs text-[var(--os-text-primary)] px-2 py-1 w-full"
            >
                {!active && (
                    <option value="" disabled>
                        {t('select')}
                    </option>
                )}
                {memberships.map((m) => (
                    <option key={m.id} value={m.id}>
                        {m.code} · {m.name}
                    </option>
                ))}
            </select>
            {switchError && (
                <span className="text-[10px] text-[var(--os-red)] px-1">{switchError}</span>
            )}
        </div>
    );
}
