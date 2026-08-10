import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const generateReceiptMock = vi.fn();
const sendConfirmationMock = vi.fn();
const notifyOwnerMock = vi.fn();

vi.mock('@/services/receiptService', () => ({
    generatePaymentReceipt: (...a: unknown[]) => generateReceiptMock(...a),
}));
vi.mock('@/services/emailService', () => ({
    sendPaymentConfirmationEmail: (...a: unknown[]) => sendConfirmationMock(...a),
}));
vi.mock('@/services/notificationService', () => ({
    notifyOwner: (...a: unknown[]) => notifyOwnerMock(...a),
}));

import { applyPaymentConfirmationEffects } from './paymentConfirmationEffects';

// Faux client Supabase : renvoie shipowner / transaction / wallet scriptables.
let ownerRow: Record<string, unknown> | null;
let txRow: Record<string, unknown> | null;
let walletRow: Record<string, unknown> | null;

function fakeAdmin(): SupabaseClient {
    const wrap = (row: Record<string, unknown> | null) => ({
        data: row,
        error: row ? null : { message: 'not found' },
    });
    return {
        from: (table: string) => ({
            select: () => ({
                eq: () => ({
                    single: async () =>
                        wrap(
                            table === 'shipowners'
                                ? ownerRow
                                : table === 'transactions'
                                  ? txRow
                                  : null,
                        ),
                    maybeSingle: async () => wrap(table === 'wallets' ? walletRow : null),
                }),
            }),
        }),
    } as unknown as SupabaseClient;
}

const CONFIRMED_AT = '2026-07-30T10:00:00.000Z';

beforeEach(() => {
    generateReceiptMock.mockReset();
    sendConfirmationMock.mockReset();
    notifyOwnerMock.mockReset();
    generateReceiptMock.mockResolvedValue({
        receiptRef: 'RCPT-1',
        pdfBuffer: new Uint8Array([1, 2, 3]),
    });
    sendConfirmationMock.mockResolvedValue(undefined);
    notifyOwnerMock.mockResolvedValue(undefined);
    ownerRow = { name: 'Demo Shipping', official_email: 'owner@example.com' };
    txRow = { invoice_ref: 'INV-2026-abc', vessel_name: 'MV Test' };
    walletRow = { balance_usd_minor: 500000 };
});

const INVOICE_PAYMENT = {
    id: 'pay-1',
    shipowner_id: 'so-1',
    transaction_id: 'tx-1',
    amount_usd_minor: 125000,
};
const TOPUP_PAYMENT = {
    id: 'pay-2',
    shipowner_id: 'so-1',
    transaction_id: null,
    amount_usd_minor: 50000,
};

describe('applyPaymentConfirmationEffects — paiement de facture', () => {
    it('genere le recu, envoie l e-mail de confirmation, notifie PAYMENT_RECEIVED', async () => {
        await applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT);

        expect(generateReceiptMock).toHaveBeenCalledOnce();
        expect(generateReceiptMock.mock.calls[0][1]).toBe('pay-1');

        expect(sendConfirmationMock).toHaveBeenCalledOnce();
        const email = sendConfirmationMock.mock.calls[0][0];
        expect(email.to).toBe('owner@example.com');
        expect(email.recipientName).toBe('Demo Shipping');
        expect(email.invoiceRef).toBe('INV-2026-abc');
        expect(email.vesselName).toBe('MV Test');
        expect(email.amountUsd).toBe(1250);
        expect(email.receiptRef).toBe('RCPT-1');

        expect(notifyOwnerMock).toHaveBeenCalledOnce();
        const notif = notifyOwnerMock.mock.calls[0][1];
        expect(notif.kind).toBe('PAYMENT_RECEIVED');
        expect(notif.skipEmail).toBe(true); // l'e-mail est deja parti ci-dessus
        expect(notif.attachments.filename).toBe('RCPT-1.pdf');
        expect(notif.deepLink).toContain('INV-2026-abc');
        expect(notif.params.paid_at).toBe(CONFIRMED_AT);
    });

    it('derive paidAt du confirmedAt fourni, pas de l heure courante', async () => {
        await applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT);
        const email = sendConfirmationMock.mock.calls[0][0];
        // Formatage en-US de 2026-07-30 — on verifie l annee pour rester
        // independant du fuseau de la machine de test.
        expect(email.paidAt).toContain('2026');
    });

    it('n envoie pas d e-mail si l armateur n a pas d adresse officielle', async () => {
        ownerRow = { name: 'Demo Shipping', official_email: null };
        await applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT);
        expect(sendConfirmationMock).not.toHaveBeenCalled();
        expect(notifyOwnerMock).toHaveBeenCalledOnce(); // la notif in-app part quand meme
    });

    it('tolere une transaction introuvable', async () => {
        txRow = null;
        await applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT);
        const notif = notifyOwnerMock.mock.calls[0][1];
        expect(notif.params.invoice_ref).toBe('—');
        expect(notif.params.vessel_name).toBe('—');
    });
});

describe('applyPaymentConfirmationEffects — top-up wallet', () => {
    it('notifie WALLET_TOPPED_UP avec le nouveau solde et ne force pas skipEmail', async () => {
        await applyPaymentConfirmationEffects(fakeAdmin(), TOPUP_PAYMENT, CONFIRMED_AT);

        const notif = notifyOwnerMock.mock.calls[0][1];
        expect(notif.kind).toBe('WALLET_TOPPED_UP');
        expect(notif.params.amount_usd).toBe(500);
        expect(notif.params.new_balance_usd).toBe(5000);
        expect(notif.deepLink).toBe('/owner/wallet');
        expect(notif.skipEmail).toBeUndefined();
    });

    it('tolere un wallet inexistant (solde 0)', async () => {
        walletRow = null;
        await applyPaymentConfirmationEffects(fakeAdmin(), TOPUP_PAYMENT, CONFIRMED_AT);
        expect(notifyOwnerMock.mock.calls[0][1].params.new_balance_usd).toBe(0);
    });
});

describe('applyPaymentConfirmationEffects — fail-soft', () => {
    it('ne throw pas si la generation du recu echoue, et notifie quand meme', async () => {
        generateReceiptMock.mockRejectedValue(new Error('pdf boom'));
        await expect(
            applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT),
        ).resolves.toBeUndefined();
        expect(notifyOwnerMock).toHaveBeenCalledOnce();
        // Sans recu, aucune piece jointe n est promise a notifyOwner.
        expect(notifyOwnerMock.mock.calls[0][1].attachments).toBeUndefined();
    });

    it('ne throw pas si l e-mail echoue', async () => {
        sendConfirmationMock.mockRejectedValue(new Error('resend boom'));
        await expect(
            applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT),
        ).resolves.toBeUndefined();
        expect(notifyOwnerMock).toHaveBeenCalledOnce();
    });

    it('ne throw pas si la notification echoue', async () => {
        notifyOwnerMock.mockRejectedValue(new Error('notify boom'));
        await expect(
            applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT),
        ).resolves.toBeUndefined();
    });
});
