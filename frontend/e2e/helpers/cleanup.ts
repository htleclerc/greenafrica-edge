/**
 * E2E cleanup harness — LIFO teardown.
 *
 * Each test calls `registerCleanup(fn)` immediately after creating a resource.
 * The Playwright `afterEach` hook calls `runCleanup()` which drains the queue
 * in reverse order (children before parents — FK-safe).
 *
 * Errors during cleanup are logged but do not abort the sweep — we want every
 * registered handle to fire even if one fails, so an isolated FK violation
 * doesn't leave a long tail of orphan rows.
 */

const cleanupHandles: Array<() => Promise<void>> = [];

export function registerCleanup(fn: () => Promise<void>): void {
    // unshift = LIFO drain order in runCleanup (shift from front).
    cleanupHandles.unshift(fn);
}

export async function runCleanup(): Promise<void> {
    while (cleanupHandles.length) {
        const fn = cleanupHandles.shift()!;
        try {
            await fn();
        } catch (e) {
            console.warn('[e2e/cleanup] handler error (continuing):', e);
        }
    }
}

/**
 * Number of registered handles. Useful for diagnostic logging
 * (e.g. confirm tests are wiring cleanup in beforeEach/setup).
 */
export function pendingCleanupCount(): number {
    return cleanupHandles.length;
}
