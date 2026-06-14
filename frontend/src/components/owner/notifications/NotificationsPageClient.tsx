'use client';

// ─────────────────────────────────────────────────────────────────────────────
// NotificationsPageClient — interactive notifications list page
// ─────────────────────────────────────────────────────────────────────────────
//
// Mounts under /owner/notifications. Reuses <NotificationList> from
// the bell dropdown and the GET /api/owner/notifications route for paginated
// reads (offset/limit). Holds three pieces of state:
//   - rows: accumulated NotificationRow[]
//   - filter: 'all' | 'unread' (client-side filter; v1 keeps it simple)
//   - offset: next offset for "Load more"
//
// "Mark all as read" calls the markAllNotificationsRead server action, then
// optimistically rewrites every loaded row's read_at to now() (avoids a full
// refetch and keeps scroll position).
// ─────────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { NotificationList, type NotificationRow } from '@/components/owner/NotificationBell';
import { markAllNotificationsRead } from '@/actions/markAllNotificationsRead';

const PAGE_SIZE = 20;

interface ApiResponse {
    notifications: NotificationRow[];
    unread_count: number;
}

type FilterMode = 'all' | 'unread';

/**
 * Resolves an i18n key with graceful fallback. The OwnerPortal.notifications.*
 * bundle lands in Task 10; the safeguard prevents crashes if a key is missing
 * in the user's locale. Mirrors the pattern in NotificationBell/NotificationList.
 */
function safeTranslate(t: (key: never) => string, key: string): string {
    try {
        return t(key as never);
    } catch {
        return key.split('.').pop() ?? key;
    }
}

export function NotificationsPageClient() {
    const t = useTranslations('OwnerPortal.notifications');

    const [rows, setRows] = React.useState<NotificationRow[]>([]);
    const [unreadCount, setUnreadCount] = React.useState(0);
    const [filter, setFilter] = React.useState<FilterMode>('all');
    const [offset, setOffset] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [loadingMore, setLoadingMore] = React.useState(false);
    const [hasMore, setHasMore] = React.useState(true);
    const [markingAll, setMarkingAll] = React.useState(false);

    const fetchPage = React.useCallback(async (pageOffset: number, append: boolean) => {
        try {
            const res = await fetch(
                `/api/owner/notifications?offset=${pageOffset}&limit=${PAGE_SIZE}`,
            );
            if (!res.ok) {
                if (!append) setRows([]);
                setHasMore(false);
                return;
            }
            const json = (await res.json()) as ApiResponse;
            setUnreadCount(json.unread_count);
            setHasMore(json.notifications.length === PAGE_SIZE);
            setRows((prev) => (append ? [...prev, ...json.notifications] : json.notifications));
        } catch (e) {
            console.error('[NotificationsPageClient] fetch failed:', e);
            setHasMore(false);
        }
    }, []);

    // Initial load.
    React.useEffect(() => {
        setLoading(true);
        fetchPage(0, false).finally(() => setLoading(false));
    }, [fetchPage]);

    async function handleLoadMore() {
        const nextOffset = offset + PAGE_SIZE;
        setLoadingMore(true);
        await fetchPage(nextOffset, true);
        setOffset(nextOffset);
        setLoadingMore(false);
    }

    async function handleMarkAll() {
        if (unreadCount === 0) return;
        setMarkingAll(true);
        try {
            await markAllNotificationsRead();
            // Optimistic: rewrite all loaded rows to read.
            const now = new Date().toISOString();
            setRows((prev) => prev.map((r) => (r.read_at ? r : { ...r, read_at: now })));
            setUnreadCount(0);
        } catch (e) {
            console.error('[NotificationsPageClient] markAllNotificationsRead failed:', e);
        } finally {
            setMarkingAll(false);
        }
    }

    // Optimistic per-row mark-read when the list bubbles up a click.
    function handleItemClick(id: string) {
        const now = new Date().toISOString();
        setRows((prev) =>
            prev.map((r) => (r.id === id && !r.read_at ? { ...r, read_at: now } : r)),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
    }

    const visibleRows = filter === 'unread' ? rows.filter((r) => !r.read_at) : rows;

    return (
        <div className="px-6 py-6 max-w-3xl mx-auto">
            <header className="mb-6 flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">
                        {safeTranslate(t, 'pageTitle')}
                    </h1>
                    {unreadCount > 0 && (
                        <p className="text-sm text-[var(--os-text-muted)] mt-1">
                            {unreadCount} {safeTranslate(t, 'unreadLabel')}
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={handleMarkAll}
                    disabled={unreadCount === 0 || markingAll}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[var(--os-border)] hover:bg-[var(--os-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {safeTranslate(t, 'markAllRead')}
                </button>
            </header>

            <div
                role="tablist"
                aria-label={safeTranslate(t, 'filterAria')}
                className="flex gap-2 mb-4"
            >
                <button
                    type="button"
                    role="tab"
                    aria-selected={filter === 'all'}
                    onClick={() => setFilter('all')}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        filter === 'all'
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500'
                            : 'border-[var(--os-border)] hover:bg-[var(--os-surface-2)]'
                    }`}
                >
                    {safeTranslate(t, 'filterAll')}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={filter === 'unread'}
                    onClick={() => setFilter('unread')}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        filter === 'unread'
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500'
                            : 'border-[var(--os-border)] hover:bg-[var(--os-surface-2)]'
                    }`}
                >
                    {safeTranslate(t, 'filterUnread')}
                </button>
            </div>

            <div className="os-card overflow-hidden">
                {loading ? (
                    <p className="text-xs text-[var(--os-text-muted)] py-6 text-center">
                        {safeTranslate(t, 'loading')}
                    </p>
                ) : visibleRows.length === 0 ? (
                    <p className="text-xs text-[var(--os-text-muted)] py-10 text-center">
                        {filter === 'unread'
                            ? safeTranslate(t, 'emptyUnread')
                            : safeTranslate(t, 'empty')}
                    </p>
                ) : (
                    <NotificationList rows={visibleRows} onItemClick={handleItemClick} />
                )}
            </div>

            {hasMore && !loading && (
                <div className="flex justify-center mt-4">
                    <button
                        type="button"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        className="text-xs px-4 py-2 rounded-lg border border-[var(--os-border)] hover:bg-[var(--os-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {loadingMore
                            ? safeTranslate(t, 'loadingMore')
                            : safeTranslate(t, 'loadMore')}
                    </button>
                </div>
            )}
        </div>
    );
}

export default NotificationsPageClient;
