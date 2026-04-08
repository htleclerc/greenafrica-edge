'use client';

import { useCallback } from 'react';
import { useRole } from '@/lib/RoleContext';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { Dispute } from '@/types/secure';
import { UserRole, isShipRole } from '@/types/secure';
import { mockDisputes } from '@/mock/datas/secureMock';
import { getDisputes, getDisputesBySubmitter } from '@/services/disputeService';

export function useDisputes(): DataSourceResult<Dispute[]> {
    const { role, user } = useRole();

    const fetcher = useCallback(
        async (client: Parameters<typeof getDisputes>[0]) => {
            // SHIPPING_AGENT only sees own disputes
            if (isShipRole(role)) {
                return getDisputesBySubmitter(client, user.id);
            }
            return getDisputes(client);
        },
        [role, user.id],
    );

    return useDataSource(mockDisputes, fetcher, 'disputes');
}
