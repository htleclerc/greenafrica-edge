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

    // Le virement n'est plus une action « en direct » : l'armateur y lit les
    // coordonnees du compte a crediter, la reference bancaire n'existe pas
    // encore a cet instant et ne peut donc pas bloquer l'etape.
    it('shows the beneficiary account for WIRE_TRANSFER and advances without a bank reference', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                rails: [{ rail: 'WIRE_TRANSFER', eligible: true, providers: [{ provider: 'wire_transfer', routes_rail: ['WIRE_TRANSFER'], display_order: 5 }] }],
            }),
        });
        setup();
        await waitFor(() => screen.getByText(/Bank wire/i));
        fireEvent.click(screen.getByText(/Bank wire/i).closest('button')!);

        // Coordonnees bancaires + reference a porter sur le virement.
        expect(await screen.findByText('MT12SYPL39480821090981701607644')).toBeInTheDocument();
        expect(screen.getByText('SYPLMTM2XXX')).toBeInTheDocument();
        expect(screen.getByText('INV-001')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Next'));
        expect(await screen.findByText(/Submit payment/i)).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rail PAYPAL — jumeau de STRIPE cote UI : aucun parametre a saisir, puis
// redirection vers la checkoutUrl renvoyee par initiatePayment.
// ─────────────────────────────────────────────────────────────────────────────

describe('PayDialog — rail PAYPAL', () => {
    const PAYPAL_ELIGIBLE = {
        rail: 'PAYPAL',
        eligible: true,
        providers: [{ provider: 'paypal', routes_rail: ['PAYPAL'], display_order: 0 }],
    };

    function mockAvailability(rails: unknown[]) {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ rails }),
        });
    }

    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    });

    it('affiche PayPal dans le picker quand le rail est eligible', async () => {
        mockAvailability([PAYPAL_ELIGIBLE]);
        setup();
        const label = await screen.findByText(/Pay with PayPal/i);
        expect(label.closest('button')).not.toBeDisabled();
    });

    it('affiche PayPal desactive quand il est ineligible', async () => {
        mockAvailability([
            { rail: 'PAYPAL', eligible: false, providers: [], reason: 'no_active_provider' },
        ]);
        setup();
        const label = await screen.findByText(/Pay with PayPal/i);
        expect(label.closest('button')).toBeDisabled();
    });

    it('ne demande aucun parametre de rail pour PayPal', async () => {
        mockAvailability([PAYPAL_ELIGIBLE]);
        setup();
        fireEvent.click((await screen.findByText(/Pay with PayPal/i)).closest('button')!);
        // Etape 2 : uniquement le hint, aucun champ obligatoire.
        expect(await screen.findByText(/redirected to PayPal/i)).toBeInTheDocument();
        expect(screen.queryByPlaceholderText('SWIFT-MT103-…')).not.toBeInTheDocument();
    });

    it('redirige vers l URL de checkout PayPal a la confirmation', async () => {
        mockAvailability([PAYPAL_ELIGIBLE]);
        const { initiatePayment } = await import('@/actions/initiatePayment');
        (initiatePayment as ReturnType<typeof vi.fn>).mockResolvedValue({
            id: 'pay-1',
            status: 'PROCESSING',
            transaction_id: 'tx-1',
            amount_usd_minor: 100000,
            checkoutUrl: 'https://paypal.com/approve/ORDER-1',
        });

        const assign = vi.fn();
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...originalLocation,
                get href() { return ''; },
                set href(v: string) { assign(v); },
            },
        });

        try {
            setup();
            fireEvent.click((await screen.findByText(/Pay with PayPal/i)).closest('button')!);
            fireEvent.click(await screen.findByText('Next'));
            fireEvent.click(await screen.findByText(/Submit payment/i));

            await waitFor(() => expect(initiatePayment).toHaveBeenCalledWith(
                expect.objectContaining({ rail: 'PAYPAL', currency: 'USD' }),
            ));
            await waitFor(() => expect(assign).toHaveBeenCalledWith('https://paypal.com/approve/ORDER-1'));
        } finally {
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: originalLocation,
            });
        }
    });
});
