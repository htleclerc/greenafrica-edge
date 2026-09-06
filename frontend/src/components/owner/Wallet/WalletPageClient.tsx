'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BalanceCard } from '@/components/owner/Wallet/BalanceCard';
import { PredictionCard } from '@/components/owner/Wallet/PredictionCard';
import { LedgerTable } from '@/components/owner/Wallet/LedgerTable';
import { PayDialog } from '@/components/owner/PayDialog';
import { toggleAutoApply } from '@/actions/toggleAutoApply';
import type { LedgerRow, LedgerKind, NextTaxPrediction } from '@/services/walletService';

interface Props {
    walletId: string;
    initialBalanceUsdMinor: number;
    initialAutoApply: boolean;
    initialLedger: LedgerRow[];
    prediction: NextTaxPrediction;
    /** Plan 7H-1 Task 5.3 — gates the "Top up" CTA + PayDialog topup mode. */
    topupEnabled?: boolean;
    /**
     * Droit de payer (mig 135). Approvisionner et basculer l'application
     * automatique sont deux gestes d'argent : ils tombent ensemble.
     */
    canPay: boolean;
    /** Vue staff « voir comme » : gestes visibles, désactivés. */
    readOnly?: boolean;
}

export function WalletPageClient({
    walletId,
    initialBalanceUsdMinor,
    initialAutoApply,
    initialLedger,
    prediction,
    topupEnabled = true,
    canPay,
    readOnly = false,
}: Props) {
    const router = useRouter();
    const tView = useTranslations('AdminOwnerView');
    const readOnlyHint = readOnly ? tView('actionHint') : undefined;
    const [autoApply, setAutoApply] = React.useState(initialAutoApply);
    const [togglePending, setTogglePending] = React.useState(false);
    const [topupOpen, setTopupOpen] = React.useState(false);
    const [ledgerFilters, setLedgerFilters] = React.useState<LedgerKind[]>([]);

    // Un membre sans le droit de payer garde la lecture du portefeuille et de
    // son registre ; seuls les deux gestes disparaissent.
    const canTopup = topupEnabled && canPay;

    const balanceUsd = initialBalanceUsdMinor / 100;

    // Dernier approvisionnement : la ligne de contexte de la carte de solde.
    // Le registre est déjà trié du plus récent au plus ancien côté service.
    const lastTopup = initialLedger.find((r) => r.kind === 'TOPUP') ?? null;

    // Filter ledger client-side for v1 (no server-side pagination)
    const visibleLedger = ledgerFilters.length === 0
        ? initialLedger
        : initialLedger.filter((r) => ledgerFilters.includes(r.kind));

    async function handleToggleAutoApply() {
        setTogglePending(true);
        try {
            await toggleAutoApply({ enabled: !autoApply });
            setAutoApply(!autoApply);
        } catch (e) {
            console.error(e);
            alert('Failed to toggle auto-apply. Please retry.');
        } finally {
            setTogglePending(false);
        }
    }

    return (
        <>
            <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
                <BalanceCard
                    balanceUsd={balanceUsd}
                    autoApplyEnabled={autoApply}
                    onToggleAutoApply={handleToggleAutoApply}
                    onOpenTopup={() => setTopupOpen(true)}
                    togglePending={togglePending}
                    topupEnabled={canTopup}
                    canToggleAutoApply={canPay && !readOnly}
                    readOnlyHint={readOnlyHint}
                    lastTopupAt={lastTopup?.created_at ?? null}
                    lastTopupUsd={lastTopup ? lastTopup.amount_signed_usd_minor / 100 : null}
                />
                <PredictionCard
                    prediction={prediction}
                    currentBalanceUsd={balanceUsd}
                    onOpenTopup={canTopup && !readOnly ? () => setTopupOpen(true) : undefined}
                />
            </div>
            <LedgerTable
                rows={visibleLedger}
                currentBalanceUsdMinor={initialBalanceUsdMinor}
                onFilterChange={setLedgerFilters}
                activeFilters={ledgerFilters}
            />
            {topupOpen && (
                <PayDialog
                    open={topupOpen}
                    onOpenChange={(o) => {
                        setTopupOpen(o);
                        if (!o) router.refresh();
                    }}
                    mode="topup"
                    transactionId={null}
                    invoiceRef={null}
                    amountUsd={0}
                    currency="USD"
                    walletBalanceUsdMinor={initialBalanceUsdMinor}
                    topupEnabled={canTopup}
                />
            )}
        </>
    );
}
