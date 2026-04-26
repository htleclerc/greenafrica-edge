'use client';

import { useCallback } from 'react';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { DashboardKpis, ArmateurKpis } from '@/types/secure';
import { mockKpis } from '@/mock/datas/secureMock';
import { getDashboardKpis, getArmateurKpis } from '@/services/kpiService';

// Mock ArmateurKpis for demo mode. Aligned with the demo armateur
// (usr-test-004 / MARINER Corp) fleet: owns vsec-001 (MSC BERBERA, PAYMENT_DUE,
// $4,250 pending via txn-006) + vsec-002 (MAERSK SEALAND, COMPLIANT, $3,780
// paid via txn-001). Keep in sync when mock fixtures change.
const mockArmateurKpis: ArmateurKpis = {
    outstandingTotalUsd: 4_250,   // txn-006 PENDING
    vesselsActive: 2,             // vsec-001 + vsec-002 (neither EXEMPT)
    taxPaidYtdUsd: 3_780,         // txn-001 PAID
    overdueCount: 0,              // txn-006 is 6d old, far from the 30d overdue threshold
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
