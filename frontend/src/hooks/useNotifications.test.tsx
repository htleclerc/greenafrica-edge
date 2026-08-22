import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { READ_STATE_KEY } from '@/lib/notificationReadState';

// ── Doublures ────────────────────────────────────────────────────────────────

const roleState = { isDemo: false, ready: true, kind: 'staff' as 'staff' | 'operator' };
vi.mock('@/lib/RoleContext', () => ({
    useRole: () => roleState,
}));
vi.mock('@/hooks/usePrincipalKind', () => ({
    usePrincipalKind: () => ({ kind: roleState.kind, modes: [] }),
}));

const markNotificationRead = vi.fn().mockResolvedValue(undefined);
const markAllNotificationsRead = vi.fn().mockResolvedValue({ count: 1 });
vi.mock('@/actions/markNotificationRead', () => ({
    markNotificationRead: (...a: unknown[]) => markNotificationRead(...a),
}));
vi.mock('@/actions/markAllNotificationsRead', () => ({
    markAllNotificationsRead: (...a: unknown[]) => markAllNotificationsRead(...a),
}));

/**
 * Le client Supabase du staff : une seule inscription en attente, rien d'autre.
 * Chaque `select` rend la meme forme thenable que le query builder reel.
 */
function stubSupabase(rows: Record<string, unknown[]>) {
    return {
        from: (table: string) => {
            const result = { data: rows[table] ?? [], count: (rows[table] ?? []).length };
            const builder: Record<string, unknown> = {};
            for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
                builder[method] = () => builder;
            }
            builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
            return builder;
        },
    };
}

const supabaseRows: Record<string, unknown[]> = {};
vi.mock('@/lib/supabase/client', () => ({
    createClient: () => stubSupabase(supabaseRows),
}));

import { useNotifications } from './useNotifications';

beforeEach(() => {
    roleState.isDemo = false;
    roleState.ready = true;
    roleState.kind = 'staff';
    localStorage.clear();
    vi.clearAllMocks();
    supabaseRows.registration_requests = [
        { id: 'r1', org_name: 'Berbera Port Services', created_at: '2026-08-22T09:00:00Z' },
    ];
    supabaseRows.transactions = [];
    supabaseRows.vessels = [];
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('useNotifications — staff (alertes dérivées)', () => {
    it('dérive une alerte par inscription en attente', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));
        expect(result.current.pendingRegistrations).toBe(1);
        expect(result.current.unreadCount).toBe(1);
    });

    it('qualifie les clés i18n pour que la cloche les résolve depuis la racine', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));
        expect(result.current.notifications[0].titleKey).toBe('Dashboard.notif_registration_title');
    });

    // RÉGRESSION — le défaut central : markAllRead ne vivait que dans l'état
    // React, et le rafraîchissement suivant repoussait tout en non lu.
    it('retient le lu au-delà du rafraîchissement', async () => {
        const { result: first } = renderHook(() => useNotifications());
        await waitFor(() => expect(first.current.notifications).toHaveLength(1));

        act(() => { first.current.markAllRead(); });
        expect(first.current.unreadCount).toBe(0);
        expect(localStorage.getItem(READ_STATE_KEY)).toContain('reg-r1');

        // Un nouveau montage rejoue exactement ce que fait l'intervalle de 60 s.
        const { result: second } = renderHook(() => useNotifications());
        await waitFor(() => expect(second.current.notifications).toHaveLength(1));
        expect(second.current.unreadCount).toBe(0);
    });

    it('retient aussi une lecture unitaire', async () => {
        const { result: first } = renderHook(() => useNotifications());
        await waitFor(() => expect(first.current.notifications).toHaveLength(1));
        act(() => { first.current.markRead('reg-r1'); });

        const { result: second } = renderHook(() => useNotifications());
        await waitFor(() => expect(second.current.notifications).toHaveLength(1));
        expect(second.current.notifications[0].read).toBe(true);
    });

    it('n’appelle pas les actions serveur, qui sont réservées aux armateurs', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));
        act(() => { result.current.markAllRead(); });
        expect(markAllNotificationsRead).not.toHaveBeenCalled();
    });
});

describe('useNotifications — armateur (lignes persistées)', () => {
    const ownerRow = {
        id: 'n1',
        kind: 'PAYMENT_RECEIVED',
        title_key: 'OwnerPortal.notifications.kind.PAYMENT_RECEIVED.title',
        body_key: 'OwnerPortal.notifications.kind.PAYMENT_RECEIVED.body',
        body_params: { amount_usd: 48200 },
        deep_link: '/dashboard/invoices',
        read_at: null,
        created_at: '2026-08-22T09:00:00Z',
    };

    beforeEach(() => {
        roleState.kind = 'operator';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ notifications: [ownerRow], unread_count: 1 }),
        }));
    });

    // C'est le second défaut : les 17 types réels d'un armateur — ceux qui
    // déclenchent un e-mail — n'atteignaient jamais la cloche.
    it('lit les vraies notifications plutôt que l’état dérivé', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));
        expect(fetch).toHaveBeenCalledWith('/api/owner/notifications?limit=20', { cache: 'no-store' });
        expect(result.current.notifications[0].titleKey).toContain('PAYMENT_RECEIVED');
        expect(result.current.notifications[0].href).toBe('/dashboard/invoices');
    });

    it('persiste le lu côté serveur, pas dans le navigateur', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));

        act(() => { result.current.markRead('n1'); });
        expect(markNotificationRead).toHaveBeenCalledWith({ notificationId: 'n1' });
        expect(localStorage.getItem(READ_STATE_KEY)).toBeNull();
    });

    it('marque tout lu par l’action dédiée', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));
        act(() => { result.current.markAllRead(); });
        expect(markAllNotificationsRead).toHaveBeenCalled();
        expect(result.current.unreadCount).toBe(0);
    });

    it('reste muette plutôt que de casser le tableau de bord si l’API échoue', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toEqual([]));
        expect(result.current.unreadCount).toBe(0);
    });
});
