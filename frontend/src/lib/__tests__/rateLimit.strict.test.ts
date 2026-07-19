import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enforceRateLimit } from '../rateLimit';

// Behaviour of the no-Redis degradation policy: fail-open outside production,
// fail-closed in production (secure default), opt-out with RATE_LIMIT_STRICT=false.
describe('rateLimit no-Redis degradation policy', () => {
    beforeEach(() => {
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
        delete process.env.RATE_LIMIT_STRICT;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        delete process.env.RATE_LIMIT_STRICT;
    });

    it('fails open outside production (dev/CI frictionless)', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        const r = await enforceRateLimit('verify', '127.0.0.1');
        expect(r.allowed).toBe(true);
        expect(r.skipped).toBe(true);
    });

    it('fails CLOSED in production when Redis is not configured (secure default)', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const r = await enforceRateLimit('verify', '127.0.0.1');
        expect(r.allowed).toBe(false);
        expect(r.reason).toBe('no_redis_strict');
    });

    it('opts out of production fail-closed with RATE_LIMIT_STRICT=false', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('RATE_LIMIT_STRICT', 'false');
        const r = await enforceRateLimit('verify', '127.0.0.1');
        expect(r.allowed).toBe(true);
        expect(r.skipped).toBe(true);
    });
});
