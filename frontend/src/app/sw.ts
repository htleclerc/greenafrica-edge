import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist, StaleWhileRevalidate, CacheFirst, ExpirationPlugin } from 'serwist';

declare global {
    interface WorkerGlobalScope extends SerwistGlobalConfig {
        __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
    }
}

declare const self: WorkerGlobalScope & typeof globalThis;

const serwist = new Serwist({
    precacheEntries: self.__SW_MANIFEST,
    skipWaiting: true,
    clientsClaim: true,
    navigationPreload: true,
    runtimeCaching: [
        // Cache API responses with StaleWhileRevalidate
        {
            matcher: /\/api\/(vessels|transactions|kpis|tax)/,
            handler: new StaleWhileRevalidate({
                cacheName: 'api-data',
                plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 })],
            }),
        },
        // Cache tax configs longer (they change rarely)
        {
            matcher: /\/api\/tax\/config/,
            handler: new CacheFirst({
                cacheName: 'tax-configs',
                plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 24 * 60 * 60 })],
            }),
        },
        // Default caching for everything else
        ...defaultCache,
    ],
});

serwist.addEventListeners();
