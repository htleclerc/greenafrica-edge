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
 * - 0 memberships or fetch error → renders nothing.
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

    const [data, setData] = React.useState<JurisdictionData | null>(null);
    const [switching, setSwitching] = React.useState(false);
    const [switchError, setSwitchError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        fetch('/api/me/jurisdictions')
            .then((r) => (r.ok ? r.json() : null))
            .then((json: JurisdictionData | null) => {
                if (!cancelled) setData(json);
            })
            .catch(() => {
                if (!cancelled) setData(null);
            });
        return () => { cancelled = true; };
    }, []);

    if (!data || data.memberships.length === 0) return null;

    const { memberships, active } = data;

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
