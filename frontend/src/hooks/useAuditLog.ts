'use client';

import { useCallback } from 'react';
import { useDataSource, type DataSourceResult } from './useDataSource';
import type { AuditLogEntry } from '@/types/secure';
import { mockAuditLog } from '@/mock/datas/secureMock';
import { getAuditLogs } from '@/services/auditService';

export function useAuditLog(): DataSourceResult<AuditLogEntry[]> {
    const fetcher = useCallback(
        (client: Parameters<typeof getAuditLogs>[0]) => getAuditLogs(client),
        [],
    );
    return useDataSource(mockAuditLog, fetcher);
}
