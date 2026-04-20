import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Shared rate-limiter wrapper.
 *
 * Why this exists: after the 2026-04 fraud audit (finding C2), the public
 * verify page and the private-bucket download route are scraping targets
 * if left unthrottled. Even with the HMAC gate added in Tier 1 — which
 * makes enumeration infeasible — a determined attacker could still hammer
 * the endpoints to exhaust our Supabase request budget. This module caps
 * the per-IP traffic at the edge.
 *
 * Graceful degradation: if `UPSTASH_REDIS_REST_URL` /
 * `UPSTASH_REDIS_REST_TOKEN` are not set, `allow()` is a no-op that always
 * returns `{ allowed: true, skipped: true }`. That keeps local dev frictionless
 * and prevents hard failures if the Upstash project is temporarily unreachable.
 * Set `RATE_LIMIT_STRICT=true` to turn the absence of the env vars into a hard
 * failure (recommended in production — prevents silent downgrade to unlimited).
 */

type LimiterKey = 'verify' | 'invoice-download';

interface Bucket {
    /** Distinct short window — prevents small bursts. */
    perMinute: number;
    /** Slower envelope — catches slow scrapers. */
    perHour: number;
}

const LIMITS: Record<LimiterKey, Bucket> = {
    // /verify lookup — a human scanning a QR code typically does it once.
    // Allow a healthy burst (e.g. reloading, mobile flaky network) but
    // enumeration gets capped hard.
    verify: { perMinute: 30, perHour: 200 },

    // /api/invoices/[ref]/download — same traffic shape as verify, but
    // the response is heavier (PDF), so we cap lower.
    'invoice-download': { perMinute: 10, perHour: 60 },
};

// Lazy-init so we don't crash at import time when the env is missing.
let cachedRedis: Redis | null = null;
const cachedLimiters = new Map<string, Ratelimit>();

function getRedis(): Redis | null {
    if (cachedRedis) return cachedRedis;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    cachedRedis = new Redis({ url, token });
    return cachedRedis;
}

function getLimiter(key: LimiterKey, window: 'min' | 'hour'): Ratelimit | null {
    const id = `${key}:${window}`;
    const cached = cachedLimiters.get(id);
    if (cached) return cached;
    const redis = getRedis();
    if (!redis) return null;
    const { perMinute, perHour } = LIMITS[key];
    const limiter = new Ratelimit({
        redis,
        limiter: window === 'min'
            ? Ratelimit.slidingWindow(perMinute, '1 m')
            : Ratelimit.slidingWindow(perHour, '1 h'),
        prefix: `ratelimit:${id}`,
        analytics: false,
    });
    cachedLimiters.set(id, limiter);
    return limiter;
}

export interface RateLimitResult {
    allowed: boolean;
    skipped?: boolean;
    remaining?: number;
    reset?: number;
    reason?: 'rate_limited_per_minute' | 'rate_limited_per_hour' | 'no_redis_strict';
}

function requireEnvInProd(): RateLimitResult | null {
    if (process.env.NODE_ENV !== 'production') return null;
    if (process.env.RATE_LIMIT_STRICT !== 'true') return null;
    return {
        allowed: false,
        reason: 'no_redis_strict',
    };
}

/**
 * Check whether an operation is allowed for the given client identifier
 * (typically an IP). Two sliding windows are enforced: per-minute (burst
 * protection) and per-hour (sustained scraper protection). If either is
 * exceeded, the request is rejected.
 */
export async function enforceRateLimit(
    key: LimiterKey,
    clientId: string,
): Promise<RateLimitResult> {
    const minute = getLimiter(key, 'min');
    const hour = getLimiter(key, 'hour');

    if (!minute || !hour) {
        const strict = requireEnvInProd();
        if (strict) return strict;
        // Fail-open in dev or when RATE_LIMIT_STRICT is not set.
        return { allowed: true, skipped: true };
    }

    const minuteResult = await minute.limit(clientId);
    if (!minuteResult.success) {
        return {
            allowed: false,
            remaining: minuteResult.remaining,
            reset: minuteResult.reset,
            reason: 'rate_limited_per_minute',
        };
    }
    const hourResult = await hour.limit(clientId);
    if (!hourResult.success) {
        return {
            allowed: false,
            remaining: hourResult.remaining,
            reset: hourResult.reset,
            reason: 'rate_limited_per_hour',
        };
    }
    return {
        allowed: true,
        remaining: Math.min(minuteResult.remaining, hourResult.remaining),
    };
}

/** Extract the best-effort client identifier from standard proxy headers.
 *  Order: Vercel's `x-real-ip`, then first entry in `x-forwarded-for`,
 *  then a bucket-ALL fallback (which means rate-limits apply globally —
 *  degraded but not broken when headers are absent). */
export function getClientId(headers: Headers): string {
    const realIp = headers.get('x-real-ip');
    if (realIp) return realIp;
    const xff = headers.get('x-forwarded-for');
    if (xff) {
        const first = xff.split(',')[0]?.trim();
        if (first) return first;
    }
    return 'unknown-client';
}
