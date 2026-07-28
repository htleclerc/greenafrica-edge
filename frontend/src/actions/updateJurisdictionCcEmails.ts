'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

const emailList = z.array(z.string().trim().email()).max(20);
const inputSchema = z.object({
    jurisdictionId: z.string().uuid(),
    billingCcEmails: emailList,
    bailiffCcEmails: emailList,
});

export async function updateJurisdictionCcEmails(
    raw: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    const { jurisdictionId, billingCcEmails, bailiffCcEmails } = parsed.data;

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };
    const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', auth.user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return { ok: false, reason: 'insufficient role' };
    if (profile.is_active === false) return { ok: false, reason: 'account inactive' };

    // Isolation explicite : jurisdiction_billing_cc a une RLS staff-only NON scopée
    // par juridiction (tout officer passe) — la confinement se fait ici.
    if (profile.role !== 'SUPERADMIN') {
        const staffJur = await getServerJurisdictionId();
        if (jurisdictionId !== staffJur) return { ok: false, reason: 'forbidden' };
    }

    const platform = createPlatformClient();
    const { error: upErr } = await platform.from('jurisdiction_billing_cc').upsert({
        jurisdiction_id: jurisdictionId,
        cc_emails: billingCcEmails,
        bailiff_cc_emails: bailiffCcEmails,
        updated_at: new Date().toISOString(),
    });
    if (upErr) return { ok: false, reason: `update failed: ${upErr.message}` };

    await platform.from('audit_logs').insert({
        user_id: auth.user.id, user_full_name: auth.user.email ?? 'Staff',
        action: 'TRANSACTION_UPDATED', severity: 'INFO',
        entity_type: 'Jurisdiction', entity_id: jurisdictionId, jurisdiction_id: jurisdictionId,
        details_json: { event: 'JURISDICTION_CC_UPDATED', billingCount: billingCcEmails.length, bailiffCount: bailiffCcEmails.length },
    });

    revalidatePath('/admin/jurisdictions');
    return { ok: true };
}
