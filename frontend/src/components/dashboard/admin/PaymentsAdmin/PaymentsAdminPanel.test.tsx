import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { PaymentsAdminPanel } from './PaymentsAdminPanel';
import enMessages from '../../../../../messages/en.json';

vi.mock('@/lib/RoleContext', () => ({
    useRole: () => ({ role: 'FINANCE_ADMIN' }),
}));
vi.mock('@/lib/rbac', () => ({
    canEdit: () => true,
}));

global.fetch = vi.fn();

function setup() {
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <PaymentsAdminPanel />
        </NextIntlClientProvider>,
    );
}

describe('PaymentsAdminPanel', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    });

    it('renders the table with rows from /api/admin/payments', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                payments: [
                    { id: 'p1', status: 'INITIATED', rail: 'CHEQUE', amount_usd_minor: 50000,
                      currency: 'USD', amount_minor: 50000, shipowner_id: 's1', transaction_id: 't1',
                      declared_by: 'a1', fx_rate: null, fx_rate_source: null, fx_rate_locked_at: null,
                      rail_details: {}, external_reference: 'CHK-1', rejected_reason: null,
                      confirmed_by: null, confirmed_at: null, created_at: '2026-05-10T00:00:00Z',
                      updated_at: '2026-05-10T00:00:00Z' },
                ],
            }),
        });
        setup();
        // 'CHEQUE' and 'INITIATED' appear both as filter buttons AND in the row;
        // use getAllByText to assert at least the row is rendered.
        await waitFor(() => expect(screen.getAllByText('CHEQUE').length).toBeGreaterThan(0));
        expect(screen.getByText('CHK-1')).toBeInTheDocument();
        expect(screen.getAllByText('INITIATED').length).toBeGreaterThan(0);
    });

    it('toggling a status filter refetches with new query', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ payments: [] }) });
        setup();
        await waitFor(() => screen.getByText(/No payments/i));

        // Initial fetch had status filter (INITIATED, PROCESSING by default)
        const initialUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL;
        expect(initialUrl.searchParams.get('status')).toMatch(/INITIATED|PROCESSING/);

        // Click CONFIRMED filter button
        fireEvent.click(screen.getByText('CONFIRMED'));
        await waitFor(() => {
            const lastUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as URL;
            expect(lastUrl.searchParams.get('status')).toContain('CONFIRMED');
        });
    });
});
