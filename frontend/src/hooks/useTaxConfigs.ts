'use client';

import { useCallback } from 'react';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { TaxConfiguration } from '@/types/secure';
import { mockTaxConfigs } from '@/mock/datas/secureMock';
import { getTaxConfigurations } from '@/services/taxService';

export function useTaxConfigs(): DataSourceResult<TaxConfiguration[]> {
    const fetcher = useCallback(
        (client: Parameters<typeof getTaxConfigurations>[0]) => getTaxConfigurations(client),
        [],
    );
    return useDataSource(mockTaxConfigs, fetcher);
}
