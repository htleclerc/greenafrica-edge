'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NotificationList, type NotificationRow } from './NotificationList';
import { markAllNotificationsRead } from '@/actions/markAllNotificationsRead';

interface ApiResponse {
    notifications: NotificationRow[];
    unread_count: number;
}

const POLL_INTERVAL_MS = 60_000; // 60s per Plan 7F spec
const DROPDOWN_LIMIT = 10;

/**
 * Resolves an i18n key with graceful fallback. next-intl throws on missing
 * keys; since the OwnerPortal.notifications.* bundle lands in Task 10, we
 * must not crash if this bell mounts before then. Mirrors the safeguard in
 * NotificationList.tsx.
 */
function safeTranslate(t: (key: never) => string, key: string): string {
    try {
        return t(key as never);
    } catch {
        // Last path segment is a readable fallback
        const last = key.split('.').pop() ?? key;
        return last;
    }
}

function NotificationBell() {
    const t = useTranslations('OwnerPortal.notifications');
    const [data, setData] = React.useState<ApiResponse | null>(null);
    const [open, setOpen] = React.useState(false);
    const rootRef = React.useRef<HTMLDivElement>(null);

    const fetchData = React.useCallback(async () => {
        try {
            const res = await fetch(`/api/owner/notifications?limit=${DROPDOWN_LIMIT}`);
            if (!res.ok) return;
            const json = (await res.json()) as ApiResponse;
            setData(json);
        } catch (e) {
            console.error('[NotificationBell] fetch failed:', e);
        }
    }, []);

    React.useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchData]);

    // Close on outside click.
    React.useEffect(() => {
        if (!open) return;
        function onClick(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    const unread = data?.unread_count ?? 0;
    const badgeLabel = unread > 9 ? '9+' : String(unread);

    async function handleMarkAll() {
        try {
            await markAllNotificationsRead();
            await fetchData();
        } catch (e) {
            console.error('[NotificationBell] markAllNotificationsRead failed:', e);
        }
    }

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="relative p-2 rounded-lg hover:bg-[var(--os-surface-2)] transition-colors"
                aria-label={safeTranslate(t, 'bellAria')}
                aria-haspopup="true"
                aria-expanded={open}
            >
                <Bell className="w-4 h-4 text-[var(--os-text-primary)]" />
                {unread > 0 && (
                    <span
                        className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                        style={{ backgroundColor: '#EF4444' }}
                        aria-live="polite"
                    >
                        {badgeLabel}
                    </span>
                )}
            </button>

            {open && (
                <div
                    className="absolute right-0 top-full mt-2 w-[380px] max-w-[95vw] rounded-xl z-50 shadow-lg max-h-[480px] flex flex-col"
                    style={{
                        backgroundColor: 'var(--os-surface-2)',
                        border: '1px solid var(--os-border)',
                    }}
                >
                    <header className="flex items-center justify-between px-3 py-2 border-b border-[var(--os-border)]">
                        <h2 className="text-sm font-bold text-[var(--os-text-primary)]">
                            {safeTranslate(t, 'title')}
                        </h2>
                        {unread > 0 && (
                            <button
                                type="button"
                                onClick={handleMarkAll}
                                className="text-[11px] text-emerald-500 hover:underline"
                            >
                                {safeTranslate(t, 'markAllRead')}
                            </button>
                        )}
                    </header>
                    <div className="overflow-y-auto flex-1">
                        <NotificationList
                            rows={data?.notifications ?? []}
                            onItemClick={() => setOpen(false)}
                        />
                    </div>
                    <footer className="border-t border-[var(--os-border)] px-3 py-2 text-center">
                        <Link
                            href="/owner/notifications"
                            onClick={() => setOpen(false)}
                            className="text-xs text-emerald-500 hover:underline"
                        >
                            {safeTranslate(t, 'viewAll')}
                        </Link>
                    </footer>
                </div>
            )}
        </div>
    );
}

export { NotificationBell };
export default NotificationBell;
