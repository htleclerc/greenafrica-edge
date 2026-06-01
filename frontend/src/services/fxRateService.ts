import type { SupabaseClient } from '@supabase/supabase-js';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export interface LockedRate {
    rate: number;
    source: string;
    lockedAt: string;
}

export async function lockRate(
    db: SupabaseClient,
    currency: string,
    base: string = 'USD',
): Promise<LockedRate> {
    if (currency === base) {
        return { rate: 1, source: 'IDENTITY', lockedAt: new Date().toISOString() };
    }

    const { data: cached } = await db
        .from('fx_rates')
        .select('rate, source, fetched_at')
        .eq('base_ccy', base)
        .eq('quote_ccy', currency)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (cached) {
        const age = Date.now() - new Date(cached.fetched_at).getTime();
        if (age < STALE_AFTER_MS) {
            return {
                rate: Number(cached.rate),
                source: cached.source,
                lockedAt: cached.fetched_at,
            };
        }
    }

    const apiKey = process.env.OPENEXCHANGE_RATES_API_KEY;
    if (!apiKey) {
        if (cached) {
            // No API key: serve stale cached rather than fail
            return { rate: Number(cached.rate), source: cached.source, lockedAt: cached.fetched_at };
        }
        throw new Error('FX rate fetch failed: OPENEXCHANGE_RATES_API_KEY missing and no cached rate');
    }

    const url = `https://openexchangerates.org/api/latest.json?app_id=${apiKey}&base=${base}&symbols=${currency}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
        resp = await fetch(url, { signal: ctl.signal });
    } catch (e) {
        clearTimeout(t);
        if (cached) return { rate: Number(cached.rate), source: cached.source, lockedAt: cached.fetched_at };
        throw new Error(`FX rate fetch failed: ${(e as Error).message}`);
    }
    clearTimeout(t);

    if (!resp.ok) {
        if (cached) return { rate: Number(cached.rate), source: cached.source, lockedAt: cached.fetched_at };
        throw new Error(`FX rate fetch failed: HTTP ${resp.status}`);
    }

    const json = (await resp.json()) as { rates: Record<string, number> };
    const rate = json.rates?.[currency];
    if (typeof rate !== 'number' || rate <= 0) {
        throw new Error(`FX rate fetch failed: rate missing for ${currency}`);
    }

    const fetchedAt = new Date().toISOString();
    await db.from('fx_rates').insert({
        base_ccy: base, quote_ccy: currency, rate, source: 'OPENEXCHANGERATES', fetched_at: fetchedAt,
    });

    return { rate, source: 'OPENEXCHANGERATES', lockedAt: fetchedAt };
}
