'use client';

import { useCallback } from 'react';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { Exemption } from '@/types/secure';
import { mockExemptions } from '@/mock/datas/secureMock';
import { getExemptions } from '@/services/exemptionService';

export function useExemptions(): DataSourceResult<Exemption[]> {
    const fetcher = useCallback(
        (client: Parameters<typeof getExemptions>[0]) => getExemptions(client),
        [],
    );
    return useDataSource(mockExemptions, fetcher);
}
