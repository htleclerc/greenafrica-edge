import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { enforceRateLimit } from '../rateLimit';

describe('rateLimit signup-shipowner bucket', () => {
    beforeEach(() => {
        // Save original env vars
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
    });

    afterEach(() => {
        // Clean up env vars after each test
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
    });

    it('skips when env not set (dev fallback)', async () => {
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
        const r = await enforceRateLimit('signup-shipowner', '127.0.0.1');
        expect(r.allowed).toBe(true);
        expect((r as { skipped?: boolean }).skipped).toBe(true);
    });
});
