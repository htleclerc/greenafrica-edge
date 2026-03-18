'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to track the browser's online/offline status.
 * Returns { isOnline, wasOffline } — wasOffline is true if the user
 * was offline at any point during this session (useful for showing
 * "data may be stale" warnings after reconnection).
 */
export function useOnlineStatus() {
    const [isOnline, setIsOnline] = useState(true);
    const [wasOffline, setWasOffline] = useState(false);

    const handleOnline = useCallback(() => setIsOnline(true), []);
    const handleOffline = useCallback(() => {
        setIsOnline(false);
        setWasOffline(true);
    }, []);

    useEffect(() => {
        setIsOnline(navigator.onLine);
        if (!navigator.onLine) setWasOffline(true);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [handleOnline, handleOffline]);

    return { isOnline, wasOffline };
}
