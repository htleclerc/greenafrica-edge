'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { provisionOwnerAccount } from '@/services/ownerProvisioning';
import { assertContactAllowed, SanctionedContactError } from '@/domain/sanctions/contactGuard';
import { writeAuditLog } from '@/services/auditService';

const schema = z.object({
    shipownerId: z.guid(),
    email: z.email(),
    fullName: z.string().trim().min(2).max(120),
}).strict();

const ALLOWED_ROLES = ['SUPERADMIN', 'FINANCE_ADMIN'];

export type AddOwnerRepresentativeResult =
    | { ok: true; profileId: string; created: boolean }
    | { ok: false; reason: string };

/**
 * Rattache un représentant à un armateur, en créant son compte au passage.
 *
 * OUVRE UNE BOUCLE FERMÉE. `owner_agent_mappings.agent_profile_id` est
 * NOT NULL et le sélecteur de la fiche armateur ne propose que des profils
 * existants : un représentant sans compte n'était pas rattachable, et sans
 * rattachement il n'avait pas de lien de connexion. Il fallait donc déjà
 * avoir un compte pour pouvoir en obtenir un.
 *
 * Cas d'usage nominal : une réponse à la campagne du 19 août arrive d'une
 * adresse absente du référentiel — gavaksh.b@rafflescommercial.com pour
 * PRO-CONS-2026-055 — et le personnel la rattache au dossier concerné.
 *
 * Sert aussi au second dossier d'une adresse qui en couvre plusieurs : le
 * profil possède un armateur, les autres se rattachent ici.
 */
export async function addOwnerRepresentative(raw: unknown): Promise<AddOwnerRepresentativeResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: me } = await supabase
        .from('profiles').select('role, full_name').eq('id', auth.user.id).single();
    if (!me || !ALLOWED_ROLES.includes(me.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const admin = createPlatformClient();
    const { data: owner } = await admin
        .from('shipowners')
        .select('id, name, is_ofac_sdn, is_un_prohibited, jurisdiction_id')
        .eq('id', parsed.data.shipownerId)
        .maybeSingle();
    if (!owner) return { ok: false, reason: 'shipowner not found' };

    const staffName = me.full_name ?? auth.user.email ?? 'staff';

    // Garde sanctions AVANT toute écriture. Rattacher un représentant à un
    // armateur sanctionné lui ouvrirait un canal de contact direct, ce que la
    // règle interdit absolument.
    try {
        assertContactAllowed(owner as never);
    } catch (e) {
        if (e instanceof SanctionedContactError) {
            await writeAuditLog(admin, {
                user_id: auth.user.id,
                user_full_name: staffName,
                action: 'SANCTIONS_CONTACT_BLOCKED',
                severity: 'CRITICAL',
                entity_type: 'Shipowner',
                entity_id: owner.id,
                jurisdiction_id: owner.jurisdiction_id,
                details_json: {
                    code: e.code,
                    attempted: 'ADD_REPRESENTATIVE',
                    email: parsed.data.email,
                },
            });
            return { ok: false, reason: `sanctioned: ${e.message}` };
        }
        throw e;
    }

    let provisioned;
    try {
        provisioned = await provisionOwnerAccount(admin, {
            email: parsed.data.email,
            fullName: parsed.data.fullName,
        });
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'provisioning failed' };
    }

    // Idempotence par lecture préalable, PAS par upsert : la contrainte unique
    // porte sur (shipowner_id, agent_profile_id, valid_from) — trois colonnes.
    // Un upsert sur les deux premières échouerait faute de cible valide, et
    // sur les trois il créerait une ligne neuve à chaque jour différent.
    const { data: existing } = await admin
        .from('owner_agent_mappings')
        .select('id, active')
        .eq('shipowner_id', owner.id)
        .eq('agent_profile_id', provisioned.profileId)
        .order('valid_from', { ascending: false })
        .limit(1);

    const current = ((existing ?? []) as { id: string; active: boolean }[])[0];

    if (current) {
        // Un rattachement désactivé est réactivé plutôt que doublé : la
        // résolution du lien de connexion ne regarde que les actifs.
        if (!current.active) {
            const { error } = await admin
                .from('owner_agent_mappings').update({ active: true }).eq('id', current.id);
            if (error) return { ok: false, reason: error.message };
        }
    } else {
        const { error } = await admin.from('owner_agent_mappings').insert({
            shipowner_id: owner.id,
            agent_profile_id: provisioned.profileId,
            priority: 10,
            active: true,
            created_by: auth.user.id,
        });
        if (error) return { ok: false, reason: error.message };
    }

    await writeAuditLog(admin, {
        user_id: auth.user.id,
        user_full_name: staffName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Shipowner',
        entity_id: owner.id,
        jurisdiction_id: owner.jurisdiction_id,
        details_json: {
            event: 'REPRESENTATIVE_ADDED',
            email: parsed.data.email,
            profile_id: provisioned.profileId,
            account_created: provisioned.created,
        },
    });

    return { ok: true, profileId: provisioned.profileId, created: provisioned.created };
}
