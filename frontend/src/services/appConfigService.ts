import type { SupabaseClient } from '@supabase/supabase-js';

export interface AppConfigEntry {
    key: string;
    value: unknown;
    description: string | null;
    updated_at: string;
}

/**
 * Fetch all app_config rows whose key starts with any of the given prefixes.
 *
 * Usage:
 *   const entries = await listConfigByPrefix(db, ['carbon_tax.', 'arrival.']);
 *
 * Prefixes are matched with case-insensitive LIKE (`ilike`). Caller is
 * responsible for supplying trusted prefixes — we do not escape wildcards.
 */
export async function listConfigByPrefix(
    db: SupabaseClient,
    prefixes: string[],
): Promise<AppConfigEntry[]> {
    if (prefixes.length === 0) return [];
    const orClause = prefixes.map((p) => `key.ilike.${p}%`).join(',');
    const { data, error } = await db
        .from('app_config')
        .select('key, value, description, updated_at')
        .or(orClause)
        .order('key');
    if (error) throw error;
    return (data ?? []) as AppConfigEntry[];
}

/**
 * Load a single config row by exact key, or null if missing.
 */
export async function getConfigValue<T = unknown>(
    db: SupabaseClient,
    key: string,
): Promise<T | null> {
    const { data, error } = await db
        .from('app_config')
        .select('value')
        .eq('key', key)
        .maybeSingle();
    if (error) throw error;
    return (data?.value as T) ?? null;
}
