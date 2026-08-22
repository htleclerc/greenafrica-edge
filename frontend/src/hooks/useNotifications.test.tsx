import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { READ_STATE_KEY } from '@/lib/notificationReadState';

// ── Doublures ────────────────────────────────────────────────────────────────

const roleState = { isDemo: false, ready: true, kind: 'staff' as 'staff' | 'operator' };
vi.mock('@/lib/RoleContext', () => ({ useRole: () => roleState }));
vi.mock('@/hooks/usePrincipalKind', () => ({
    usePrincipalKind: () => ({ kind: roleState.kind, modes: [] }),
}));

const markNotificationRead = vi.fn().mockResolvedValue(undefined);
const markAllNotificationsRead = vi.fn().mockResolvedValue({ count: 1 });
const markStaffNotificationRead = vi.fn().mockResolvedValue({ ok: true, count: 1 });
const markAllStaffNotificationsRead = vi.fn().mockResolvedValue({ ok: true, count: 1 });
vi.mock('@/actions/markNotificationRead', () => ({
    markNotificationRead: (...a: unknown[]) => markNotificationRead(...a),
}));
vi.mock('@/actions/markAllNotificationsRead', () => ({
    markAllNotificationsRead: (...a: unknown[]) => markAllNotificationsRead(...a),
}));
vi.mock('@/actions/markStaffNotificationsRead', () => ({
    markStaffNotificationRead: (...a: unknown[]) => markStaffNotificationRead(...a),
    markAllStaffNotificationsRead: (...a: unknown[]) => markAllStaffNotificationsRead(...a),
}));

/** Query builder minimal : chaque table rend ses lignes et leur compte. */
const tables: Record<string, unknown[]> = {};
function stubSupabase() {
    return {
        from: (table: string) => {
            const rows = tables[table] ?? [];
            const builder: Record<string, unknown> = {};
            for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit']) {
                builder[method] = () => builder;
            }
            builder.then = (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve);
            return builder;
        },
    };
}
vi.mock('@/lib/supabase/client', () => ({ createClient: () => stubSupabase() }));

import { useNotifications } from './useNotifications';

const staffRow = {
    id: 's1',
    kind: 'COLLECTION_ESCALATED',
    title_key: 'StaffNotifications.kind.COLLECTION_ESCALATED.title',
    body_key: 'StaffNotifications.kind.COLLECTION_ESCALATED.body',
    body_params: { debtor: 'Gulf Maritime Ltd' },
    deep_link: '/admin/collections',
    read_at: null,
    created_at: '2026-08-23T09:00:00Z',
};

beforeEach(() => {
    roleState.isDemo = false;
    roleState.ready = true;
    roleState.kind = 'staff';
    localStorage.clear();
    vi.clearAllMocks();
    tables.v_staff_notifications = [staffRow];
    tables.registration_requests = [{ id: 'r1' }];
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('useNotifications — staff (table mig 133)', () => {
    // Le staff lit desormais de vrais faits dates, plus un etat recalcule.
    it('lit le fil du staff plutôt qu’un état recalculé', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));
        expect(result.current.notifications[0].titleKey)
            .toBe('StaffNotifications.kind.COLLECTION_ESCALATED.title');
        expect(result.current.notifications[0].href).toBe('/admin/collections');
    });

    it('déduit le non-lu de l’absence de read_at', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));
        expect(result.current.unreadCount).toBe(1);
    });

    it('respecte un read_at déjà posé par cet agent', async () => {
        tables.v_staff_notifications = [{ ...staffRow, read_at: '2026-08-23T10:00:00Z' }];
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));
        expect(result.current.unreadCount).toBe(0);
    });

    // RÉGRESSION — le lu ne vit plus dans le navigateur : il est écrit en base,
    // donc il survit au rafraîchissement ET suit l'agent d'un poste à l'autre.
    it('persiste le lu en base, pas dans le navigateur', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));

        act(() => { result.current.markRead('s1'); });
        expect(markStaffNotificationRead).toHaveBeenCalledWith({ notificationId: 's1' });
        expect(localStorage.getItem(READ_STATE_KEY)).toBeNull();
    });

    it('marque tout lu par l’action dédiée au staff', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));

        act(() => { result.current.markAllRead(); });
        expect(markAllStaffNotificationsRead).toHaveBeenCalled();
        expect(markAllNotificationsRead).not.toHaveBeenCalled();
        expect(result.current.unreadCount).toBe(0);
    });

    // Le compte de travail restant se dérive légitimement, lui : ce n'est pas
    // un fait daté mais un reste à traiter.
    it('compte séparément les inscriptions en attente, pour la barre latérale', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.pendingRegistrations).toBe(1));
    });
});

describe('useNotifications — armateur (mig 053)', () => {
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

    it('lit les vraies notifications plutôt que l’état dérivé', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));
        expect(fetch).toHaveBeenCalledWith('/api/owner/notifications?limit=20', { cache: 'no-store' });
        expect(result.current.notifications[0].titleKey).toContain('PAYMENT_RECEIVED');
    });

    it('n’emprunte jamais les actions du staff', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toHaveLength(1));

        act(() => { result.current.markRead('n1'); });
        expect(markNotificationRead).toHaveBeenCalledWith({ notificationId: 'n1' });
        expect(markStaffNotificationRead).not.toHaveBeenCalled();
    });

    it('reste muette plutôt que de casser le tableau de bord si l’API échoue', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications).toEqual([]));
    });
});

describe('useNotifications — démonstration', () => {
    beforeEach(() => { roleState.isDemo = true; });

    // Les notifications de demo sont synthetiques : aucune table derriere elles,
    // leur lu ne peut vivre que dans le navigateur.
    it('mémorise le lu localement, faute de table', async () => {
        const { result } = renderHook(() => useNotifications());
        await waitFor(() => expect(result.current.notifications.length).toBeGreaterThan(0));

        act(() => { result.current.markAllRead(); });
        expect(localStorage.getItem(READ_STATE_KEY)).not.toBeNull();
        expect(markAllStaffNotificationsRead).not.toHaveBeenCalled();
    });

    it('retient ce lu au remontage', async () => {
        const { result: first } = renderHook(() => useNotifications());
        await waitFor(() => expect(first.current.notifications.length).toBeGreaterThan(0));
        act(() => { first.current.markAllRead(); });

        const { result: second } = renderHook(() => useNotifications());
        await waitFor(() => expect(second.current.notifications.length).toBeGreaterThan(0));
        expect(second.current.unreadCount).toBe(0);
    });
});
