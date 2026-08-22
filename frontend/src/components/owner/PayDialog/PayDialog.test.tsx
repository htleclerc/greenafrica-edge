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

function submitButton(): HTMLButtonElement {
    return screen.getByText(/Submit payment/i).closest('button') as HTMLButtonElement;
}

/** Retient un justificatif dans le selecteur de l'etape de soumission. */
function attachProof(name = 'proof.pdf') {
    const input = screen.getByTestId('proof-input') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], name, { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    return file;
}

describe('PayDialog', () => {
    beforeEach(() => {
        // `initiatePayment` est un mock de module : sans purge, ses appels
        // s'accumulent d'un test a l'autre et « n'a pas ete appele » ne veut
        // plus rien dire.
        vi.clearAllMocks();
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    });

    /** Amene le dialogue a l'etape de soumission d'un virement. */
    async function reachWireConfirmStep() {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                rails: [{ rail: 'WIRE_TRANSFER', eligible: true, providers: [{ provider: 'wire_transfer', routes_rail: ['WIRE_TRANSFER'], display_order: 5 }] }],
            }),
        });
        setup();
        await waitFor(() => screen.getByText(/Bank wire/i));
        fireEvent.click(screen.getByText(/Bank wire/i).closest('button')!);
        fireEvent.click(await screen.findByText('Next'));
        await waitFor(() => screen.getByText(/Submit payment/i));
    }

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

        // Step 3 — la piece est exigee avant de pouvoir soumettre.
        await waitFor(() => screen.getByText(/Submit payment/i));
        attachProof();
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
        await waitFor(() => expect(submitButton()).not.toBeDisabled());
        fireEvent.click(screen.getByText(/Submit payment/i));

        const { initiatePayment } = await import('@/actions/initiatePayment');
        await waitFor(() => expect(initiatePayment).toHaveBeenCalledWith(expect.objectContaining({
            transactionId: 'tx-1',
            rail: 'WIRE_TRANSFER',
            currency: 'USD',
            railDetails: expect.objectContaining({ bank_reference: 'SWIFT-12345' }),
        })));
    });

    // ── Justificatif exige a la soumission ──────────────────────────────────
    // Un versement declare sans piece n'est pas rapprochable : le service
    // financier ne peut ni le confirmer ni le refuser, et la facture reste
    // ouverte pendant que l'armateur la croit reglee. La piece etait jusqu'ici
    // proposee APRES la creation du paiement, et facultative.

    it('refuse de soumettre un virement sans justificatif', async () => {
        await reachWireConfirmStep();

        expect(submitButton()).toBeDisabled();
        fireEvent.click(screen.getByText(/Submit payment/i));

        const { initiatePayment } = await import('@/actions/initiatePayment');
        expect(initiatePayment).not.toHaveBeenCalled();
    });

    it('televerse la piece retenue juste apres la creation du paiement', async () => {
        await reachWireConfirmStep();
        attachProof('mt103.pdf');
        await waitFor(() => expect(screen.getByText('mt103.pdf')).toBeInTheDocument());

        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
        fireEvent.click(screen.getByText(/Submit payment/i));

        // L'ordre est impose par l'API : le televersement vise un paiement
        // existant, il ne peut pas preceder sa creation.
        await waitFor(() => {
            const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
            const post = calls.find(([url, init]) =>
                String(url) === '/api/owner/payments/pay-1/proofs' && init?.method === 'POST');
            expect(post).toBeTruthy();
            expect((post![1] as { body: FormData }).body.get('file')).toBeInstanceOf(File);
        });
    });

    it('garde le dialogue ouvert si la piece ne monte pas, sans perdre le paiement', async () => {
        await reachWireConfirmStep();
        attachProof();

        // Le paiement est deja cree cote serveur : l'annuler serait pire que de
        // le laisser sans piece. L'armateur doit pouvoir reessayer.
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: false, json: async () => ({ error: 'storage down' }),
        });
        fireEvent.click(screen.getByText(/Submit payment/i));

        expect(await screen.findByText(/could not be uploaded/i)).toBeInTheDocument();
        expect(screen.getByTestId('proof-input')).toBeInTheDocument();
    });

    it('n exige aucune piece sur un rail ou la plateforme constate l encaissement', async () => {
        // STRIPE : le webhook constate le paiement, la preuve est cote systeme.
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                rails: [{ rail: 'STRIPE', eligible: true, providers: [{ provider: 'stripe', routes_rail: ['STRIPE'], display_order: 0 }] }],
            }),
        });
        setup();
        await waitFor(() => screen.getByText(/Pay by card/i));
        fireEvent.click(screen.getByText(/Pay by card/i).closest('button')!);
        fireEvent.click(screen.getByText('Next'));

        await waitFor(() => screen.getByText(/Submit payment/i));
        expect(submitButton()).not.toBeDisabled();
        expect(screen.queryByTestId('proof-input')).not.toBeInTheDocument();
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
                // Le RIB vient desormais du serveur avec les rails.
                wire: {
                    beneficiary: 'Solide Technology Limited',
                    bank: 'SYSTEM PAY SERVICES (MALTA) LIMITED',
                    bankAddress: 'Ruby Workspaces, St Julians, Malta',
                    swiftCode: 'SYPLMTM2XXX',
                    iban: 'MT12SYPL39480821090981701607644',
                    depositReference: null,
                },
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
