'use client';

import { useCallback } from 'react';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { DashboardKpis } from '@/types/secure';
import { mockKpis } from '@/mock/datas/secureMock';
import { getDashboardKpis } from '@/services/kpiService';

export function useKpis(): DataSourceResult<DashboardKpis> {
    const fetcher = useCallback(
        (client: Parameters<typeof getDashboardKpis>[0]) => getDashboardKpis(client),
        [],
    );
    return useDataSource(mockKpis, fetcher);
}
