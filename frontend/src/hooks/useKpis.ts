'use client';

import { useCallback } from 'react';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { DashboardKpis, ArmateurKpis } from '@/types/secure';
import { mockKpis } from '@/mock/datas/secureMock';
import { getDashboardKpis, getArmateurKpis } from '@/services/kpiService';

// Mock ArmateurKpis for demo mode. Shape mirrors the real service output so
// the UI renders identically in demo and in real auth.
const mockArmateurKpis: ArmateurKpis = {
    outstandingTotalUsd: 12400,
    vesselsActive: 3,
    taxPaidYtdUsd: 48500,
    overdueCount: 0,
};

export function useKpis(): DataSourceResult<DashboardKpis> {
    const fetcher = useCallback(
        (client: Parameters<typeof getDashboardKpis>[0]) => getDashboardKpis(client),
        [],
    );
    return useDataSource(mockKpis, fetcher);
}

/**
 * Armateur-specific KPIs. Only the SHIPPING_AGENT role path on /dashboard uses
 * this hook. Staff roles keep useKpis() (platform-wide view).
 *
 * RLS auto-scopes the underlying queries to the armateur's own fleet — no
 * explicit owner_id filter needed in the service layer.
 */
export function useArmateurKpis(): DataSourceResult<ArmateurKpis> {
    const fetcher = useCallback(
        (client: Parameters<typeof getArmateurKpis>[0]) => getArmateurKpis(client),
        [],
    );
    return useDataSource(mockArmateurKpis, fetcher);
}

// DashboardPage picks useKpis() vs useArmateurKpis() by calling the matching
// branch through an early-return; this keeps each hook a single source of truth
// for its own role and avoids double-fetching when only one shape is needed.
