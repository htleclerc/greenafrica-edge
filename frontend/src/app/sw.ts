import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
    interface WorkerGlobalScope extends SerwistGlobalConfig {
        __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
    }
}

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

const serwist = new Serwist({
    precacheEntries: self.__SW_MANIFEST,
    skipWaiting: true,
    clientsClaim: true,
    navigationPreload: true,
    runtimeCaching: [
        // Cache API responses with StaleWhileRevalidate
        {
            urlPattern: /\/api\/(vessels|transactions|kpis|tax)/,
            handler: 'StaleWhileRevalidate',
            options: {
                cacheName: 'api-data',
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 }, // 1h
            },
        },
        // Cache tax configs longer (they change rarely)
        {
            urlPattern: /\/api\/tax\/config/,
            handler: 'CacheFirst',
            options: {
                cacheName: 'tax-configs',
                expiration: { maxEntries: 10, maxAgeSeconds: 24 * 60 * 60 }, // 24h
            },
        },
        // Default caching for everything else
        ...defaultCache,
    ],
});

serwist.addEventListeners();
