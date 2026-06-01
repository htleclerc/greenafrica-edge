import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { PayDialog } from './PayDialog';
import enMessages from '../../../../messages/en.json';

vi.mock('@/actions/initiatePayment', () => ({
    initiatePayment: vi.fn().mockResolvedValue({ id: 'pay-1', status: 'INITIATED' }),
}));
vi.mock('@/actions/applyWallet', () => ({
    applyWallet: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: vi.fn() }),
}));

global.fetch = vi.fn();

function setup(props: Partial<React.ComponentProps<typeof PayDialog>> = {}) {
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <PayDialog
                open={true}
                onOpenChange={() => {}}
                transactionId="tx-1"
                invoiceRef="INV-001"
                amountUsd={1000}
                currency="USD"
                walletBalanceUsdMinor={0}
                {...props}
            />
        </NextIntlClientProvider>,
    );
}

describe('PayDialog', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    });

    it('Step 1 renders rail cards from availability API', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                rails: [
                    { rail: 'WIRE_TRANSFER', eligible: true, providers: [{ provider: 'wire_transfer', routes_rail: ['WIRE_TRANSFER'], display_order: 5 }] },
                    { rail: 'MOBILE_MONEY',  eligible: false, providers: [], reason: 'no_active_provider' },
                    { rail: 'THIRD_PARTY',   eligible: false, providers: [], reason: 'no_active_provider' },
                    { rail: 'WALLET',        eligible: false, providers: [], reason: 'wallet_empty' },
                ],
            }),
        });
        setup();
        await waitFor(() => expect(screen.getByText(/Bank wire/i)).toBeInTheDocument());
        const wireBtn = screen.getByText(/Bank wire/i).closest('button');
        const momoBtn = screen.getByText(/Mobile money/i).closest('button');
        expect(wireBtn).not.toBeDisabled();
        expect(momoBtn).toBeDisabled();
    });

    it('progresses through Step 2 and Step 3 for WIRE_TRANSFER, calls initiatePayment', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                rails: [{ rail: 'WIRE_TRANSFER', eligible: true, providers: [{ provider: 'wire_transfer', routes_rail: ['WIRE_TRANSFER'], display_order: 5 }] }],
            }),
        });
        setup();
        await waitFor(() => screen.getByText(/Bank wire/i));

        fireEvent.click(screen.getByText(/Bank wire/i).closest('button')!);
        // Step 2
        const refInput = await screen.findByPlaceholderText('SWIFT-MT103-…');
        fireEvent.change(refInput, { target: { value: 'SWIFT-12345' } });
        fireEvent.click(screen.getByText('Next'));

        // Step 3
        await waitFor(() => screen.getByText(/Submit payment/i));
        fireEvent.click(screen.getByText(/Submit payment/i));

        const { initiatePayment } = await import('@/actions/initiatePayment');
        await waitFor(() => expect(initiatePayment).toHaveBeenCalledWith(expect.objectContaining({
            transactionId: 'tx-1',
            rail: 'WIRE_TRANSFER',
            currency: 'USD',
            railDetails: expect.objectContaining({ bank_reference: 'SWIFT-12345' }),
        })));
    });

    it('renders disabled message when mode=topup and topupEnabled=false (Plan 7H-1 Task 5.3)', async () => {
        setup({ mode: 'topup', topupEnabled: false, transactionId: null, invoiceRef: null, amountUsd: 0 });
        expect(await screen.findByText(/Wallet top-ups unavailable/i)).toBeInTheDocument();
        // Wizard should NOT have rendered any rail card.
        expect(screen.queryByText(/Bank wire/i)).not.toBeInTheDocument();
    });

    it('blocks Step 2 → 3 if WIRE_TRANSFER bank reference missing', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                rails: [{ rail: 'WIRE_TRANSFER', eligible: true, providers: [{ provider: 'wire_transfer', routes_rail: ['WIRE_TRANSFER'], display_order: 5 }] }],
            }),
        });
        setup();
        await waitFor(() => screen.getByText(/Bank wire/i));
        fireEvent.click(screen.getByText(/Bank wire/i).closest('button')!);
        fireEvent.click(screen.getByText('Next'));
        expect(await screen.findByText(/Bank reference is required/)).toBeInTheDocument();
    });
});
