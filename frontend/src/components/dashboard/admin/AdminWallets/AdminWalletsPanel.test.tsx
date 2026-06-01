import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { AdminWalletsPanel } from './AdminWalletsPanel';
import en from '../../../../../messages/en.json';
import { vi } from 'vitest';

vi.mock('@/lib/RoleContext', () => ({ useRole: () => ({ role: 'FINANCE_ADMIN' }) }));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: vi.fn() }),
}));

describe('AdminWalletsPanel', () => {
    it('renders wallet rows and triggers row click', () => {
        const rows = [
            {
                wallet_id: 'w1',
                shipowner_id: 'own-1',
                shipowner_name: 'Acme',
                balance_usd_minor: 500000,
                auto_apply_to_proforma: true,
                last_activity_at: '2026-05-10T00:00:00Z',
            },
        ];
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <AdminWalletsPanel rows={rows} />
            </NextIntlClientProvider>,
        );
        expect(screen.getByText('Acme')).toBeInTheDocument();
        expect(screen.getByText('Auto')).toBeInTheDocument();
    });
});
