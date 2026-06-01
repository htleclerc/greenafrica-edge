import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { PaymentReviewDrawer } from './PaymentReviewDrawer/PaymentReviewDrawer';
import enMessages from '../../../../../messages/en.json';

vi.mock('@/actions/confirmPayment', () => ({
    confirmPayment: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/actions/rejectPayment', () => ({
    rejectPayment: vi.fn().mockResolvedValue({ ok: true }),
}));

global.fetch = vi.fn();

function setup(onClose = () => {}) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
            payment: {
                id: 'pay-1', status: 'INITIATED', rail: 'CHEQUE',
                amount_minor: 50000, amount_usd_minor: 50000, currency: 'USD',
                shipowner_id: 's1', transaction_id: 't1', declared_by: 'a1',
                fx_rate: null, fx_rate_source: null, fx_rate_locked_at: null,
                rail_details: { cheque_number: 'C1' }, external_reference: null,
                rejected_reason: null, confirmed_by: null, confirmed_at: null,
                created_at: '2026-05-10T00:00:00Z', updated_at: '2026-05-10T00:00:00Z',
            },
            proofs: [],
        }),
    });
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <PaymentReviewDrawer paymentId="pay-1" onClose={onClose} />
        </NextIntlClientProvider>,
    );
}

describe('PaymentReviewDrawer', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    });

    it('confirm action calls confirmPayment and onClose', async () => {
        const onClose = vi.fn();
        setup(onClose);
        await waitFor(() => screen.getByText('CHEQUE'));
        fireEvent.click(screen.getByText('Confirm'));
        const { confirmPayment } = await import('@/actions/confirmPayment');
        await waitFor(() => {
            expect(confirmPayment).toHaveBeenCalledWith({ paymentId: 'pay-1' });
            expect(onClose).toHaveBeenCalled();
        });
    });

    it('reject without reason shows error; with reason calls rejectPayment', async () => {
        const onClose = vi.fn();
        setup(onClose);
        await waitFor(() => screen.getByText('CHEQUE'));
        fireEvent.click(screen.getByText('Reject'));
        // Now reason input is shown — submit with empty reason
        fireEvent.click(screen.getByText('Submit rejection'));
        expect(await screen.findByText(/Reason must be at least 3 characters/i)).toBeInTheDocument();

        // Type a reason and submit
        const reasonInput = screen.getByPlaceholderText(/explain why/i);
        fireEvent.change(reasonInput, { target: { value: 'duplicate' } });
        fireEvent.click(screen.getByText('Submit rejection'));

        const { rejectPayment } = await import('@/actions/rejectPayment');
        await waitFor(() => {
            expect(rejectPayment).toHaveBeenCalledWith({ paymentId: 'pay-1', reason: 'duplicate' });
            expect(onClose).toHaveBeenCalled();
        });
    });
});
