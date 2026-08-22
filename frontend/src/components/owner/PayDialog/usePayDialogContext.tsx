'use client';

import * as React from 'react';

export type Step = 'rail' | 'params' | 'confirm';
// L'ordre suit OWNER_RAILS de api/owner/payment-availability — les deux listes
// décrivent le même ensemble de rails ouverts à l'armateur.
export type Rail = 'STRIPE' | 'PAYPAL' | 'WIRE_TRANSFER' | 'MOBILE_MONEY' | 'THIRD_PARTY' | 'WALLET';
export type PayDialogMode = 'invoice' | 'topup';

export interface PayDialogState {
    step: Step;
    rail: Rail | null;
    railDetails: Record<string, unknown>;
    chosenProvider: string | null;
    submitting: boolean;
    error: string | null;
}

export interface PayDialogContextValue extends PayDialogState {
    mode: PayDialogMode;
    transactionId: string | null;
    invoiceRef: string | null;
    amountUsd: number;
    currency: string;
    walletBalanceUsdMinor: number;
    /**
     * Part de la facture reglee depuis le portefeuille, en cents USD. Zero =
     * paiement simple. Non nulle = paiement mixte : le rail choisi ne couvre
     * plus que `amountUsd - walletApplyUsdMinor / 100`.
     */
    walletApplyUsdMinor: number;
    setWalletApplyUsdMinor: (n: number) => void;
    setStep: (step: Step) => void;
    setRail: (rail: Rail | null) => void;
    setRailDetails: (d: Record<string, unknown>) => void;
    setChosenProvider: (p: string | null) => void;
    setSubmitting: (b: boolean) => void;
    setError: (e: string | null) => void;
    setAmountUsd: (n: number) => void;
    reset: () => void;
}

const Ctx = React.createContext<PayDialogContextValue | null>(null);

export function PayDialogProvider(
    props: React.PropsWithChildren<{
        mode?: PayDialogMode;
        transactionId: string | null;
        invoiceRef: string | null;
        amountUsd: number;
        currency: string;
        walletBalanceUsdMinor: number;
    }>,
) {
    const mode: PayDialogMode = props.mode ?? 'invoice';
    const [step, setStep] = React.useState<Step>('rail');
    const [rail, setRail] = React.useState<Rail | null>(null);
    const [railDetails, setRailDetails] = React.useState<Record<string, unknown>>({});
    const [chosenProvider, setChosenProvider] = React.useState<string | null>(null);
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [amountUsd, setAmountUsd] = React.useState<number>(props.amountUsd);
    const [walletApplyUsdMinor, setWalletApplyUsdMinor] = React.useState(0);

    // Keep amountUsd in sync if the parent updates the prop (e.g. invoice mode re-renders).
    React.useEffect(() => {
        setAmountUsd(props.amountUsd);
    }, [props.amountUsd]);

    const reset = React.useCallback(() => {
        setStep('rail');
        setWalletApplyUsdMinor(0);
        setRail(null);
        setRailDetails({});
        setChosenProvider(null);
        setSubmitting(false);
        setError(null);
    }, []);

    const value: PayDialogContextValue = {
        step, rail, railDetails, chosenProvider, submitting, error,
        mode,
        transactionId: props.transactionId,
        invoiceRef: props.invoiceRef,
        amountUsd,
        currency: props.currency,
        walletBalanceUsdMinor: props.walletBalanceUsdMinor,
        walletApplyUsdMinor,
        setWalletApplyUsdMinor,
        setStep, setRail, setRailDetails, setChosenProvider, setSubmitting, setError, setAmountUsd, reset,
    };

    return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function usePayDialog(): PayDialogContextValue {
    const v = React.useContext(Ctx);
    if (!v) throw new Error('usePayDialog must be used inside PayDialogProvider');
    return v;
}
