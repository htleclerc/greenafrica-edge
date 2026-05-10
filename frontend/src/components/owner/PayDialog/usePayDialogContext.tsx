'use client';

import * as React from 'react';

export type Step = 'rail' | 'params' | 'confirm';
export type Rail = 'WIRE_TRANSFER' | 'MOBILE_MONEY' | 'THIRD_PARTY' | 'WALLET';

export interface PayDialogState {
    step: Step;
    rail: Rail | null;
    railDetails: Record<string, unknown>;
    chosenProvider: string | null;
    submitting: boolean;
    error: string | null;
}

export interface PayDialogContextValue extends PayDialogState {
    transactionId: string;
    invoiceRef: string;
    amountUsd: number;
    currency: string;
    walletBalanceUsdMinor: number;
    setStep: (step: Step) => void;
    setRail: (rail: Rail | null) => void;
    setRailDetails: (d: Record<string, unknown>) => void;
    setChosenProvider: (p: string | null) => void;
    setSubmitting: (b: boolean) => void;
    setError: (e: string | null) => void;
    reset: () => void;
}

const Ctx = React.createContext<PayDialogContextValue | null>(null);

export function PayDialogProvider(
    props: React.PropsWithChildren<{
        transactionId: string;
        invoiceRef: string;
        amountUsd: number;
        currency: string;
        walletBalanceUsdMinor: number;
    }>,
) {
    const [step, setStep] = React.useState<Step>('rail');
    const [rail, setRail] = React.useState<Rail | null>(null);
    const [railDetails, setRailDetails] = React.useState<Record<string, unknown>>({});
    const [chosenProvider, setChosenProvider] = React.useState<string | null>(null);
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const reset = React.useCallback(() => {
        setStep('rail');
        setRail(null);
        setRailDetails({});
        setChosenProvider(null);
        setSubmitting(false);
        setError(null);
    }, []);

    const value: PayDialogContextValue = {
        step, rail, railDetails, chosenProvider, submitting, error,
        transactionId: props.transactionId,
        invoiceRef: props.invoiceRef,
        amountUsd: props.amountUsd,
        currency: props.currency,
        walletBalanceUsdMinor: props.walletBalanceUsdMinor,
        setStep, setRail, setRailDetails, setChosenProvider, setSubmitting, setError, reset,
    };

    return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function usePayDialog(): PayDialogContextValue {
    const v = React.useContext(Ctx);
    if (!v) throw new Error('usePayDialog must be used inside PayDialogProvider');
    return v;
}
