'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRole } from '@/lib/RoleContext';
import { createClient } from '@/lib/supabase/client';
import { setOfflineData, getOfflineData } from '@/lib/offlineStorage';

export interface DataSourceResult<T> {
    data: T;
    loading: boolean;
    error: string | null;
    isOffline: boolean;
    refetch: () => void;
}

/**
 * Factory hook that switches between mock data (demo mode) and real Supabase data.
 * When offline, falls back to IndexedDB-cached data from the last successful fetch.
 *
 * @param mockData — data returned in demo mode
 * @param fetcher — async function that fetches real data from Supabase
 * @param cacheKey — optional key for IndexedDB offline cache (enables offline support)
 */
export function useDataSource<T>(
    mockData: T,
    fetcher: (client: ReturnType<typeof createClient>) => Promise<T>,
    cacheKey?: string,
    pollIntervalMs?: number,
): DataSourceResult<T> {
    const { isDemo, ready } = useRole();
    const [data, setData] = useState<T>(mockData);
    const [loading, setLoading] = useState(!isDemo);
    const [error, setError] = useState<string | null>(null);
    const [isOffline, setIsOffline] = useState(false);

    const fetchData = useCallback(async () => {
        if (isDemo) {
            setData(mockData);
            setLoading(false);
            setIsOffline(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const client = createClient();
            const result = await fetcher(client);
            setData(result);
            setIsOffline(false);
            // Cache successful result for offline use
            if (cacheKey) {
                setOfflineData(cacheKey, result).catch(() => {});
            }
        } catch (err) {
            // Try offline cache before falling back to mock
            if (cacheKey) {
                const cached = await getOfflineData<T>(cacheKey, 24 * 60 * 60 * 1000); // 24h max age
                if (cached) {
                    setData(cached);
                    setIsOffline(true);
                    setError(null);
                    setLoading(false);
                    return;
                }
            }
            setError(err instanceof Error ? err.message : 'Failed to fetch data');
            setData(mockData); // fallback to mock on error
            setIsOffline(!navigator.onLine);
        } finally {
            setLoading(false);
        }
    }, [isDemo, mockData, fetcher, cacheKey]);

    useEffect(() => {
        if (ready) fetchData();
    }, [ready, fetchData]);

    // Optional polling for live data (e.g., vessel positions)
    useEffect(() => {
        if (!pollIntervalMs || isDemo || !ready) return;
        const interval = setInterval(fetchData, pollIntervalMs);
        return () => clearInterval(interval);
    }, [pollIntervalMs, isDemo, ready, fetchData]);

    return { data, loading, error, isOffline, refetch: fetchData };
}
