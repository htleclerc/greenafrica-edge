'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { isValidImo } from '@/services/vesselIdentity/imo';
import { CATEGORY_BY_TYPENAME } from '@/services/vesselIdentity/vesselFinderParser';
import {
    flagSanctionedCandidates,
    loadSanctionedEntities,
} from '@/services/vesselIdentity/vesselIdentityService';

const schema = z.object({
    imoNumber: z.string(),
    vesselName: z.string().min(1),
    mmsi: z.string().nullable().optional(),
    callSign: z.string().nullable().optional(),
    flagCode: z.string().length(2),
    typeRaw: z.string().min(1),
    grossTonnage: z.number().int().nonnegative().nullable().optional(),
    deadweight: z.number().int().nonnegative().nullable().optional(),
    buildYear: z.number().int().nullable().optional(),
    managerName: z.string().nullable().optional(),
    managerEmail: z.string().nullable().optional(),
    ownerName: z.string().nullable().optional(),
    ownerEmail: z.string().nullable().optional(),
    ismManagerName: z.string().nullable().optional(),
    ismManagerEmail: z.string().nullable().optional(),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export type CreateManualCandidateResult =
    | { ok: true; candidateId: string }
    | { ok: false; reason: string };

/**
 * Saisie unitaire d'un candidat, pour les navires absents de l'export d'escales.
 * Les mêmes contrôles que l'import s'appliquent — en particulier la somme de
 * contrôle IMO, qui est ici la seule protection contre une faute de frappe sur
 * l'identifiant fiscal du navire.
 */
export async function createManualCandidate(raw: unknown): Promise<CreateManualCandidateResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const input = parsed.data;

    if (!isValidImo(input.imoNumber)) {
        return { ok: false, reason: 'somme de contrôle IMO invalide' };
    }
    const category = CATEGORY_BY_TYPENAME[input.typeRaw];
    if (!category) {
        return { ok: false, reason: `type de navire inconnu : ${input.typeRaw}` };
    }
    if (!/^[A-Z]{2}$/.test(input.flagCode)) {
        return { ok: false, reason: `pavillon non ISO-2 : ${input.flagCode}` };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) {
        return { ok: false, reason: 'insufficient role' };
    }

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    const sanctioned = await loadSanctionedEntities(admin);
    const [flagged] = flagSanctionedCandidates(
        [{
            imoNumber: input.imoNumber,
            mmsi: input.mmsi ?? null,
            callSign: input.callSign ?? null,
            vesselName: input.vesselName,
            flagCode: input.flagCode,
            typeRaw: input.typeRaw,
            category,
            grossTonnage: input.grossTonnage ?? null,
            deadweight: input.deadweight ?? null,
            buildYear: input.buildYear ?? null,
            managerName: input.managerName ?? null,
            managerCountry: null,
            managerEmail: input.managerEmail ?? null,
            ownerName: input.ownerName ?? null,
            ownerCountry: null,
            ownerEmail: input.ownerEmail ?? null,
            ismManagerName: input.ismManagerName ?? null,
            ismManagerEmail: input.ismManagerEmail ?? null,
            lastSeenAt: '',
        }],
        sanctioned,
    );

    const { data, error } = await admin
        .from('vessel_identity_candidates')
        .insert({
            batch_label: `saisie-manuelle-${input.imoNumber}`,
            source: 'MANUAL',
            imo_number: flagged.imoNumber,
            mmsi: flagged.mmsi,
            call_sign: flagged.callSign,
            vessel_name: flagged.vesselName,
            flag_code: flagged.flagCode,
            type_raw: flagged.typeRaw,
            category: flagged.category,
            gross_tonnage: flagged.grossTonnage,
            deadweight: flagged.deadweight,
            build_year: flagged.buildYear,
            manager_name: flagged.managerName,
            manager_email: flagged.managerEmail,
            owner_name: flagged.ownerName,
            owner_email: flagged.ownerEmail,
            ism_manager_name: flagged.ismManagerName,
            ism_manager_email: flagged.ismManagerEmail,
            contact_blocked: flagged.contactBlocked,
            contact_blocked_reason: flagged.contactBlockedReason,
            status: 'PENDING',
            imported_by: auth.user.id,
        })
        .select('id')
        .single();
    if (error || !data) return { ok: false, reason: error?.message ?? 'insert failed' };

    return { ok: true, candidateId: String(data.id) };
}
