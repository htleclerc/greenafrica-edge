'use client';

import { useCallback, useMemo } from 'react';
import { useRole } from '@/lib/RoleContext';
import { useDataSource, type DataSourceResult } from './useDataSource';
import { UserRole } from '@/types/secure';
import type { Transaction } from '@/types/secure';
import { mockTransactions, mockSecureVessels } from '@/mock/datas/secureMock';
import { getTransactions } from '@/services/transactionService';

export function useTransactions(): DataSourceResult<Transaction[]> {
    const { role, user } = useRole();

    // Demo-mode mock scoping. In real auth RLS handles this at the DB; in
    // demo mode we mirror the behaviour by resolving each tx's owning vessel
    // from mockSecureVessels and filtering by ownerId.
    const scopedMock = useMemo(() => {
        if (role !== UserRole.SHIPPING_AGENT) return mockTransactions;
        const ownedVesselIds = new Set(
            mockSecureVessels
                .filter((v) => v.ownerId === user.id)
                .map((v) => v.id),
        );
        return mockTransactions.filter((tx) => ownedVesselIds.has(tx.vesselId));
    }, [role, user.id]);

    const fetcher = useCallback(
        (client: Parameters<typeof getTransactions>[0]) => getTransactions(client),
        [],
    );
    return useDataSource(scopedMock, fetcher);
}
