'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRole } from '@/lib/RoleContext';
import { createClient } from '@/lib/supabase/client';

export interface DataSourceResult<T> {
    data: T;
    loading: boolean;
    error: string | null;
    refetch: () => void;
}

/**
 * Factory hook that switches between mock data (demo mode) and real Supabase data.
 * @param mockData — data returned in demo mode
 * @param fetcher — async function that fetches real data from Supabase
 */
export function useDataSource<T>(
    mockData: T,
    fetcher: (client: ReturnType<typeof createClient>) => Promise<T>,
): DataSourceResult<T> {
    const { isDemo, ready } = useRole();
    const [data, setData] = useState<T>(mockData);
    const [loading, setLoading] = useState(!isDemo);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        if (isDemo) {
            setData(mockData);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const client = createClient();
            const result = await fetcher(client);
            setData(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch data');
            setData(mockData); // fallback to mock on error
        } finally {
            setLoading(false);
        }
    }, [isDemo, mockData, fetcher]);

    useEffect(() => {
        if (ready) fetchData();
    }, [ready, fetchData]);

    return { data, loading, error, refetch: fetchData };
}
