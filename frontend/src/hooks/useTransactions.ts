'use client';

import { useCallback } from 'react';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { Transaction } from '@/types/secure';
import { mockTransactions } from '@/mock/datas/secureMock';
import { getTransactions } from '@/services/transactionService';

export function useTransactions(): DataSourceResult<Transaction[]> {
    const fetcher = useCallback(
        (client: Parameters<typeof getTransactions>[0]) => getTransactions(client),
        [],
    );
    return useDataSource(mockTransactions, fetcher);
}
