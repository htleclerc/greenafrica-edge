'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { writeAuditLog } from '@/services/auditService';

const renameSchema = z.object({
    vesselId: z.guid(),
    name: z.string().trim().min(1).max(120),
}).strict();

const detachSchema = z.object({ vesselId: z.guid() }).strict();

export type UpdateOwnerVesselResult = { ok: true } | { ok: false; reason: string };

interface OwnVesselContext {
    userId: string;
    owner: { id: string; name: string };
    vessel: { id: string; name: string; previous_names: string[] };
}

/**
 * Charge le navire APRÈS avoir vérifié qu'il appartient bien à l'armateur de
 * la session.
 *
 * Sans cette garde, un armateur pourrait renommer ou détacher la flotte d'un
 * autre en devinant un identifiant. Le contrôle porte sur `shipowner_id`
 * résolu depuis `profile_id`, jamais sur une valeur venue du client.
 */
async function loadOwnVessel(vesselId: string): Promise<OwnVesselContext | { error: string }> {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { error: 'not authenticated' };

    // Le compte est résolu par current_shipowner_id() côté base (mig 135) : la
    // lecture sans filtre ne peut rendre que le compte de l'appelant, qu'il en
    // soit titulaire ou membre invité. Le contrôle porte donc toujours sur une
    // valeur de session, jamais sur une valeur venue du client.
    const { data: owner } = await supabase
        .from('shipowners').select('id, name').limit(1).maybeSingle();
    if (!owner) return { error: 'no owner record' };

    // Gérer la flotte est une sous-permission : un membre qui ne l'a pas voit
    // les navires mais ne les modifie pas.
    const { data: membership } = await supabase
        .from('owner_members')
        .select('can_manage_vessels')
        .eq('profile_id', auth.user.id)
        .eq('active', true)
        .maybeSingle();
    if (membership && (membership as { can_manage_vessels: boolean }).can_manage_vessels !== true) {
        return { error: 'forbidden' };
    }

    const { data: vessel } = await supabase
        .from('vessels')
        .select('id, name, shipowner_id, previous_names')
        .eq('id', vesselId)
        .maybeSingle();
    // Message identique qu'il n'existe pas ou appartienne à un tiers : l'écran
    // ne doit pas confirmer l'existence du navire d'un autre armateur.
    if (!vessel || vessel.shipowner_id !== owner.id) return { error: 'vessel not found' };

    return {
        userId: auth.user.id,
        owner: { id: String(owner.id), name: String(owner.name) },
        vessel: {
            id: String(vessel.id),
            name: String(vessel.name),
            previous_names: (vessel.previous_names ?? []) as string[],
        },
    };
}

/**
 * Corrige le nom d'un navire. L'ancien nom est versé dans `previous_names` :
 * c'est la trace qui permet de rapprocher les pro-formas déjà émises sous
 * l'ancienne appellation.
 */
export async function renameOwnerVessel(raw: unknown): Promise<UpdateOwnerVesselResult> {
    const parsed = renameSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const ctx = await loadOwnVessel(parsed.data.vesselId);
    if ('error' in ctx) return { ok: false, reason: ctx.error };

    const oldName = ctx.vessel.name;
    if (oldName === parsed.data.name) return { ok: true };

    const admin = createPlatformClient();
    const { error } = await admin.from('vessels').update({
        name: parsed.data.name,
        previous_names: ctx.vessel.previous_names.includes(oldName)
            ? ctx.vessel.previous_names
            : [...ctx.vessel.previous_names, oldName],
    }).eq('id', ctx.vessel.id);
    if (error) return { ok: false, reason: error.message };

    await writeAuditLog(admin, {
        user_id: ctx.userId,
        user_full_name: ctx.owner.name,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Vessel',
        entity_id: ctx.vessel.id,
        details_json: { event: 'OWNER_VESSEL_RENAMED', from: oldName, to: parsed.data.name },
    });

    return { ok: true };
}

/**
 * Retire un navire de la flotte de l'armateur.
 *
 * REFUSÉ dès qu'une facture vivante vise le navire : le geste devient alors
 * « contester », qui ouvre un litige sans toucher à la transaction. Aucune
 * facture n'est jamais annulée en libre-service.
 */
export async function detachOwnerVessel(raw: unknown): Promise<UpdateOwnerVesselResult> {
    const parsed = detachSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const ctx = await loadOwnVessel(parsed.data.vesselId);
    if ('error' in ctx) return { ok: false, reason: ctx.error };

    const admin = createPlatformClient();

    // La garde est revalidée ICI, pas seulement dans l'écran : un appel direct
    // à l'action contournerait un bouton grisé. Les VOID sont exclues — une
    // pro-forma annulée par la rebascule ne doit pas retenir le navire.
    const { count, error: cErr } = await admin
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('vessel_id', ctx.vessel.id)
        .neq('status', 'VOID');
    if (cErr) return { ok: false, reason: cErr.message };
    if ((count ?? 0) > 0) return { ok: false, reason: 'vessel has invoices — dispute instead' };

    const { error } = await admin
        .from('vessels').update({ shipowner_id: null }).eq('id', ctx.vessel.id);
    if (error) return { ok: false, reason: error.message };

    await writeAuditLog(admin, {
        user_id: ctx.userId,
        user_full_name: ctx.owner.name,
        action: 'TRANSACTION_UPDATED',
        severity: 'WARNING',
        entity_type: 'Vessel',
        entity_id: ctx.vessel.id,
        details_json: {
            event: 'OWNER_VESSEL_DETACHED',
            vessel_name: ctx.vessel.name,
            former_owner_id: ctx.owner.id,
        },
    });

    return { ok: true };
}
