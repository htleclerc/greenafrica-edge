import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { CashDeskForm } from './CashDeskForm';
import enMessages from '../../../../../messages/en.json';

vi.mock('@/actions/recordManualPayment', () => ({
    recordManualPayment: vi.fn().mockResolvedValue({ id: 'pay-cash-1', status: 'INITIATED' }),
}));

global.fetch = vi.fn();

function setup() {
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <CashDeskForm />
        </NextIntlClientProvider>,
    );
}

describe('CashDeskForm', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
        (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: URL | string) => {
            const u = typeof url === 'string' ? new URL(url, 'http://x') : url;
            if (u.pathname.endsWith('/api/admin/shipowners/search')) {
                return { ok: true, json: async () => ({ shipowners: [{ id: 'own-1', name: 'Acme Cash Co' }] }) };
            }
            if (u.pathname.match(/\/open-transactions$/)) {
                return { ok: true, json: async () => ({ transactions: [] }) };
            }
            return { ok: true, json: async () => ({}) };
        });
    });

    it('auto-generates a CASH-YYYY-MM-DD-NNN receipt number on mount', () => {
        setup();
        const input = screen.getByDisplayValue(/CASH-\d{4}-\d{2}-\d{2}-\d{3}/) as HTMLInputElement;
        expect(input).toBeInTheDocument();
    });

    it('blocks submit when no shipowner is selected', async () => {
        setup();
        const amount = screen.getByPlaceholderText('0.00');
        fireEvent.change(amount, { target: { value: '50.00' } });
        fireEvent.click(screen.getByText('Record cash payment'));
        expect(await screen.findByText(/Pick a shipowner/i)).toBeInTheDocument();
    });

    it('happy path: pick shipowner → fill amount → submit calls recordManualPayment with rail=CASH', async () => {
        setup();
        const search = screen.getByPlaceholderText('Search by name…');
        fireEvent.change(search, { target: { value: 'Acme' } });
        await waitFor(() => screen.getByText('Acme Cash Co'));
        fireEvent.click(screen.getByText('Acme Cash Co'));

        const amount = screen.getByPlaceholderText('0.00');
        fireEvent.change(amount, { target: { value: '125.50' } });

        fireEvent.click(screen.getByText('Record cash payment'));

        const { recordManualPayment } = await import('@/actions/recordManualPayment');
        await waitFor(() => expect(recordManualPayment).toHaveBeenCalledWith(expect.objectContaining({
            shipownerId: 'own-1',
            rail: 'CASH',
            amount: '125.50',
            currency: 'USD',
            confirmImmediately: false,
        })));
        expect(await screen.findByText(/Cash payment recorded/i)).toBeInTheDocument();
    });
});
