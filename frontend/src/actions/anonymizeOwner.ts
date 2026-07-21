'use server';

import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { assertAdminCanActOn } from '@/lib/auth/adminTenant';

// ─────────────────────────────────────────────────────────────────────────────
// RGPD Art. 17 — droit à l'effacement (anonymisation d'un armateur/compagnie).
//
// SUPERADMIN-only, audité. Efface les données de CONTACT et BANCAIRES d'un
// shipowner ; CONSERVE l'identité légale/fiscale (name, billing_legal_name,
// country_code, imo/iata/icao/hub/aoc, jurisdiction_id, drapeaux sanctions) —
// exception Art. 17(3)(b) (obligation légale de conservation fiscale) — et ne
// touche jamais aux transactions immuables (mig 089).
//
// Idempotent : si anonymized_at est déjà posé, ne refait rien.
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
    shipownerId: z.string().uuid(),
});

// NOTE: type kept un-exported — 'use server' files can only export async
// functions. Callers infer via `Awaited<ReturnType<typeof anonymizeOwner>>`.
type AnonymizeOwnerResult =
    | { ok: true; alreadyAnonymized?: boolean }
    | { ok: false; error: string };

interface ShipownerAnonymizeRow {
    id: string;
    jurisdiction_id: string;
    anonymized_at: string | null;
    profile_id: string | null;
    proof_doc_url: string | null;
    billing_proof_doc_url: string | null;
}

export async function anonymizeOwner(input: { shipownerId: string }): Promise<AnonymizeOwnerResult> {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN]);
    if (auth.error || !auth.user) {
        return { ok: false, error: 'Not authorized' };
    }

    // 1. Look up the shipowner (find regardless of tenant), then confine the
    //    acting admin to that jurisdiction.
    const platform = createPlatformClient();
    const { data: row, error: rowErr } = await platform
        .from('shipowners')
        .select('id, jurisdiction_id, anonymized_at, profile_id, proof_doc_url, billing_proof_doc_url')
        .eq('id', parsed.shipownerId)
        .maybeSingle();
    if (rowErr) return { ok: false, error: rowErr.message };
    if (!row) return { ok: false, error: 'Not found' };
    const shipowner = row as ShipownerAnonymizeRow;

    // 2. Idempotence — already anonymized, nothing more to do.
    if (shipowner.anonymized_at) {
        return { ok: true, alreadyAnonymized: true };
    }

    let jid: string;
    try {
        jid = await assertAdminCanActOn(auth.user, shipowner.jurisdiction_id);
    } catch {
        return { ok: false, error: 'Not authorized for this jurisdiction' };
    }
    const admin = createTenantClient(jid);

    // 3. Scrub CONTACT + BANK fields. Identity/fiscal fields (name,
    //    billing_legal_name, country_code, billing_country_code,
    //    imo_company_no, iata_code, icao_code, hub_code, aoc_number,
    //    jurisdiction_id, is_ofac_sdn, is_un_prohibited) are NEVER touched.
    const scrubbedFields = [
        'address', 'official_email', 'official_email_source', 'ops_email', 'finance_email',
        'phone_e164', 'notes', 'equasis_id', 'iban', 'swift_bic', 'bank_name',
        'billing_address_line1', 'billing_address_line2', 'billing_city', 'billing_postal_code',
        'vat_number', 'proof_doc_url', 'proof_doc_type', 'billing_proof_doc_url', 'billing_proof_doc_type',
        'aliases',
    ] as const;

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
        address: null,
        official_email: null,
        official_email_source: null,
        ops_email: null,
        finance_email: null,
        phone_e164: null,
        notes: null,
        equasis_id: null,
        iban: null,
        swift_bic: null,
        bank_name: null,
        billing_address_line1: null,
        billing_address_line2: null,
        billing_city: null,
        billing_postal_code: null,
        vat_number: null,
        proof_doc_url: null,
        proof_doc_type: null,
        billing_proof_doc_url: null,
        billing_proof_doc_type: null,
        aliases: [],
        anonymized_at: now,
        updated_at: now,
    };

    const { error: updateErr } = await admin.from('shipowners').update(patch).eq('id', parsed.shipownerId);
    if (updateErr) return { ok: false, error: updateErr.message };

    // 4. Anonymize the linked profile, if any. email/full_name are NOT NULL
    //    columns → placeholders, not null.
    if (shipowner.profile_id) {
        const { error: profileErr } = await admin
            .from('profiles')
            .update({
                email: `anon-${shipowner.profile_id.slice(0, 8)}@anonymized.invalid`,
                full_name: 'ANONYMIZED',
            })
            .eq('id', shipowner.profile_id);
        if (profileErr) return { ok: false, error: profileErr.message };
    }

    // 5. Best-effort removal of KYC storage objects — never blocks the
    //    anonymization response.
    try {
        const paths = [shipowner.proof_doc_url, shipowner.billing_proof_doc_url].filter(
            (p): p is string => Boolean(p),
        );
        if (paths.length > 0) {
            await admin.storage.from('shipowner-kyc').remove(paths);
        }
    } catch (err) {
        console.error('[anonymizeOwner] storage cleanup failed:', err);
    }

    // 6. Audit — field names only, NEVER personal values.
    try {
        await admin.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: auth.user.fullName,
            action: 'TRANSACTION_UPDATED',
            severity: 'CRITICAL',
            entity_type: 'Shipowner',
            entity_id: parsed.shipownerId,
            jurisdiction_id: jid,
            details_json: { event: 'SHIPOWNER_ANONYMIZED', scrubbed_fields: scrubbedFields },
        });
    } catch (err) {
        console.error('[anonymizeOwner] audit_log insert failed:', err);
    }

    // TODO: the encrypted IBAN's corresponding Vault secret is not deleted
    // here — Vault has no confirmed delete-secret RPC yet. Nulling
    // shipowners.iban removes the app-level reference only.

    return { ok: true };
}
