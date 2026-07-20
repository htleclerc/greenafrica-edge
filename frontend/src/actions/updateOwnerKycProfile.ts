'use server';

import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';
import { encryptIban } from '@/services/kycService';
import { createTenantClient } from '@/lib/supabase/tenant';
import { kycBEditableSchema, ALLOWED_DOC_TYPES } from '@/lib/kyc/kycSchema';

// Édition partielle : identité (KYC-B éditable) et/ou billing/banque (KYC-C).
const billingEditSchema = z.object({
    billing_legal_name: z.string().min(2).max(200).optional(),
    billing_address_line1: z.string().min(2).max(200).optional(),
    billing_address_line2: z.string().max(200).optional(),
    billing_city: z.string().min(2).max(100).optional(),
    billing_postal_code: z.string().min(2).max(20).optional(),
    billing_country_code: z.string().length(2).optional(),
    vat_number: z.string().max(50).optional(),
    iban: z.string().regex(/^[A-Z0-9]{15,34}$/).optional(),
    swift_bic: z.string().regex(/^[A-Z0-9]{8,11}$/).optional(),
    bank_name: z.string().min(2).max(200).optional(),
    billing_proof_doc_storage_path: z.string().min(1).optional(),
    billing_proof_doc_type: z.enum(ALLOWED_DOC_TYPES).optional(),
});

const inputSchema = z.object({
    identity: kycBEditableSchema.optional(),
    billing: billingEditSchema.optional(),
});

export async function updateOwnerKycProfile(input: z.infer<typeof inputSchema>): Promise<{ ok: true }> {
    const session = await requireOwner();
    const data = inputSchema.parse(input);
    const admin = createTenantClient(session.jurisdictionId);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const changed: string[] = [];

    if (data.identity) {
        const id = data.identity;
        for (const k of ['address', 'phone_e164', 'preferred_language', 'ops_email', 'finance_email'] as const) {
            if (id[k] !== undefined) { patch[k] = id[k]; changed.push(k); }
        }
        // imo_company_no / aoc_number : modification ⇒ re-vérification (reset des flags B).
        const idChangesVerification =
            (id.imo_company_no !== undefined && id.imo_company_no !== session.shipowner.imo_company_no) ||
            id.aoc_number !== undefined;
        if (id.imo_company_no !== undefined) { patch.imo_company_no = id.imo_company_no; changed.push('imo_company_no'); }
        if (id.aoc_number !== undefined) { patch.aoc_number = id.aoc_number; changed.push('aoc_number'); }
        if (idChangesVerification) {
            patch.kyc_level_b_completed_at = null;
            patch.imo_company_no_verified_at = null;
            changed.push('kyc_b_reverification');
        }
    }

    if (data.billing) {
        const b = data.billing;
        for (const k of ['billing_legal_name', 'billing_address_line1', 'billing_address_line2', 'billing_city',
            'billing_postal_code', 'billing_country_code', 'vat_number', 'swift_bic', 'bank_name'] as const) {
            if (b[k] !== undefined) { patch[k] = b[k]; changed.push(k); }
        }
        if (b.billing_proof_doc_storage_path !== undefined) { patch.billing_proof_doc_url = b.billing_proof_doc_storage_path; changed.push('billing_proof'); }
        if (b.billing_proof_doc_type !== undefined) patch.billing_proof_doc_type = b.billing_proof_doc_type;
        if (b.iban !== undefined && b.iban) { patch.iban = await encryptIban(b.iban); changed.push('iban'); }
    }

    const { error } = await admin.from('shipowners').update(patch).eq('id', session.shipowner.id);
    if (error) throw error;

    const { error: auditError } = await admin.from('audit_logs').insert({
        user_id: session.userId,
        user_full_name: session.shipowner.name,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Shipowner',
        entity_id: session.shipowner.id,
        details_json: { event: 'SHIPOWNER_KYC_UPDATED', changed_fields: changed },
    });
    if (auditError) throw auditError;

    return { ok: true };
}
