'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { markNotificationRead } from '@/actions/markNotificationRead';

export interface NotificationRow {
    id: string;
    kind: string;
    title_key: string;
    body_key: string;
    body_params: Record<string, unknown>;
    deep_link: string | null;
    read_at: string | null;
    created_at: string;
}

interface Props {
    rows: NotificationRow[];
    onItemClick?: (id: string) => void;
    emptyMessage?: string;
}

/**
 * Resolves a dynamic i18n key with graceful fallback. next-intl throws on
 * missing keys; since the i18n bundle for OwnerPortal.notifications.* lands
 * in Task 10, we must not crash if a row arrives in production with a key
 * that does not yet exist in the user's locale.
 */
function safeTranslate(
    t: (key: never, params?: never) => string,
    key: string,
    params: Record<string, unknown>,
): string {
    try {
        return t(key as never, params as never);
    } catch {
        return key;
    }
}

/**
 * Tiny relative-time helper using Intl.RelativeTimeFormat. Returns strings
 * like "5m ago" / "2h ago" / "3d ago". Falls back to a locale string for
 * timestamps older than 30 days. No new dep.
 */
function formatRelative(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return iso;
    const now = Date.now();
    const diffSec = Math.round((then - now) / 1000);
    const absSec = Math.abs(diffSec);

    let rtf: Intl.RelativeTimeFormat;
    try {
        rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    } catch {
        return new Date(iso).toLocaleString();
    }

    if (absSec < 60) return rtf.format(Math.round(diffSec), 'second');
    if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (absSec < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    if (absSec < 2_592_000) return rtf.format(Math.round(diffSec / 86_400), 'day');
    return new Date(iso).toLocaleString();
}

function NotificationList({ rows, onItemClick, emptyMessage }: Props) {
    const router = useRouter();
    const t = useTranslations();

    async function handleClick(row: NotificationRow) {
        if (!row.read_at) {
            try {
                await markNotificationRead({ notificationId: row.id });
            } catch (e) {
                // Log but never throw — UX continues even if mark-read fails.
                console.error('[NotificationList] markNotificationRead failed:', e);
            }
        }
        if (onItemClick) onItemClick(row.id);
        if (row.deep_link) router.push(row.deep_link);
    }

    if (rows.length === 0) {
        const fallback = emptyMessage ?? safeTranslate(t, 'OwnerPortal.notifications.empty', {});
        return (
            <p className="text-xs text-[var(--os-text-muted)] py-6 text-center">{fallback}</p>
        );
    }

    return (
        <ul className="flex flex-col">
            {rows.map((row) => {
                const isUnread = !row.read_at;
                const title = safeTranslate(t, row.title_key, row.body_params);
                const body = safeTranslate(t, row.body_key, row.body_params);
                return (
                    <li
                        key={row.id}
                        onClick={() => handleClick(row)}
                        className="px-3 py-2.5 border-b border-[var(--os-border)] cursor-pointer hover:bg-[var(--os-surface-3)] transition-colors"
                        style={{ backgroundColor: isUnread ? 'rgba(16,185,129,0.04)' : undefined }}
                    >
                        <div className="flex items-start gap-2">
                            {isUnread && (
                                <span
                                    data-testid="unread-dot"
                                    className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0"
                                    aria-label="Unread"
                                />
                            )}
                            <div className={`flex-1 min-w-0 ${isUnread ? '' : 'pl-4'}`}>
                                <p className="text-sm font-semibold text-[var(--os-text-primary)]">{title}</p>
                                <p className="text-xs text-[var(--os-text-muted)] mt-0.5">{body}</p>
                                <p className="text-[10px] text-[var(--os-text-muted)] mt-1 tabular-nums">
                                    {formatRelative(row.created_at)}
                                </p>
                            </div>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

export { NotificationList };
export default NotificationList;
