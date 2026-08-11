'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { upsertShipownerEmail } from '@/services/shipownerService';
import { isValidImo } from '@/services/vesselIdentity/imo';

// Schéma et types restent internes : un module 'use server' n'exporte que des
// fonctions async, sinon `next build` casse.
// z.guid() (not z.uuid()) : les identifiants de test respectent la forme
// 8-4-4-4-12 mais pas les contraintes de version/variant RFC 4122 strictes
// qu'impose z.uuid() dans Zod v4 — cohérent avec les UUID générés par
// gen_random_uuid() de Postgres, qui eux les respectent, donc aucune perte
// de garde côté production.
const schema = z.object({
    candidateId: z.guid(),
    vesselId: z.guid(),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export type ApplyVesselIdentityResult =
    | { ok: true; vesselId: string; emailApplied: boolean }
    | { ok: false; reason: string };

/**
 * Applique un appariement décidé par un humain : le candidat VesselFinder
 * devient l'identité du navire placeholder désigné.
 *
 * Cinq gardes, dans l'ordre, chacune interrompant sans écrire :
 *   1. authentification et rôle
 *   2. candidat existant et encore PENDING
 *   3. navire cible NON identifié — `!isValidImo(imo_number)` couvre
 *      `UNVERIFIED-*`, « à confirmer » et « Hors registre Equasis »
 *   4. aucun autre navire ne porte cet IMO ou ce MMSI (sinon CONFLICT)
 *   5. contact appliqué seulement si le candidat n'est pas sous sanctions
 */
export async function applyVesselIdentity(raw: unknown): Promise<ApplyVesselIdentityResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) {
        return { ok: false, reason: 'insufficient role' };
    }

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    // Garde 2 — candidat
    const { data: candidate } = await admin
        .from('vessel_identity_candidates')
        .select('*')
        .eq('id', parsed.data.candidateId)
        .maybeSingle();
    if (!candidate) return { ok: false, reason: 'candidate not found' };
    if (candidate.status !== 'PENDING') {
        return { ok: false, reason: 'candidate already processed' };
    }

    // Garde 3 — navire non identifié
    const { data: vessel } = await admin
        .from('vessels')
        .select('id, imo_number, mmsi, shipowner_id, jurisdiction_id')
        .eq('id', parsed.data.vesselId)
        .maybeSingle();
    if (!vessel) return { ok: false, reason: 'vessel not found' };
    if (isValidImo(String(vessel.imo_number))) {
        return { ok: false, reason: 'vessel already identified' };
    }

    // Garde 4 — collision d'identité
    const { data: clash } = await admin
        .from('vessels')
        .select('id')
        .neq('id', vessel.id)
        .or(
            candidate.mmsi
                ? `imo_number.eq.${candidate.imo_number},mmsi.eq.${candidate.mmsi}`
                : `imo_number.eq.${candidate.imo_number}`,
        )
        .maybeSingle();
    if (clash) {
        await admin
            .from('vessel_identity_candidates')
            .update({ status: 'CONFLICT' })
            .eq('id', candidate.id);
        return { ok: false, reason: 'identity already held by another vessel' };
    }

    // Écriture de l'identité
    const { error: updateErr } = await admin
        .from('vessels')
        .update({
            imo_number: candidate.imo_number,
            mmsi: candidate.mmsi,
            call_sign: candidate.call_sign,
            name: candidate.vessel_name,
            flag_code: candidate.flag_code,
            category: candidate.category,
            vessel_subtype: candidate.type_raw,
            gross_tonnage_dwt: candidate.gross_tonnage,
            dwt: candidate.deadweight,
            build_year: candidate.build_year,
        })
        .eq('id', vessel.id);
    if (updateErr) return { ok: false, reason: updateErr.message };

    // Garde 5 — contact
    const billingEmail = candidate.contact_blocked
        ? null
        : (candidate.manager_email ?? candidate.owner_email ?? candidate.ism_manager_email ?? null);

    let emailApplied = false;
    if (billingEmail && vessel.shipowner_id) {
        await upsertShipownerEmail(admin, String(vessel.shipowner_id), billingEmail, 'VESSELFINDER_VERIFIED');
        emailApplied = true;
    }

    if (candidate.contact_blocked) {
        await admin.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: profile.full_name ?? 'Officier',
            action: 'SANCTIONS_CONTACT_BLOCKED',
            severity: 'CRITICAL',
            entity_type: 'Vessel',
            entity_id: vessel.id,
            jurisdiction_id: vessel.jurisdiction_id ?? null,
            details_json: {
                event: 'VESSELFINDER_CONTACT_BLOCKED',
                imoNumber: candidate.imo_number,
                reason: candidate.contact_blocked_reason,
            },
        });
    }

    await admin
        .from('vessel_identity_candidates')
        .update({
            status: 'MATCHED',
            matched_vessel_id: vessel.id,
            matched_by: auth.user.id,
            matched_at: new Date().toISOString(),
        })
        .eq('id', candidate.id);

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: profile.full_name ?? 'Officier',
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Vessel',
        entity_id: vessel.id,
        jurisdiction_id: vessel.jurisdiction_id ?? null,
        details_json: {
            event: 'VESSEL_IDENTITY_MATCHED',
            previousImo: vessel.imo_number,
            imoNumber: candidate.imo_number,
            mmsi: candidate.mmsi,
            vesselName: candidate.vessel_name,
            emailApplied,
            candidateId: candidate.id,
        },
    });

    return { ok: true, vesselId: String(vessel.id), emailApplied };
}
