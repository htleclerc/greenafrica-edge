'use client';

import { useCallback } from 'react';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { Transaction } from '@/types/secure';
import { mockTransactions } from '@/mock/datas/secureMock';
import { TransactionStatus } from '@/types/secure';
import { getNextPendingTransaction } from '@/services/transactionService';

// Demo mock — resolves to the oldest PENDING tx in the mock fixture for
// the demo armateur's fleet (txn-006, MSC BERBERA, created 6d ago so the
// NextPaymentCard reads ~24 days remaining). Returns null if someone
// removes the PENDING fixture, naturally reverting to the empty state.
const mockNextPending: Transaction | null =
    mockTransactions
        .filter((tx) => tx.status === TransactionStatus.PENDING)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0]
    ?? null;

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
