'use client';

import { useCallback } from 'react';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { Transaction } from '@/types/secure';
import { getNextPendingTransaction } from '@/services/transactionService';

// Demo mock — a PENDING tx 6 days old so the armateur preview shows a realistic
// "24 days remaining" state. Set to null to demo the empty "Compte à jour" state.
const mockNextPending: Transaction | null = null;

/**
 * The armateur's next-upcoming payment. Returns the oldest PENDING transaction
 * (thus the one with the earliest pseudo-due-date of created_at + 30d). Null
 * when the armateur has no outstanding invoices — NextPaymentCard renders the
 * "Compte à jour" empty state in that case.
 */
export function useArmateurNextPayment(): DataSourceResult<Transaction | null> {
    const fetcher = useCallback(
        (client: Parameters<typeof getNextPendingTransaction>[0]) =>
            getNextPendingTransaction(client),
        [],
    );
    return useDataSource(mockNextPending, fetcher);
}
