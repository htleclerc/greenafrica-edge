// ─────────────────────────────────────────────────────────────────────────────
// submitKycC server action: KYC Level C completion for shipowner billing details.
// Validates input, encrypts IBAN, persists to DB, and logs to audit trail.
// ─────────────────────────────────────────────────────────────────────────────

'use server';

import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';
import { encryptIban, isInsecureStrategy } from '@/services/kycService';
import { createTenantClient } from '@/lib/supabase/tenant';

const schema = z.object({
    billing_legal_name: z.string().min(2).max(200),
    billing_address_line1: z.string().min(2).max(200),
    billing_address_line2: z.string().max(200).optional(),
    billing_city: z.string().min(2).max(100),
    billing_postal_code: z.string().min(2).max(20),
    billing_country_code: z.string().length(2),
    vat_number: z.string().max(50).optional(),
    iban: z.string().regex(/^[A-Z0-9]{15,34}$/),
    swift_bic: z.string().regex(/^[A-Z0-9]{8,11}$/),
    bank_name: z.string().min(2).max(200),
    cgv_accepted: z.literal(true),
});

export async function submitKycC(input: z.infer<typeof schema>) {
    const session = await requireOwner();
    const data = schema.parse(input);

    // Encrypt IBAN before persisting.
    const ibanStored = await encryptIban(data.iban);

    // Owner-context: scope to the operator's home jurisdiction so the shipowners
    // UPDATE is auto-filtered by jurisdiction_id (defense in depth on top of the
    // explicit .eq('id', …) below). audit_logs is global → passes through.
    const admin = createTenantClient(session.jurisdictionId);

    // Update shipowner with KYC Level C details.
    const { error: updateError } = await admin
        .from('shipowners')
        .update({
            billing_legal_name: data.billing_legal_name,
            billing_address_line1: data.billing_address_line1,
            billing_address_line2: data.billing_address_line2 ?? null,
            billing_city: data.billing_city,
            billing_postal_code: data.billing_postal_code,
            billing_country_code: data.billing_country_code,
            vat_number: data.vat_number ?? null,
            iban: ibanStored,
            swift_bic: data.swift_bic,
            bank_name: data.bank_name,
            kyc_level_c_completed_at: new Date().toISOString(),
        })
        .eq('id', session.shipowner.id);

    if (updateError) throw updateError;

    // Log to audit trail.
    const { error: auditError } = await admin.from('audit_logs').insert({
        user_id: session.userId,
        user_full_name: session.shipowner.name,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Shipowner',
        entity_id: session.shipowner.id,
        details_json: {
            event: 'SHIPOWNER_KYC_C_COMPLETED',
            iban_encryption: isInsecureStrategy() ? 'INSECURE_DEBT' : 'ENCRYPTED',
            cgv_accepted_at: new Date().toISOString(),
        },
    });

    if (auditError) throw auditError;

    return { ok: true };
}
