import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { NotificationList, type NotificationRow } from './NotificationList';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

const markReadMock = vi.fn();
vi.mock('@/actions/markNotificationRead', () => ({
    markNotificationRead: (input: { notificationId: string }) => markReadMock(input),
}));

const messages = {
    OwnerPortal: {
        notifications: {
            empty: 'No notifications yet',
            // Title/body keys used by the rows
            titleProforma: 'Invoice ready',
            bodyProforma: 'Your invoice is ready',
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

describe('NotificationList', () => {
    beforeEach(() => {
        markReadMock.mockReset();
        markReadMock.mockResolvedValue(undefined);
        pushMock.mockReset();
    });

    it('renders empty state when no rows', () => {
        render(wrap(<NotificationList rows={[]} />));
        expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    });

    it('renders unread indicator dot for read_at === null rows', () => {
        const rows: NotificationRow[] = [
            {
                id: 'n-1',
                kind: 'proforma_ready',
                title_key: 'OwnerPortal.notifications.titleProforma',
                body_key: 'OwnerPortal.notifications.bodyProforma',
                body_params: {},
                deep_link: null,
                read_at: null,
                created_at: new Date().toISOString(),
            },
        ];
        const { container } = render(wrap(<NotificationList rows={rows} />));
        // unread dot has data-testid for stability
        expect(container.querySelector('[data-testid="unread-dot"]')).toBeTruthy();
    });

    it('does not render unread indicator dot when read_at is set', () => {
        const rows: NotificationRow[] = [
            {
                id: 'n-2',
                kind: 'proforma_ready',
                title_key: 'OwnerPortal.notifications.titleProforma',
                body_key: 'OwnerPortal.notifications.bodyProforma',
                body_params: {},
                deep_link: null,
                read_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
            },
        ];
        const { container } = render(wrap(<NotificationList rows={rows} />));
        expect(container.querySelector('[data-testid="unread-dot"]')).toBeNull();
    });

    it('clicking an unread item calls markNotificationRead + onItemClick + navigates if deep_link set', async () => {
        const onItemClick = vi.fn();
        const rows: NotificationRow[] = [
            {
                id: 'n-3',
                kind: 'proforma_ready',
                title_key: 'OwnerPortal.notifications.titleProforma',
                body_key: 'OwnerPortal.notifications.bodyProforma',
                body_params: {},
                deep_link: '/owner/invoices',
                read_at: null,
                created_at: new Date().toISOString(),
            },
        ];
        render(wrap(<NotificationList rows={rows} onItemClick={onItemClick} />));
        const item = screen.getByText('Invoice ready').closest('li')!;
        fireEvent.click(item);
        await waitFor(() => expect(markReadMock).toHaveBeenCalledWith({ notificationId: 'n-3' }));
        expect(onItemClick).toHaveBeenCalled();
        expect(pushMock).toHaveBeenCalledWith('/owner/invoices');
    });

    it('falls back to rendering the key when title/body keys are missing', () => {
        const rows: NotificationRow[] = [
            {
                id: 'n-4',
                kind: 'unknown',
                title_key: 'OwnerPortal.notifications.doesNotExist',
                body_key: 'OwnerPortal.notifications.alsoMissing',
                body_params: {},
                deep_link: null,
                read_at: null,
                created_at: new Date().toISOString(),
            },
        ];
        render(wrap(<NotificationList rows={rows} />));
        // Should not crash; should render the raw key as fallback.
        expect(screen.getByText('OwnerPortal.notifications.doesNotExist')).toBeInTheDocument();
    });
});
