'use client';

import { useCallback } from 'react';
import { useRole } from '@/lib/RoleContext';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { SecureVessel } from '@/types/secure';
import { mockSecureVessels } from '@/mock/datas/secureMock';
import { getVessels, getVesselsByOwner } from '@/services/vesselService';
import { UserRole } from '@/types/secure';

export function useVessels(): DataSourceResult<SecureVessel[]> {
    const { role, user } = useRole();

    const fetcher = useCallback(
        async (client: Parameters<typeof getVessels>[0]) => {
            // SHIPPING_AGENT only sees own fleet
            if (role === UserRole.SHIPPING_AGENT) {
                return getVesselsByOwner(client, user.id);
            }
            return getVessels(client);
        },
        [role, user.id],
    );

    return useDataSource(mockSecureVessels, fetcher, 'vessels', 30_000);
}
