'use client';

import * as React from 'react';

export type AdminRail = 'CASH' | 'CHEQUE' | 'LETTER_OF_CREDIT' | 'NETTING' | 'THIRD_PARTY' | 'BANK_GUARANTEE';
export type Step = 'who' | 'params' | 'confirm';

export interface ShipownerOption { id: string; name: string; }
export interface TransactionOption { id: string; invoice_ref: string | null; tax_amount_usd: number; }

export interface RecordPaymentState {
    step: Step;
    rail: AdminRail | null;
    shipowner: ShipownerOption | null;
    transaction: TransactionOption | null;
    amount: string;       // decimal string e.g. "1234.56"
    currency: string;     // default USD
    railDetails: Record<string, unknown>;
    proofs: File[];
    confirmImmediately: boolean;
    submitting: boolean;
    error: string | null;
}

export interface RecordPaymentContextValue extends RecordPaymentState {
    setStep: (s: Step) => void;
    setRail: (r: AdminRail | null) => void;
    setShipowner: (s: ShipownerOption | null) => void;
    setTransaction: (t: TransactionOption | null) => void;
    setAmount: (a: string) => void;
    setCurrency: (c: string) => void;
    setRailDetails: (d: Record<string, unknown>) => void;
    setProofs: (p: File[]) => void;
    setConfirmImmediately: (b: boolean) => void;
    setSubmitting: (b: boolean) => void;
    setError: (e: string | null) => void;
    reset: () => void;
}

const Ctx = React.createContext<RecordPaymentContextValue | null>(null);

export function RecordPaymentProvider({ children }: { children: React.ReactNode }) {
    const [step, setStep] = React.useState<Step>('who');
    const [rail, setRail] = React.useState<AdminRail | null>(null);
    const [shipowner, setShipowner] = React.useState<ShipownerOption | null>(null);
    const [transaction, setTransaction] = React.useState<TransactionOption | null>(null);
    const [amount, setAmount] = React.useState('');
    const [currency, setCurrency] = React.useState('USD');
    const [railDetails, setRailDetails] = React.useState<Record<string, unknown>>({});
    const [proofs, setProofs] = React.useState<File[]>([]);
    const [confirmImmediately, setConfirmImmediately] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const reset = React.useCallback(() => {
        setStep('who');
        setRail(null);
        setShipowner(null);
        setTransaction(null);
        setAmount('');
        setCurrency('USD');
        setRailDetails({});
        setProofs([]);
        setConfirmImmediately(false);
        setSubmitting(false);
        setError(null);
    }, []);

    const value: RecordPaymentContextValue = {
        step, rail, shipowner, transaction, amount, currency, railDetails, proofs, confirmImmediately, submitting, error,
        setStep, setRail, setShipowner, setTransaction, setAmount, setCurrency,
        setRailDetails, setProofs, setConfirmImmediately, setSubmitting, setError, reset,
    };

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecordPayment(): RecordPaymentContextValue {
    const v = React.useContext(Ctx);
    if (!v) throw new Error('useRecordPayment must be used inside RecordPaymentProvider');
    return v;
}
