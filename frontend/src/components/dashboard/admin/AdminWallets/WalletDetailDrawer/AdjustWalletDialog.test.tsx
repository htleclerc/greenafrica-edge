import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { AdjustWalletDialog } from './AdjustWalletDialog';
import en from '../../../../../../messages/en.json';

vi.mock('@/actions/adjustWalletManually', () => ({
    adjustWalletManually: vi.fn().mockResolvedValue(undefined),
}));

describe('AdjustWalletDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('blocks submit without justification ≥5 chars', async () => {
        const onClose = vi.fn();
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <AdjustWalletDialog
                    walletId="w1"
                    shipownerName="Acme"
                    currentBalanceUsdMinor={100000}
                    onClose={onClose}
                />
            </NextIntlClientProvider>,
        );
        const amount = screen.getByPlaceholderText('100.00');
        fireEvent.change(amount, { target: { value: '50.00' } });
        fireEvent.click(screen.getByText('Post adjustment'));
        expect(
            await screen.findByText(/Justification must be at least 5 characters/i),
        ).toBeInTheDocument();
    });

    it('happy path: calls adjustWalletManually with signed amount', async () => {
        const onClose = vi.fn();
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <AdjustWalletDialog
                    walletId="w1"
                    shipownerName="Acme"
                    currentBalanceUsdMinor={100000}
                    onClose={onClose}
                />
            </NextIntlClientProvider>,
        );
        const amount = screen.getByPlaceholderText('100.00');
        fireEvent.change(amount, { target: { value: '50.00' } });
        const justification = screen.getByPlaceholderText(/Goodwill credit/);
        fireEvent.change(justification, { target: { value: 'Compensation for ops error' } });
        fireEvent.click(screen.getByText('Post adjustment'));

        const { adjustWalletManually } = await import('@/actions/adjustWalletManually');
        await waitFor(() => {
            expect(adjustWalletManually).toHaveBeenCalledWith(
                expect.objectContaining({
                    walletId: 'w1',
                    amountSignedMinor: 5000,
                    justification: 'Compensation for ops error',
                }),
            );
        });
    });
});
