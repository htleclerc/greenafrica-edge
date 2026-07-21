// ─────────────────────────────────────────────────────────────────────────────
// KYC IBAN encryption service.
// Detects encryption strategy (vault → pgsodium → plaintext) and encrypts/decrypts.
// ─────────────────────────────────────────────────────────────────────────────

import { createPlatformClient } from '@/lib/supabase/tenant';

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

    // Vault/extension RPCs operate on global encryption infrastructure, not a
    // tenant table — the UNSCOPED platform client is correct (.rpc() is never
    // auto-scoped regardless).
    const supabase = createPlatformClient();

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

    // RGPD/Art. 32 — fail-closed : en PRODUCTION, refuser d'écrire un IBAN si le
    // chiffrement fort (Supabase Vault) n'est pas actif. `pgsodium` est un
    // placeholder base64 (réversible) et `plaintext` stocke en clair : dans les deux
    // cas on préfère bloquer l'écriture plutôt que persister une donnée bancaire non
    // protégée. Vault confirmé actif en prod (2026-07-21). En dev/local/CI (pas de
    // Vault), la stratégie retombe sur pgsodium/plaintext : le gate ne s'y applique
    // pas (NODE_ENV !== 'production'), et un override explicite reste possible.
    if (
        s !== 'vault' &&
        process.env.NODE_ENV === 'production' &&
        process.env.KYC_ALLOW_INSECURE_IBAN !== 'true'
    ) {
        throw new Error(
            `Refus d'écrire un IBAN sans chiffrement fort (stratégie='${s}'). Supabase Vault requis en production (RGPD Art. 32).`,
        );
    }

    // Vault/extension RPCs operate on global encryption infrastructure, not a
    // tenant table — the UNSCOPED platform client is correct (.rpc() is never
    // auto-scoped regardless).
    const supabase = createPlatformClient();

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
    // Vault/extension RPCs operate on global encryption infrastructure, not a
    // tenant table — the UNSCOPED platform client is correct (.rpc() is never
    // auto-scoped regardless).
    const supabase = createPlatformClient();

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
 * Supprime définitivement le secret IBAN stocké (effacement RGPD Art. 17).
 * Vault : supprime le secret via kyc_vault_delete. pgsodium/plaintext : no-op
 * (la valeur n'est pas stockée séparément côté serveur ; nuller la colonne suffit).
 */
export async function deleteIban(stored: string): Promise<void> {
    const s = await detectStrategy();
    if (s !== 'vault') return;
    const supabase = createPlatformClient();
    await supabase.rpc('kyc_vault_delete' as never, { p_id: stored });
}

/**
 * True when IBAN storage is NOT real encryption (plaintext or pgsodium-base64-placeholder).
 * Audit log uses this to flag IBAN_ENCRYPTION_DEBT, surfacing the security gap to ops.
 */
export function isInsecureStrategy(): boolean {
    return strategy === 'plaintext' || strategy === 'pgsodium';
}

/**
 * Returns true if the current strategy is plaintext (unencrypted).
 * Used for audit logging to flag plaintext storage.
 * DEPRECATED: use isInsecureStrategy instead.
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
