'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { notifyStaffSafe } from '@/services/staffNotificationService';
import { createPlatformClient } from '@/lib/supabase/tenant';

const REASONS = [
    'EMISSION_CALCULATION',
    'TAX_RATE',
    'ZONE_CLASSIFICATION',
    'VESSEL_DATA',
    'OTHER',
] as const;

const schema = z.object({
    transactionId: z.string().uuid(),
    reason: z.enum(REASONS),
    description: z.string().trim().min(10).max(2000),
    evidenceUrl: z.string().url().optional().or(z.literal('')),
});

export type CreateOwnerDisputeResult =
    | { ok: true; disputeId: string; ref: string | null }
    | { ok: false; reason: string };

/**
 * SHIPOWNER dispute creation. Inserts into the disputes table; mig 039
 * tightened the existing INSERT policy so a SHIPOWNER can only dispute
 * transactions whose shipowner_id resolves to their own profile_id.
 *
 * The original_amount_usd field is required by the schema — fetched
 * from the transaction in the same call so the action is one round-trip
 * from the caller's perspective.
 */
export async function createOwnerDispute(
    raw: unknown,
): Promise<CreateOwnerDisputeResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (profile?.role !== 'SHIPOWNER') {
        return { ok: false, reason: 'only shipowners can open disputes via this action' };
    }

    // Fetch the transaction to get vessel_id + amount. RLS scopes to our own.
    const { data: txn, error: txnErr } = await supabase
        .from('transactions')
        .select('id, vessel_id, tax_amount_usd, jurisdiction_id, invoice_ref, shipowner:shipowners (name)')
        .eq('id', parsed.data.transactionId)
        .single();
    if (txnErr || !txn) {
        return { ok: false, reason: 'transaction not found or not yours' };
    }

    const { data: dispute, error } = await supabase
        .from('disputes')
        .insert({
            transaction_id: txn.id,
            vessel_id: txn.vessel_id,
            submitted_by: auth.user.id,
            reason: parsed.data.reason,
            description: parsed.data.description,
            evidence_urls: parsed.data.evidenceUrl ? [parsed.data.evidenceUrl] : [],
            original_amount_usd: txn.tax_amount_usd,
        })
        .select('id, ref')
        .single();

    if (error) {
        return { ok: false, reason: error.message };
    }

    // L'action tourne sous le client de session d'un ARMATEUR : il n'a aucun
    // droit d'écriture sur staff_notifications (mig 133, aucune policy INSERT).
    // L'émission passe donc par le client plateforme.
    const t = txn as unknown as {
        jurisdiction_id: string | null; invoice_ref: string | null;
        shipowner: { name: string } | { name: string }[] | null;
    };
    if (t.jurisdiction_id) {
        const owner = Array.isArray(t.shipowner) ? t.shipowner[0] : t.shipowner;
        await notifyStaffSafe(createPlatformClient(), {
            jurisdictionId: t.jurisdiction_id,
            kind: 'DISPUTE_OPENED',
            params: {
                debtor: owner?.name ?? '\u2014',
                ref: t.invoice_ref ?? dispute.ref ?? parsed.data.transactionId.slice(0, 8),
            },
            deepLink: '/dashboard/disputes',
            dedupKey: dispute.id,
        });
    }

    return { ok: true, disputeId: dispute.id, ref: dispute.ref };
}
