'use client';

import { useCallback, useMemo } from 'react';
import { useRole } from '@/lib/RoleContext';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { SecureVessel } from '@/types/secure';
import { mockSecureVessels } from '@/mock/datas/secureMock';
import { getVessels, getVesselsByOwner } from '@/services/vesselService';
import { UserRole } from '@/types/secure';

export function useVessels(): DataSourceResult<SecureVessel[]> {
    const { role, user } = useRole();

    // Demo-mode mock scoping: mirror the RLS behaviour of real auth so an
    // armateur browsing the demo portal sees only their own fleet (vessels
    // where ownerId === user.id). Staff roles see all mock vessels.
    const scopedMock = useMemo(
        () =>
            role === UserRole.SHIPPING_AGENT
                ? mockSecureVessels.filter((v) => v.ownerId === user.id)
                : mockSecureVessels,
        [role, user.id],
    );

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

    return useDataSource(scopedMock, fetcher, 'vessels', 30_000);
}
