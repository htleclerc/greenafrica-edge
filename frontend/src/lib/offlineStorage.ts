/**
 * Lightweight IndexedDB abstraction for offline data caching.
 * Stores the last known-good API responses so the dashboard
 * remains consultable when connectivity is lost.
 */

const DB_NAME = 'africgreen-offline';
const DB_VERSION = 1;
const STORE_NAME = 'cache';

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Save a value to the offline cache. */
export async function setOfflineData<T>(key: string, data: T): Promise<void> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ data, timestamp: Date.now() }, key);
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // IndexedDB unavailable — fail silently
    }
}

/** Retrieve a cached value. Returns null if not found or expired. */
export async function getOfflineData<T>(key: string, maxAgeMs?: number): Promise<T | null> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        const result = await new Promise<{ data: T; timestamp: number } | undefined>((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (!result) return null;
        if (maxAgeMs && Date.now() - result.timestamp > maxAgeMs) return null;
        return result.data;
    } catch {
        return null;
    }
}

/** Remove a specific entry from the cache. */
export async function removeOfflineData(key: string): Promise<void> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
    } catch {
        // fail silently
    }
}

/** Clear the entire offline cache. */
export async function clearOfflineData(): Promise<void> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
    } catch {
        // fail silently
    }
}
