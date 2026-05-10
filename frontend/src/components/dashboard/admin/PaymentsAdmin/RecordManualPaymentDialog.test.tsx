import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { RecordManualPaymentDialog } from './RecordManualPaymentDialog';
import enMessages from '../../../../../messages/en.json';

vi.mock('@/actions/recordManualPayment', () => ({
    recordManualPayment: vi.fn().mockResolvedValue({ id: 'pay-new', status: 'INITIATED' }),
}));

global.fetch = vi.fn();

function setup() {
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <RecordManualPaymentDialog open={true} onOpenChange={() => {}} />
        </NextIntlClientProvider>,
    );
}

describe('RecordManualPaymentDialog', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
        (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: URL | string) => {
            const u = typeof url === 'string' ? new URL(url, 'http://x') : url;
            if (u.pathname.endsWith('/api/admin/shipowners/search')) {
                return { ok: true, json: async () => ({ shipowners: [{ id: 'own-1', name: 'Acme Shipping' }] }) };
            }
            if (u.pathname.match(/\/open-transactions$/)) {
                return { ok: true, json: async () => ({ transactions: [] }) };
            }
            return { ok: true, json: async () => ({}) };
        });
    });

    it('disables Confirm Immediately checkbox when CASH is selected', async () => {
        setup();
        // Step 1: pick CASH + a shipowner
        fireEvent.click(screen.getByText('CASH'));
        const input = screen.getByPlaceholderText('Search by name…');
        fireEvent.change(input, { target: { value: 'Acme' } });
        await waitFor(() => screen.getByText('Acme Shipping'));
        fireEvent.click(screen.getByText('Acme Shipping'));
        fireEvent.click(screen.getByText('Next'));

        // Step 2: amount + receipt + cashier
        const amountInput = screen.getAllByPlaceholderText('0.00')[0];
        fireEvent.change(amountInput, { target: { value: '100.00' } });
        const inputs = screen.getAllByDisplayValue('');
        // Receipt number + cashier are the 2 required text inputs in CASH branch.
        // We brute-force fill all empty inputs to satisfy the validator.
        for (const el of inputs) {
            if (el.tagName !== 'INPUT') continue;
            const type = el.getAttribute('type');
            if (type === 'date' || type === 'file') continue;
            fireEvent.change(el, { target: { value: 'X' } });
        }
        fireEvent.click(screen.getByText('Next'));

        // Step 3: 4-eyes warning shown (text appears in both dialog subtitle
        // AND step 3 warning); use getAllByText.
        await waitFor(() => expect(screen.getAllByText(/4-eyes/).length).toBeGreaterThan(1));
        const checkbox = screen.getByLabelText(/Confirm immediately/) as HTMLInputElement;
        expect(checkbox.disabled).toBe(true);
    });
});
