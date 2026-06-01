'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { claimAlert } from '@/services/arrivalAlertService';
import { getOrCreateGhost, upsertShipownerEmail } from '@/services/shipownerService';

const inputSchema = z.object({
    alertId: z.string().uuid(),
    ownerEmail: z.string().email(),
});

export async function claimArrivalAlert(
    raw: unknown,
): Promise<{ ok: true; alertId: string } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const { alertId, ownerEmail } = parsed.data;

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (profile?.role !== 'SHIPPING_AGENT') {
        return { ok: false, reason: 'only shipping agents can claim alerts' };
    }

    // Service_role for the conditional claim UPDATE + shipowner mutation. Single-country
    // foundation: the alert / vessel / GHOST shipowner all carry the DEFAULT jurisdiction
    // (agent jurisdiction scoping deferred to Wedge 2). UNSCOPED platform client.
    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'supabase service role not configured' };
    }

    const claim = await claimAlert(admin, alertId, auth.user.id);
    if (!claim.ok) return { ok: false, reason: claim.reason };

    // Resolve vessel + shipowner; create GHOST owner if vessel has none.
    const { data: vessel } = await admin
        .from('vessels')
        .select('shipowner_id, name, imo_number')
        .eq('id', claim.alert.vessel_id)
        .single();

    let ownerId = vessel?.shipowner_id;
    if (!ownerId) {
        const owner = await getOrCreateGhost(admin, {
            name: vessel?.name ?? 'Unknown Owner',
        });
        ownerId = owner.id;
        await admin
            .from('vessels')
            .update({ shipowner_id: ownerId })
            .eq('id', claim.alert.vessel_id);
    }
    await upsertShipownerEmail(admin, ownerId!, ownerEmail, 'AGENT_CLAIM');

    // Enqueue proforma generation
    const { error: enqErr } = await admin.rpc('pgmq_enqueue_proforma', {
        alert_id: alertId,
    });
    if (enqErr) {
        console.error('[claim] enqueue failed:', enqErr);
        // Do NOT roll back the claim — let a later retry (cron or manual) enqueue.
    }

    return { ok: true, alertId };
}
