import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { NotificationBell } from './NotificationBell';

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/actions/markNotificationRead', () => ({
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
}));

const markAllMock = vi.fn();
vi.mock('@/actions/markAllNotificationsRead', () => ({
    markAllNotificationsRead: () => markAllMock(),
}));

const messages = {
    OwnerPortal: {
        notifications: {
            bellAria: 'Notifications',
            title: 'Notifications',
            markAllRead: 'Mark all read',
            viewAll: 'View all',
            empty: 'No notifications yet',
        },
    },
};

function wrap(ui: React.ReactNode) {
    return (
        <NextIntlClientProvider locale="en" messages={messages}>
            {ui}
        </NextIntlClientProvider>
    );
}

function mockFetch(unread: number) {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ notifications: [], unread_count: unread }),
    }) as unknown as typeof fetch;
}

describe('NotificationBell', () => {
    beforeEach(() => {
        markAllMock.mockReset();
        markAllMock.mockResolvedValue({ count: 0 });
        mockFetch(0);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the bell button with aria-label', async () => {
        render(wrap(<NotificationBell />));
        const btn = screen.getByLabelText('Notifications');
        expect(btn).toBeInTheDocument();
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    });

    it('shows the unread badge when unread_count > 0', async () => {
        mockFetch(3);
        render(wrap(<NotificationBell />));
        await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    });

    it('shows "9+" when unread_count > 9', async () => {
        mockFetch(42);
        render(wrap(<NotificationBell />));
        await waitFor(() => expect(screen.getByText('9+')).toBeInTheDocument());
    });

    it('hides the badge when unread_count is 0', async () => {
        mockFetch(0);
        render(wrap(<NotificationBell />));
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        // No "0" badge text rendered
        expect(screen.queryByText('0')).toBeNull();
    });

    it('clicking the bell toggles the dropdown open and closed', async () => {
        mockFetch(0);
        render(wrap(<NotificationBell />));
        const btn = screen.getByLabelText('Notifications');
        // Dropdown header not visible initially
        expect(screen.queryByRole('heading', { name: 'Notifications' })).toBeNull();
        fireEvent.click(btn);
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument());
        fireEvent.click(btn);
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Notifications' })).toBeNull());
    });
});
