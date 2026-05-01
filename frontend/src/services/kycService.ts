// ─────────────────────────────────────────────────────────────────────────────
// KYC IBAN encryption service.
// Detects encryption strategy (vault → pgsodium → plaintext) and encrypts/decrypts.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

let strategy: 'vault' | 'pgsodium' | 'plaintext' | null = null;

/**
 * Detects which encryption extension is available for IBAN storage.
 * Result is cached for performance.
 *
 * Priority:
 *   1. supabase_vault (live)
 *   2. pgsodium (fallback, not in local)
 *   3. plaintext (debug/fallback)
 */
async function detectStrategy(): Promise<'vault' | 'pgsodium' | 'plaintext'> {
    if (strategy) return strategy;

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data } = await supabase.rpc('pg_extension_lookup_kyc' as never);
    const exts = (data as string[] | null) ?? [];

    if (exts.includes('supabase_vault')) strategy = 'vault';
    else if (exts.includes('pgsodium')) strategy = 'pgsodium';
    else strategy = 'plaintext';

    return strategy;
}

/**
 * Encrypts a plaintext IBAN using the detected strategy.
 *
 * Vault: Stores the IBAN as a secret and returns the UUID.
 * Pgsodium: Encrypts using base64 encoding (placeholder).
 * Plaintext: Returns the input unchanged (debug only).
 */
export async function encryptIban(plain: string): Promise<string> {
    const s = await detectStrategy();
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    if (s === 'vault') {
        const { data } = await supabase.rpc('kyc_vault_store' as never, { p_value: plain });
        return data as string;
    }

    if (s === 'pgsodium') {
        const { data } = await supabase.rpc('kyc_pgsodium_encrypt' as never, { p_value: plain });
        return data as string;
    }

    // plaintext
    return plain;
}

/**
 * Decrypts a stored IBAN using the detected strategy.
 *
 * Vault: Retrieves the secret from vault using its UUID.
 * Pgsodium: Decrypts from base64 encoding (placeholder).
 * Plaintext: Returns the input unchanged (debug only).
 */
export async function decryptIban(stored: string): Promise<string> {
    const s = await detectStrategy();
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    if (s === 'vault') {
        const { data } = await supabase.rpc('kyc_vault_retrieve' as never, { p_id: stored });
        return data as string;
    }

    if (s === 'pgsodium') {
        const { data } = await supabase.rpc('kyc_pgsodium_decrypt' as never, { p_ct: stored });
        return data as string;
    }

    // plaintext
    return stored;
}

/**
 * Returns true if the current strategy is plaintext (unencrypted).
 * Used for audit logging to flag plaintext storage.
 */
export function isPlaintextStrategy(): boolean {
    return strategy === 'plaintext';
}

/**
 * Resets the cached strategy (testing only).
 */
export function _resetStrategy(): void {
    strategy = null;
}
