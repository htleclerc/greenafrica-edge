'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Queued action stored in localStorage for offline sync.
 */
interface QueuedAction {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    createdAt: string;
}

const QUEUE_KEY = 'africgreen-offline-queue';

function loadQueue(): QueuedAction[] {
    try {
        const raw = localStorage.getItem(QUEUE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveQueue(queue: QueuedAction[]) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Hook for queuing actions when offline and syncing when back online.
 *
 * Usage:
 *   const { enqueue, queue, pendingCount, flush } = useOfflineQueue(syncFn);
 *
 * - enqueue(type, payload) → adds to queue
 * - flush() → attempts to sync all queued actions (call when back online)
 * - pendingCount → number of unsynced actions
 */
export function useOfflineQueue(
    syncFn?: (action: QueuedAction) => Promise<boolean>,
) {
    const [queue, setQueue] = useState<QueuedAction[]>([]);

    useEffect(() => {
        setQueue(loadQueue());
    }, []);

    const enqueue = useCallback((type: string, payload: Record<string, unknown>) => {
        const action: QueuedAction = {
            id: crypto.randomUUID(),
            type,
            payload,
            createdAt: new Date().toISOString(),
        };
        setQueue((prev) => {
            const next = [...prev, action];
            saveQueue(next);
            return next;
        });
    }, []);

    const flush = useCallback(async () => {
        if (!syncFn || queue.length === 0) return;

        const remaining: QueuedAction[] = [];
        for (const action of queue) {
            try {
                const ok = await syncFn(action);
                if (!ok) remaining.push(action);
            } catch {
                remaining.push(action);
            }
        }
        setQueue(remaining);
        saveQueue(remaining);
    }, [queue, syncFn]);

    return {
        queue,
        pendingCount: queue.length,
        enqueue,
        flush,
    };
}
