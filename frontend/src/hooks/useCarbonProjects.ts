'use client';

import { useCallback } from 'react';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { CarbonProject } from '@/types/secure';
import { mockCarbonProjects } from '@/mock/datas/secureMock';
import { getCarbonProjects } from '@/services/projectService';

export function useCarbonProjects(): DataSourceResult<CarbonProject[]> {
    const fetcher = useCallback(
        (client: Parameters<typeof getCarbonProjects>[0]) => getCarbonProjects(client),
        [],
    );
    return useDataSource(mockCarbonProjects, fetcher);
}
