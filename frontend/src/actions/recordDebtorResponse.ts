'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { notifyStaffSafe } from '@/services/staffNotificationService';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

const inputSchema = z.object({
    transactionId: z.string().uuid(),
    responseType: z.enum(['SILENT', 'ACKNOWLEDGE', 'DISPUTE', 'PAYMENT_PROMISE', 'PARTIAL_PAYMENT', 'PAID', 'REFUSED']),
    note: z.string().trim().max(500).optional(),
});

export async function recordDebtorResponse(
    raw: unknown,
): Promise<{ ok: true; tier: string } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    const { transactionId, responseType, note } = parsed.data;

    // 1. Authentifier + rôle staff (depuis profiles, jamais le JWT).
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };
    const { data: profile } = await supabase.from('profiles').select('role, full_name, is_active').eq('id', auth.user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return { ok: false, reason: 'insufficient role' };
    if (profile.is_active === false) return { ok: false, reason: 'account inactive' };

    const platform = createPlatformClient();

    // 2. Résoudre la juridiction de la transaction + isolation EXPLICITE
    //    (collection_reminders n'est pas tenant-scopée → pas d'auto-filtre).
    const { data: txn } = await platform
        .from('transactions').select('jurisdiction_id').eq('id', transactionId).maybeSingle();
    if (!txn) return { ok: false, reason: 'transaction not found' };
    const jurisdictionId = (txn as { jurisdiction_id: string | null }).jurisdiction_id;
    if (profile.role !== 'SUPERADMIN') {
        const staffJur = await getServerJurisdictionId();
        if (jurisdictionId !== staffJur) return { ok: false, reason: 'forbidden' };
    }

    // 3. Charger la relance la plus récente de la transaction.
    const { data: latest } = await platform
        .from('collection_reminders')
        .select('id, tier, debtor_response_type')
        .eq('transaction_id', transactionId)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!latest) return { ok: false, reason: 'no reminder to annotate' };
    const reminder = latest as { id: string; tier: string; debtor_response_type: string };

    // 4. Stamper la réponse.
    const { error: updErr } = await platform
        .from('collection_reminders')
        .update({ debtor_response_type: responseType, debtor_response_at: new Date().toISOString() })
        .eq('id', reminder.id);
    if (updErr) return { ok: false, reason: `update failed: ${updErr.message}` };

    // 5. Audit (sans migration d'enum : TRANSACTION_UPDATED + event).
    await platform.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: profile.full_name ?? auth.user.email ?? 'Staff',
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Transaction',
        entity_id: transactionId,
        jurisdiction_id: jurisdictionId,
        details_json: {
            event: 'DEBTOR_RESPONSE_RECORDED',
            tier: reminder.tier,
            previousResponse: reminder.debtor_response_type,
            newResponse: responseType,
            note: note ?? null,
        },
    });

    // Une contestation ou une promesse suspend la rampe : l'équipe doit le
    // savoir sans avoir à rouvrir l'écran. Pas de dedup — enregistrer une
    // seconde réponse sur le même dossier est un fait nouveau.
    if (jurisdictionId) {
        await notifyStaffSafe(platform, {
            jurisdictionId,
            kind: 'DEBTOR_RESPONDED',
            params: { response: responseType, tier: reminder.tier },
            deepLink: '/admin/collections',
        });
    }

    revalidatePath('/admin/collections');
    return { ok: true, tier: reminder.tier };
}
