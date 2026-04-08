'use client';

import { useCallback } from 'react';
import { useRole } from '@/lib/RoleContext';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { Inspection } from '@/types/secure';
import { UserRole, isShipRole } from '@/types/secure';
import { mockInspections } from '@/mock/datas/secureMock';
import { getInspections, getInspectionsByInspector } from '@/services/inspectionService';

export function useInspections(): DataSourceResult<Inspection[]> {
    const { role, user } = useRole();

    const fetcher = useCallback(
        async (client: Parameters<typeof getInspections>[0]) => {
            // SHIPPING_AGENT sees only inspections on their own vessels (via RLS)
            // PORT_OFFICER / inspector sees own inspections
            if (isShipRole(role)) {
                return getInspectionsByInspector(client, user.id);
            }
            return getInspections(client);
        },
        [role, user.id],
    );

    return useDataSource(mockInspections, fetcher, 'inspections');
}
